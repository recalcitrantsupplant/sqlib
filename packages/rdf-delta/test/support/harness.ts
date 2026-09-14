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
 */
export type Membership = 'exact' | 'sparql-only';

/**
 * `none` withholds the fork factory, which is how a backend that cannot be
 * copied looks from inside the package — and the configuration in which a
 * multi-operation program is still refused rather than simulated.
 */
export type Simulation = 'fork' | 'none';

export interface StoreOptions {
  membership?: Membership;
  simulation?: Simulation;
}

export function deltaStoreFor(store: oxigraph.Store, options: StoreOptions = {}): DeltaStore {
  const delta = oxigraphDeltaStore(store, {
    createStore:
      (options.simulation ?? 'fork') === 'fork' ? () => new oxigraph.Store() : undefined,
  });
  if ((options.membership ?? 'exact') === 'exact') return delta;
  const { has: _has, ...queryOnly } = delta;
  return queryOnly;
}

export function patchFor(
  store: oxigraph.Store,
  update: string,
  options: StoreOptions & DeriveOptions = {},
): Promise<Patch> {
  const { membership, simulation, ...derive } = options;
  return derivePatch(update, deltaStoreFor(store, { membership, simulation }), derive);
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

function toOxigraphQuad(quad: { subject: unknown; predicate: unknown; object: unknown; graph?: unknown }): oxigraph.Quad {
  const graph = quad.graph as { termType?: string; value?: string } | null | undefined;
  const graphTerm =
    graph && graph.termType === 'NamedNode' && graph.value
      ? oxigraph.namedNode(graph.value)
      : oxigraph.defaultGraph();
  return oxigraph.quad(
    quad.subject as oxigraph.Quad['subject'],
    quad.predicate as oxigraph.Quad['predicate'],
    quad.object as oxigraph.Quad['object'],
    graphTerm,
  );
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
