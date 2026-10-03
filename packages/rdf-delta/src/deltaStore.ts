/**
 * What this package needs of a store.
 *
 * Two read-only SPARQL entry points are the floor, and they are all the
 * single-operation rewrite ever uses — which is the point: derivation is a read,
 * so anything that can answer a query can be previewed against.
 *
 * The two optional members are capabilities, not conveniences, and a store that
 * lacks one gets a different answer rather than a wrong one:
 *
 * - **`has`** lifts the net effect from "sound for ground quads" to exact. A
 *   quad carrying a blank node cannot be named in SPARQL text, so a store
 *   reachable only over SPARQL cannot be *asked* whether it holds one. Without
 *   `has` such candidates are kept and the patch reports `netEffectExact: false`.
 * - **`fork`** is what makes multi-operation programs previewable at all. When
 *   operation N reads what N−1 wrote, the only faithful way to derive N is
 *   against the state N−1 left — so the program is replayed on a private copy.
 *   Without `fork`, such a program is refused by name instead of mis-previewed.
 *
 * In-process Oxigraph offers all four, which is why it is the reference target.
 *
 * **`unionDefaultGraph`** is a fact about the store rather than a capability:
 * whether its default graph answers queries as the union of every graph, as
 * Fuseki's `unionDefaultGraph`, Stardog's `query.all.graphs` and GraphDB's
 * defaults do. On such a store `?s ?p ?o` finds a triple that only a named graph
 * holds, so asking it whether the default graph holds a quad needs a different
 * question. Left undefined, derivation probes for it once — see
 * `probeUnionDefaultGraph`.
 */

import type { QuadLike, TermLike } from './terms.js';

export interface DeltaStore {
  construct(sparql: string): Promise<QuadLike[]>;
  select(sparql: string): Promise<Array<Record<string, TermLike>>>;
  /** Exact membership, including for quads carrying blank nodes. */
  has?(quad: QuadLike): Promise<boolean> | boolean;
  /** A private, mutable copy of this store, for simulating a program. */
  fork?(): Promise<SimulationStore>;
  /** Whether the default graph is queried as the union of all graphs. Probed when absent. */
  unionDefaultGraph?: boolean;
}

/**
 * A throwaway copy of a store, which may be written to.
 *
 * `update` takes the operation as written rather than a derived diff: replaying
 * the SPARQL is the only way to advance the copy that is faithful for *every*
 * form, graph-management operations included, and the copy is discarded
 * afterwards so nothing it does is observable.
 */
export interface SimulationStore extends DeltaStore {
  update(sparql: string): Promise<void> | void;
  /** Release whatever the copy holds. Called even when derivation throws. */
  close?(): Promise<void> | void;
}
