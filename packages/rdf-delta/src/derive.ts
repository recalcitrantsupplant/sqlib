/**
 * Running the plan: CONSTRUCT the templates, then work out what actually
 * changes.
 *
 * The raw template instantiations overstate the change, because SPARQL Update
 * is defined on a graph store and not on a list of instructions: deleting a
 * triple that is absent and inserting one that is already present are both
 * no-ops, and a triple both deleted and re-inserted by the same operation never
 * goes away. With `S` the store, `D*` and `I*` the instantiated templates, the
 * post-state is `S' = (S \ D*) ∪ I*`, so what an observer sees change is
 *
 *     deletions = (S ∩ D*) \ I*
 *     additions = I* \ S
 *
 * Both raw counts are kept alongside, because "you asked to delete 12, 9 of
 * them existed" is the interesting half of a preview.
 *
 * The same arithmetic composes a *program*, because it is stated over sets and
 * not over one operation: an operation that removes what an earlier one added
 * cancels it, and the accumulator below does exactly that. What it cannot do on
 * its own is let operation N *see* what N−1 wrote — for that the program is
 * replayed on a fork, and everything else here is unchanged. See
 * `simulationFor`.
 */

import { UnsupportedUpdateError } from './errors.js';
import {
  QuadSet,
  graphIri,
  quadHasBlankNode,
  termToNTriples,
  withGraph,
  type QuadLike,
  type TermLike,
} from './terms.js';
import { planUpdate, type OperationPlan, type QuadOperationPlan, type TemplatePart } from './plan.js';
import { graphOperationEffect, type GraphOperationRecord } from './graphOps.js';
import type { DeltaStore, SimulationStore } from './deltaStore.js';

export type { DeltaStore, SimulationStore } from './deltaStore.js';

/** The ground effect of one update, computed without running it. */
export interface Patch {
  additions: QuadLike[];
  deletions: QuadLike[];
  additionCount: number;
  deletionCount: number;
  /** Template instantiations before the net-effect trim, for preview copy. */
  rawInsertCount: number;
  rawDeleteCount: number;
  containsBlankNodes: boolean;
  /**
   * False when a blank-node-bearing deletion candidate could not be tested for
   * membership (a store with no `has`), or when a graph-management operation
   * was counted rather than enumerated — in both cases the quad sets are not
   * the whole truth about what an observer would see change.
   */
  netEffectExact: boolean;
  /**
   * `ground-sparql` — applicable as `DELETE DATA … ; INSERT DATA …` anywhere.
   * `store` — carries blank nodes, so it must be applied through a store API.
   * `graph-ops` — carries a graph-management operation the quad sets do not
   * express, so it is a preview and an audit record but not a diff to apply.
   */
  applyMode: 'ground-sparql' | 'store' | 'graph-ops';
  /** Whether the inverse patch is expressible, i.e. no blank nodes to re-mint. */
  revertible: boolean;
  /** Graph-management operations the update performs. Usually empty. */
  graphOps: GraphOperationRecord[];
}

export interface DeriveOptions {
  /**
   * Turn graph-management operations into the quads they move, by reading the
   * graphs they name. Off by default: `DROP GRAPH <g>` should not silently
   * become a full scan of `g`.
   */
  enumerateGraphOps?: boolean;
  /** Refuse rather than enumerate more than this many triples per operation. */
  enumerationCap?: number;
}

const EXISTENCE_CHUNK = 500;

/** Enough to enumerate an ordinary working graph, small enough to notice. */
const DEFAULT_ENUMERATION_CAP = 100_000;

/** Derive the patch one update would produce, without executing it. */
export async function derivePatch(
  updateString: string,
  store: DeltaStore,
  options: DeriveOptions = {},
): Promise<Patch> {
  const { operations } = planUpdate(updateString);
  if (operations.length === 0) {
    return emptyPatch();
  }

  const graphOptions = {
    enumerate: options.enumerateGraphOps === true,
    cap: options.enumerationCap ?? DEFAULT_ENUMERATION_CAP,
  };

  const simulation = await simulationFor(operations, store);
  try {
    return await run(operations, simulation ?? store, simulation, graphOptions);
  } finally {
    await simulation?.close?.();
  }
}

/**
 * A private copy of the store, when the program needs one.
 *
 * Only a program whose operations *interact* does: a single operation reads the
 * store exactly once, and a program of ground operations (`INSERT DATA` /
 * `DELETE DATA` sequences) composes by set arithmetic alone. Anything else has
 * an operation whose result depends on what its predecessors wrote, and the only
 * faithful way to derive it is to let them write.
 *
 * A store that cannot fork keeps the refusal it had before simulation existed —
 * naming the offending operation, because "unsupported" without a position is
 * not something a caller can act on.
 */
async function simulationFor(
  operations: readonly OperationPlan[],
  store: DeltaStore,
): Promise<SimulationStore | undefined> {
  if (operations.length < 2) return undefined;
  const index = operations.findIndex((operation) => !operation.ground);
  if (index === -1) return undefined;

  if (!store.fork) {
    throw new UnsupportedUpdateError(
      `Operation ${index + 1} of ${operations.length} reads the store (${operations[index]!.form}), ` +
        'and would have to be previewed against the state the earlier operations leave behind. ' +
        'This backend cannot be forked, so multi-operation programs are supported here only when ' +
        'every operation is ground.',
    );
  }
  return store.fork();
}

async function run(
  operations: readonly OperationPlan[],
  store: DeltaStore,
  simulation: SimulationStore | undefined,
  graphOptions: { enumerate: boolean; cap: number },
): Promise<Patch> {
  const additions = new QuadSet();
  const deletions = new QuadSet();
  const graphOps: GraphOperationRecord[] = [];
  let rawInsertCount = 0;
  let rawDeleteCount = 0;
  let netEffectExact = true;

  for (const operation of operations) {
    let rawDeletes: QuadLike[];
    let rawInserts: QuadLike[];
    // An enumerated graph operation read its deletions out of the store a
    // moment ago, so asking the store again whether it holds them is a second
    // full pass for an answer already known.
    let deletesKnownPresent = false;

    if (operation.kind === 'graph') {
      const effect = await graphOperationEffect(operation, store, graphOptions);
      graphOps.push(effect.record);
      netEffectExact &&= effect.record.enumerated;
      rawDeletes = effect.rawDeletes;
      rawInserts = effect.rawInserts;
      deletesKnownPresent = effect.record.enumerated;
    } else {
      rawDeletes = await instantiate(operation, operation.deleteParts, store);
      rawInserts = await instantiate(operation, operation.insertParts, store);
    }

    rawDeleteCount += rawDeletes.length;
    rawInsertCount += rawInserts.length;

    const inserted = new QuadSet(rawInserts);
    const present = deletesKnownPresent
      ? { set: new QuadSet(rawDeletes), exact: true }
      : await existing(store, rawDeletes);
    netEffectExact &&= present.exact;

    // Order matters: a triple this operation deletes and re-inserts survives,
    // so the deletions are trimmed against this operation's own insertions.
    for (const quad of rawDeletes) {
      if (inserted.has(quad)) continue;
      if (additions.has(quad)) {
        // Added by an earlier operation in the same program, now removed:
        // nothing an observer of the whole program ever sees.
        additions.delete(quad);
        continue;
      }
      if (present.set.has(quad)) deletions.add(quad);
    }

    const absent = await missing(store, rawInserts);
    netEffectExact &&= absent.exact;
    for (const quad of rawInserts) {
      if (deletions.has(quad)) {
        // Deleted by an earlier operation and put back: also a no-op overall.
        deletions.delete(quad);
        continue;
      }
      if (absent.set.has(quad)) additions.add(quad);
    }

    // Advance the copy before deriving the next operation. The operation as
    // written, not the diff just derived: only the original text carries the
    // effects the diff deliberately leaves out — an empty graph created, a
    // graph operation that was counted rather than enumerated.
    if (simulation) await simulation.update(operation.text);
  }

  const additionQuads = additions.values();
  const deletionQuads = deletions.values();
  const containsBlankNodes = [...additionQuads, ...deletionQuads].some(quadHasBlankNode);
  const unexpressed = graphOps.some((record) => !record.enumerated);

  if (simulation && containsBlankNodes) {
    // The fork is a copy, and a copy relabels blank nodes: a deletion carrying
    // one would name a node in the copy rather than in the store, and an
    // addition would mint a fresh node where the program meant to reuse the
    // store's. Neither is a patch anyone should be handed.
    throw new UnsupportedUpdateError(
      'This program has to be simulated on a copy of the store, and its patch carries blank nodes, ' +
        'whose labels belong to the copy rather than to the store. Split the program, or write it ' +
        'so the operations do not read one another.',
    );
  }

  return {
    additions: additionQuads,
    deletions: deletionQuads,
    additionCount: additionQuads.length,
    deletionCount: deletionQuads.length,
    rawInsertCount,
    rawDeleteCount,
    containsBlankNodes,
    netEffectExact,
    applyMode: unexpressed ? 'graph-ops' : containsBlankNodes ? 'store' : 'ground-sparql',
    // An unexpressed graph operation has no inverse in the quad sets either:
    // re-inserting what a counted DROP removed is not something this patch can
    // describe, because it never recorded what was removed.
    revertible: !containsBlankNodes && !unexpressed,
    graphOps,
  };
}

function emptyPatch(): Patch {
  return {
    additions: [],
    deletions: [],
    additionCount: 0,
    deletionCount: 0,
    rawInsertCount: 0,
    rawDeleteCount: 0,
    containsBlankNodes: false,
    netEffectExact: true,
    applyMode: 'ground-sparql',
    revertible: true,
    graphOps: [],
  };
}

/** Instantiate one template: one CONSTRUCT per graph-homogeneous part. */
async function instantiate(
  operation: QuadOperationPlan,
  parts: readonly TemplatePart[],
  store: DeltaStore,
): Promise<QuadLike[]> {
  const quads: QuadLike[] = [];

  for (const part of parts) {
    if (part.graph.kind === 'variable') {
      // `GRAPH ?g { … }` in a template: CONSTRUCT cannot project the graph, so
      // the variable's values are read first and each one gets its own
      // CONSTRUCT with the variable pinned. Exact, at one extra query per
      // distinct graph.
      const variable = part.graph.value;
      const rows = await store.select(
        `${operation.prologue}\nSELECT DISTINCT ?${variable}${operation.datasetText}\nWHERE ${operation.whereText}`,
      );
      for (const row of rows) {
        const value = row[variable];
        if (!value || value.termType !== 'NamedNode') continue;
        const pinned = `{ VALUES ?${variable} { <${value.value}> } ${operation.whereText} }`;
        const constructed = await store.construct(constructQuery(operation, part.text, pinned));
        for (const quad of constructed) quads.push(withGraph(quad, value.value));
      }
      continue;
    }

    const constructed = await store.construct(constructQuery(operation, part.text, operation.whereText));
    const graph = part.graph.kind === 'iri' ? part.graph.value : undefined;
    for (const quad of constructed) quads.push(withGraph(quad, graph));
  }

  return quads;
}

function constructQuery(operation: QuadOperationPlan, template: string, whereText: string): string {
  return `${operation.prologue}\nCONSTRUCT {\n${template}\n}${operation.datasetText}\nWHERE ${whereText}`;
}

/** Which of `candidates` the store already holds. */
async function existing(
  store: DeltaStore,
  candidates: readonly QuadLike[],
): Promise<{ set: QuadSet; exact: boolean }> {
  const set = new QuadSet();
  if (candidates.length === 0) return { set, exact: true };

  if (store.has) {
    for (const quad of candidates) {
      if (await store.has(quad)) set.add(quad);
    }
    return { set, exact: true };
  }

  let exact = true;
  const groundable: QuadLike[] = [];
  for (const quad of candidates) {
    if (quadHasBlankNode(quad)) {
      // No way to name it in SPARQL text. It was almost certainly matched out
      // of the store a moment ago, so keeping it reaches the right end state —
      // but "almost certainly" is what `netEffectExact: false` is recording.
      set.add(quad);
      exact = false;
    } else {
      groundable.push(quad);
    }
  }

  const { found, ambiguous } = await lookup(store, groundable);
  for (const quad of found) set.add(quad);
  // Kept for the same reason as a blank node above: deleting a triple the
  // default graph turns out not to hold is a no-op, so the end state is right
  // and only the count may overstate.
  for (const quad of ambiguous) set.add(quad);
  if (ambiguous.length > 0) exact = false;
  return { set, exact };
}

/** Which of `candidates` the store does not hold. */
async function missing(
  store: DeltaStore,
  candidates: readonly QuadLike[],
): Promise<{ set: QuadSet; exact: boolean }> {
  const absent = new QuadSet();
  if (candidates.length === 0) return { set: absent, exact: true };

  const groundable: QuadLike[] = [];
  for (const quad of candidates) {
    // A blank node minted by the template is new by construction, so the
    // membership test is answerable without asking.
    if (quadHasBlankNode(quad)) absent.add(quad);
    else groundable.push(quad);
  }

  // An ambiguous quad counts as absent: inserting a triple the default graph
  // already holds is a no-op, whereas dropping an insertion it does not hold
  // would lose a write.
  const { found, ambiguous } = await lookup(store, groundable);
  const present = new QuadSet(found);
  for (const quad of groundable) {
    if (!present.has(quad)) absent.add(quad);
  }
  return { set: absent, exact: ambiguous.length === 0 };
}

/** How many named-graph triples the probe samples. */
const UNION_PROBE_SAMPLE = 8;

const unionProbes = new WeakMap<DeltaStore, Promise<boolean>>();

/**
 * Whether a store queries its default graph as the union of all its graphs.
 *
 * Read-only and cheap: it samples a few triples out of named graphs and asks,
 * in the same query, whether each one is also visible without `GRAPH`. A store
 * whose default graph is its own never shows a named graph's triple there
 * unless the default graph holds a copy, so one invisible sample settles it;
 * a store with no named-graph data at all is answered `false`, because there
 * is nothing for the default graph to be confused with.
 *
 * Every sample being visible could in principle be coincidence — a store that
 * keeps the same triples in both — and the cost of that misreading is bounded:
 * the default-graph membership test below turns cautious, which costs a patch
 * its `netEffectExact`, never its end state.
 */
export async function probeUnionDefaultGraph(store: DeltaStore): Promise<boolean> {
  const rows = await store.select(
    `SELECT ?visible WHERE {\nGRAPH ?g { ?s ?p ?o }\nBIND(EXISTS { ?s ?p ?o } AS ?visible)\n} LIMIT ${UNION_PROBE_SAMPLE}`,
  );
  if (rows.length === 0) return false;
  return rows.every((row) => isTrue(row.visible));
}

function isTrue(term: TermLike | undefined): boolean {
  return term?.termType === 'Literal' && (term.value === 'true' || term.value === '1');
}

/** The store's own answer when it gives one; otherwise one probe per store. */
function unionDefaultGraph(store: DeltaStore): Promise<boolean> {
  if (store.unionDefaultGraph !== undefined) return Promise.resolve(store.unionDefaultGraph);
  let probe = unionProbes.get(store);
  if (!probe) {
    probe = probeUnionDefaultGraph(store);
    unionProbes.set(store, probe);
    // A failed probe is a transport problem, not an answer: let the next
    // derivation ask again rather than inherit the rejection.
    probe.catch(() => unionProbes.delete(store));
  }
  return probe;
}

/**
 * Ask the store which of these ground quads it holds, in batches.
 *
 * One query per graph per chunk, rather than one per quad: a `VALUES` block
 * joined against the pattern is the portable way to ask a membership question
 * of an endpoint that only speaks SPARQL.
 *
 * The default graph is the one place the pattern can lie. On a store whose
 * default graph is the union of all graphs, `?s ?p ?o` also matches a triple
 * only a named graph holds, so the question is scoped with `GRAPH ?g`: a triple
 * visible there and in no named graph is in the default graph; one a named
 * graph holds is `ambiguous`, because whether the stored default graph holds a
 * copy as well is something such a store has no portable way to be asked.
 */
async function lookup(
  store: DeltaStore,
  quads: readonly QuadLike[],
): Promise<{ found: QuadLike[]; ambiguous: QuadLike[] }> {
  const found: QuadLike[] = [];
  const ambiguous: QuadLike[] = [];
  const byGraph = new Map<string | undefined, QuadLike[]>();
  for (const quad of quads) {
    const graph = graphIri(quad);
    const bucket = byGraph.get(graph);
    if (bucket) bucket.push(quad);
    else byGraph.set(graph, [quad]);
  }

  for (const [graph, bucket] of byGraph) {
    const scoped = graph === undefined && (await unionDefaultGraph(store));
    for (let offset = 0; offset < bucket.length; offset += EXISTENCE_CHUNK) {
      const chunk = bucket.slice(offset, offset + EXISTENCE_CHUNK);
      const values = chunk
        .map(
          (quad) =>
            `(${termToNTriples(quad.subject)} ${termToNTriples(quad.predicate)} ${termToNTriples(quad.object)})`,
        )
        .join('\n');
      const pattern =
        graph !== undefined
          ? `GRAPH <${graph}> { ?s ?p ?o . }`
          : scoped
            ? '?s ?p ?o .\nOPTIONAL { GRAPH ?g { ?s ?p ?o . } }'
            : '?s ?p ?o .';
      const rows = await store.select(
        `SELECT ?s ?p ?o${scoped ? ' ?g' : ''} WHERE {\nVALUES (?s ?p ?o) {\n${values}\n}\n${pattern}\n}`,
      );
      // A triple held by several named graphs comes back once per graph.
      const seen = new QuadSet();
      const named = new QuadSet();
      for (const row of rows) {
        if (!row.s || !row.p || !row.o) continue;
        const quad: QuadLike = {
          subject: row.s,
          predicate: row.p,
          object: row.o,
          graph: graph === undefined ? null : { termType: 'NamedNode', value: graph },
        };
        seen.add(quad);
        if (scoped && row.g) named.add(quad);
      }
      for (const quad of seen.values()) {
        if (named.has(quad)) ambiguous.push(quad);
        else found.push(quad);
      }
    }
  }

  return { found, ambiguous };
}
