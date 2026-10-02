/**
 * The oracle the rewrite is tested against.
 *
 * A derivation like this one has an unusually strong test available to it:
 * apply the update to store A, apply the *derived patch* to an identical store
 * B, canonicalise both, and compare. If the two stores are isomorphic the
 * rewrite reproduced SPARQL Update semantics exactly, for that update and that
 * data — and if they are not, the mismatch is the counterexample.
 *
 * Canonicalisation (RDFC-1.1, via `rdf-canonize`) is what makes the comparison
 * meaningful in the presence of blank nodes: an update's templates and a patch's
 * additions mint different labels for the same structure, and only a canonical
 * form calls those equal.
 */

import * as oxigraph from 'oxigraph';
import rdfCanonize from 'rdf-canonize';
import {
  derivePatch,
  oxigraphDeltaStore,
  type DeltaStore,
  type DeriveOptions,
  type Patch,
  type QuadLike,
  type TermLike,
} from '../../src/index.js';

const NQUADS = 'application/n-quads';

export function storeFrom(nquads: string): oxigraph.Store {
  const store = new oxigraph.Store();
  if (nquads.trim()) store.load(nquads, { format: NQUADS });
  return store;
}

export function dump(store: oxigraph.Store): string {
  return store.dump({ format: NQUADS });
}

export async function canonical(store: oxigraph.Store): Promise<string> {
  const nquads = dump(store);
  if (!nquads.trim()) return '';
  return rdfCanonize.canonize(rdfCanonize.NQuads.parse(nquads), {
    algorithm: 'RDFC-1.0',
    format: NQUADS,
  });
}

/**
 * `sparql-only` drops the exact membership test, leaving the `VALUES`-batched
 * existence query — the path an HTTP backend takes, and the one where a
 * blank-node deletion candidate cannot be checked at all.
 *
 * `http` goes the rest of the way: it also relabels every blank node in every
 * result, per response, the way a results document does once it has been
 * serialised and parsed again. `sparql-only` still hands back Oxigraph's own
 * term objects, so a blank node there keeps its identity in the store — which
 * no HTTP backend's answer ever does.
 */
export type Membership = 'exact' | 'sparql-only' | 'http';

/**
 * `none` withholds the fork factory, which is how a backend that cannot be
 * copied looks from inside the package — and the configuration in which a
 * multi-operation program is still refused rather than simulated.
 */
export type Simulation = 'fork' | 'none';

export interface StoreOptions {
  membership?: Membership;
  simulation?: Simulation;
  /**
   * `http` only: query the default graph as the union of every graph, as
   * Fuseki's `unionDefaultGraph` and Stardog's `query.all.graphs` do. The store
   * does not say so, so derivation has to find out by probing.
   */
  unionDefaultGraph?: boolean;
}

export function deltaStoreFor(store: oxigraph.Store, options: StoreOptions = {}): DeltaStore {
  if (options.membership === 'http') return httpDeltaStoreFor(store, options);
  const delta = oxigraphDeltaStore(store, {
    createStore:
      (options.simulation ?? 'fork') === 'fork' ? () => new oxigraph.Store() : undefined,
  });
  if ((options.membership ?? 'exact') === 'exact') return delta;
  const { has: _has, ...queryOnly } = delta;
  return queryOnly;
}

/**
 * A store as an HTTP backend presents it: two SPARQL entry points and nothing
 * else — no membership test, no fork, no declared default-graph semantics —
 * and results whose blank-node labels are scoped to the response they came in.
 */
export function httpDeltaStoreFor(
  store: oxigraph.Store,
  options: Pick<StoreOptions, 'unionDefaultGraph'> = {},
): DeltaStore {
  const queryOptions = options.unionDefaultGraph ? { use_default_graph_as_union: true } : {};
  let responses = 0;
  return {
    async construct(sparql: string): Promise<QuadLike[]> {
      const relabel = relabeller(++responses);
      return (store.query(sparql, queryOptions) as unknown as QuadLike[]).map((quad) => ({
        subject: relabel(quad.subject),
        predicate: relabel(quad.predicate),
        object: relabel(quad.object),
        graph: quad.graph,
      }));
    },
    async select(sparql: string): Promise<Array<Record<string, TermLike>>> {
      const relabel = relabeller(++responses);
      const rows = store.query(sparql, queryOptions) as unknown as Array<Map<string, TermLike>>;
      return rows.map((row) =>
        Object.fromEntries([...row].map(([variable, term]) => [variable, relabel(term)])),
      );
    },
  };
}

/** Consistent within one response, fresh across responses — as a parser mints them. */
function relabeller(response: number): (term: TermLike) => TermLike {
  const relabel = (term: TermLike): TermLike => {
    if (term.termType === 'BlankNode') return { termType: 'BlankNode', value: `r${response}x${term.value}` };
    if (term.termType === 'Quad' || term.termType === 'Triple') {
      return {
        termType: term.termType,
        subject: relabel(term.subject),
        predicate: relabel(term.predicate),
        object: relabel(term.object),
      };
    }
    return term;
  };
  return relabel;
}

export function patchFor(
  store: oxigraph.Store,
  update: string,
  options: StoreOptions & DeriveOptions = {},
): Promise<Patch> {
  const { membership, simulation, unionDefaultGraph, ...derive } = options;
  return derivePatch(update, deltaStoreFor(store, { membership, simulation, unionDefaultGraph }), derive);
}

/**
 * Apply a patch through the store API.
 *
 * Deliberately not via `patchToSparqlUpdate`: that form cannot carry blank
 * nodes, and the cases where blank nodes appear are exactly the ones worth
 * testing. `patchToSparqlUpdate` gets its own round-trip test on the patches
 * that are ground.
 */
export function applyPatch(store: oxigraph.Store, patch: Patch): void {
  for (const quad of patch.deletions) store.delete(toOxigraphQuad(quad));
  for (const quad of patch.additions) store.add(toOxigraphQuad(quad));
}

function toOxigraphQuad(quad: QuadLike): oxigraph.Quad {
  const graph = quad.graph;
  const graphTerm =
    graph && graph.termType === 'NamedNode' && graph.value
      ? oxigraph.namedNode(graph.value)
      : oxigraph.defaultGraph();
  return oxigraph.quad(
    toOxigraphTerm(quad.subject) as oxigraph.Quad['subject'],
    toOxigraphTerm(quad.predicate) as oxigraph.Quad['predicate'],
    toOxigraphTerm(quad.object) as oxigraph.Quad['object'],
    graphTerm,
  );
}

/**
 * Oxigraph's own terms pass through untouched — that is what keeps a blank
 * node's identity when the patch came from the store itself. A plain term,
 * which is what an HTTP-shaped store hands back, is rebuilt; a blank node
 * rebuilt from its label is a *new* node, exactly as it would be over HTTP.
 */
function toOxigraphTerm(term: TermLike): unknown {
  if (!Object.getPrototypeOf(term) || Object.getPrototypeOf(term) === Object.prototype) {
    switch (term.termType) {
      case 'NamedNode':
        return oxigraph.namedNode(term.value);
      case 'BlankNode':
        return oxigraph.blankNode(term.value);
      case 'Literal':
        return term.language
          ? oxigraph.literal(term.value, term.language)
          : oxigraph.literal(term.value, term.datatype ? oxigraph.namedNode(term.datatype.value) : undefined);
      case 'Quad':
      case 'Triple':
        return oxigraph.triple(
          toOxigraphTerm(term.subject) as oxigraph.Quad['subject'],
          toOxigraphTerm(term.predicate) as oxigraph.Quad['predicate'],
          toOxigraphTerm(term.object) as oxigraph.Quad['object'],
        );
      default:
        return oxigraph.defaultGraph();
    }
  }
  return term;
}

export interface EquivalenceCase extends StoreOptions, DeriveOptions {
  name: string;
  data: string;
  update: string;
}

/**
 * Direct execution and patch application must leave isomorphic stores.
 * Returns the patch so a caller can additionally assert on its shape.
 */
export async function assertEquivalent(testCase: EquivalenceCase): Promise<Patch> {
  const direct = storeFrom(testCase.data);
  const viaPatch = storeFrom(testCase.data);

  const { name: _name, data: _data, update: _update, ...options } = testCase;
  const patch = await patchFor(viaPatch, testCase.update, options);
  direct.update(testCase.update);
  applyPatch(viaPatch, patch);

  const [expected, actual] = await Promise.all([canonical(direct), canonical(viaPatch)]);
  if (expected !== actual) {
    throw new Error(
      `${testCase.name}: direct execution and patch application disagree.\n` +
        `--- update ---\n${testCase.update}\n` +
        `--- direct ---\n${expected}\n--- via patch ---\n${actual}\n`,
    );
  }
  return patch;
}
