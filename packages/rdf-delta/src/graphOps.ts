/**
 * Graph-management operations, which are not quad diffs until you ask them to be.
 *
 * `CLEAR`, `DROP`, `CREATE`, `LOAD`, `COPY`, `MOVE` and `ADD` do not decompose
 * into CONSTRUCTs the way the data-changing forms do. `DELETE { D } WHERE { W }`
 * names its triples; `DROP GRAPH <g>` names a graph, and what that graph holds
 * is a separate question with a separate cost. Pretending otherwise would make
 * every `DROP` of a large graph a full enumeration nobody asked for.
 *
 * So the default is a **count**: one `SELECT (COUNT(*) …)` per operand, which
 * is enough for a preview to say "this removes 4.2 million triples" and is
 * cheap on any store. A patch whose graph operations were only counted does not
 * carry the quads they move, so it is not applicable as a diff and says so.
 *
 * **Enumeration is opt-in** (`enumerateGraphOps`), bounded by a cap, and is
 * what turns these forms into ordinary quad sets. Once enumerated they flow
 * through exactly the same net-effect arithmetic as `INSERT`/`DELETE` — and the
 * resulting patch is applicable, revertible and hashable like any other. That
 * is the trade the design doc names: honesty by default, exactness on request.
 *
 * `LOAD` is the exception that no option rescues. Its source is a document
 * outside the dataset, so no query against the store can say what it contains;
 * it is recorded, never derived.
 *
 * See `docs/explanation/rdf-patch.md`.
 */

import { EnumerationCapExceededError, UnsupportedUpdateError } from './errors.js';
import { withGraph, type QuadLike } from './terms.js';
import type { GraphOperationPlan, GraphRef } from './plan.js';
import type { DeltaStore } from './deltaStore.js';

/**
 * What a graph-management operation did, alongside the quad sets.
 *
 * Kept even when the operation *was* enumerated: "these 4,200 quads went away
 * because the graph was dropped" is a different fact from "these 4,200 quads
 * were deleted", and a log that flattened the two would lose the only record
 * that the graph itself is gone.
 */
export interface GraphOperationRecord {
  form: GraphOperationPlan['form'];
  silent: boolean;
  destination: GraphRef;
  /** COPY/MOVE/ADD: where the quads came from. */
  source?: GraphRef;
  /** LOAD: the document IRI. */
  document?: string;
  /**
   * Triples the operation moves: removed for `CLEAR`/`DROP`, copied for
   * `COPY`/`MOVE`/`ADD`, zero for `CREATE`. `null` for `LOAD`, whose document
   * the store has never seen.
   */
  affectedCount: number | null;
  /** True when the quads below express this operation in full. */
  enumerated: boolean;
}

/** One graph operation's contribution to the patch. */
export interface GraphOperationEffect {
  record: GraphOperationRecord;
  /** Quads the operation removes, before the net-effect trim. Empty unless enumerated. */
  rawDeletes: QuadLike[];
  /** Quads the operation adds, before the net-effect trim. Empty unless enumerated. */
  rawInserts: QuadLike[];
}

export interface GraphOpOptions {
  enumerate: boolean;
  /** Refuse rather than enumerate beyond this many triples per operation. */
  cap: number;
}

/** Derive one graph-management operation, by counting or by enumeration. */
export async function graphOperationEffect(
  plan: GraphOperationPlan,
  store: DeltaStore,
  options: GraphOpOptions,
): Promise<GraphOperationEffect> {
  const base = {
    form: plan.form,
    silent: plan.silent,
    destination: plan.destination,
    ...(plan.sourceGraph ? { source: plan.sourceGraph } : {}),
    ...(plan.documentIri ? { document: plan.documentIri } : {}),
  };
  const empty = { rawDeletes: [], rawInserts: [] };

  switch (plan.form) {
    case 'create':
      // A graph with no triples in it. There is nothing to count and nothing to
      // enumerate — the whole effect is that the graph now exists, which is
      // what the record carries.
      return { record: { ...base, affectedCount: 0, enumerated: true }, ...empty };

    case 'load':
      if (options.enumerate) {
        throw new UnsupportedUpdateError(
          `LOAD <${plan.documentIri ?? ''}> reads a document outside the dataset, so no query against ` +
            'the store can say what it would add. It is recorded, never enumerated.',
        );
      }
      return { record: { ...base, affectedCount: null, enumerated: false }, ...empty };

    case 'clear':
    case 'drop': {
      if (!options.enumerate) {
        return {
          record: { ...base, affectedCount: await countIn(store, plan.destination), enumerated: false },
          ...empty,
        };
      }
      const rawDeletes = await enumerate(store, plan.destination, plan.form, options.cap);
      return {
        record: { ...base, affectedCount: rawDeletes.length, enumerated: true },
        rawDeletes,
        rawInserts: [],
      };
    }

    case 'copy':
    case 'move':
    case 'add': {
      const source = plan.sourceGraph ?? { kind: 'default' as const };
      const destination = writableRef(plan.destination, plan.form);
      writableRef(source, plan.form);

      // SPARQL 1.1 Update §3.2.5–3.2.7: with the same operand on both sides the
      // operation is a no-op, and specifically *not* "clear the destination and
      // put it back", which is what the general path below would compute.
      if (sameRef(source, destination)) {
        return { record: { ...base, affectedCount: 0, enumerated: true }, ...empty };
      }

      if (!options.enumerate) {
        return {
          record: { ...base, affectedCount: await countIn(store, source), enumerated: false },
          ...empty,
        };
      }

      const sourceQuads = await enumerate(store, source, plan.form, options.cap);
      const rawInserts = sourceQuads.map((quad) => withGraph(quad, iriOf(destination)));

      // COPY and MOVE replace the destination; ADD merges into it. MOVE then
      // empties the source as well — after the copy, so a triple that exists on
      // both sides survives in the destination and leaves the source.
      const rawDeletes: QuadLike[] = [];
      if (plan.form !== 'add') {
        rawDeletes.push(...(await enumerate(store, destination, plan.form, options.cap)));
      }
      if (plan.form === 'move') rawDeletes.push(...sourceQuads);

      return {
        record: { ...base, affectedCount: sourceQuads.length, enumerated: true },
        rawDeletes,
        rawInserts,
      };
    }
  }
}

/**
 * `COPY`/`MOVE`/`ADD` operands are a graph or the default graph.
 *
 * The grammar admits nothing else, but the plan's `GraphRef` is shared with
 * `CLEAR`/`DROP`, which do take `NAMED` and `ALL` — so this is the type
 * narrowing made explicit rather than assumed.
 */
function writableRef(ref: GraphRef, form: string): GraphRef {
  if (ref.kind === 'named' || ref.kind === 'all') {
    throw new UnsupportedUpdateError(`${form.toUpperCase()} cannot take ${ref.kind.toUpperCase()} as an operand`);
  }
  return ref;
}

function iriOf(ref: GraphRef): string | undefined {
  return ref.kind === 'iri' ? ref.value : undefined;
}

function sameRef(a: GraphRef, b: GraphRef): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'iri' || a.value === (b as { value: string }).value;
}

/** Enumerate a scope's quads, refusing rather than materialising past the cap. */
async function enumerate(
  store: DeltaStore,
  ref: GraphRef,
  form: string,
  cap: number,
): Promise<QuadLike[]> {
  const count = await countIn(store, ref);
  if (count > cap) {
    throw new EnumerationCapExceededError(
      `${form.toUpperCase()} would enumerate ${count} triples, over the cap of ${cap}. ` +
        'Raise the cap, or preview without enumeration and accept a counted graph operation.',
      count,
      cap,
    );
  }
  return quadsIn(store, ref);
}

/** How many triples a scope holds. */
async function countIn(store: DeltaStore, ref: GraphRef): Promise<number> {
  const rows = await store.select(`SELECT (COUNT(*) AS ?count) WHERE ${scopePattern(ref)}`);
  const value = rows[0]?.count;
  const parsed = value && 'value' in value ? Number.parseInt(value.value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Every quad in a scope, each stamped with the graph it came from.
 *
 * One caveat inherited from SPARQL rather than introduced here: a bare
 * `?s ?p ?o` asks for the *dataset's* default graph, and an endpoint is free to
 * define that as the union of everything it holds. Against such an endpoint
 * `CLEAR DEFAULT` enumerates more than the default graph — the same reading the
 * membership queries in `derive.ts` already depend on, and the reason
 * in-process Oxigraph, whose default graph is the default graph, is the
 * reference target.
 */
async function quadsIn(store: DeltaStore, ref: GraphRef): Promise<QuadLike[]> {
  switch (ref.kind) {
    case 'default': {
      const triples = await store.construct('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');
      return triples.map((quad) => withGraph(quad, undefined));
    }
    case 'iri': {
      const triples = await store.construct(
        `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${ref.value}> { ?s ?p ?o } }`,
      );
      return triples.map((quad) => withGraph(quad, ref.value));
    }
    case 'named': {
      const quads: QuadLike[] = [];
      for (const graph of await namedGraphs(store)) {
        quads.push(...(await quadsIn(store, { kind: 'iri', value: graph })));
      }
      return quads;
    }
    case 'all':
      return [
        ...(await quadsIn(store, { kind: 'default' })),
        ...(await quadsIn(store, { kind: 'named' })),
      ];
  }
}

/**
 * The named graphs that hold at least one triple.
 *
 * An empty named graph is invisible to this — as it is to every quad-level view
 * of the store — which is exactly why `CREATE` and `DROP` are recorded as
 * operations rather than reduced to the quads they move.
 */
async function namedGraphs(store: DeltaStore): Promise<string[]> {
  const rows = await store.select('SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }');
  const graphs: string[] = [];
  for (const row of rows) {
    const value = row.g;
    if (value && value.termType === 'NamedNode') graphs.push(value.value);
  }
  return graphs;
}

function scopePattern(ref: GraphRef): string {
  switch (ref.kind) {
    case 'default':
      return '{ ?s ?p ?o }';
    case 'iri':
      return `{ GRAPH <${ref.value}> { ?s ?p ?o } }`;
    case 'named':
      return '{ GRAPH ?g { ?s ?p ?o } }';
    case 'all':
      return '{ { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } }';
  }
}
