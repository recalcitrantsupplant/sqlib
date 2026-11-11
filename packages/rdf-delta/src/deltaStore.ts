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
 */

import type { QuadLike, TermLike } from './terms.js';

/**
 * A run-time dataset: the graphs `FROM` / `FROM NAMED` (on a read) or
 * `USING` / `USING NAMED` (on an update) would name. An absent part of a
 * dataset that gives the other part has no graphs (SPARQL 1.1 Query §13.2).
 */
export interface DeltaDataset {
  defaultGraphs?: string[];
  namedGraphs?: string[];
}

/** Options of a derived read. */
export interface DeltaReadOptions {
  /** The update's dataset, applied to a read derived from its `WHERE` clause. */
  dataset?: DeltaDataset;
}

export interface DeltaStore {
  construct(sparql: string, options?: DeltaReadOptions): Promise<QuadLike[]>;
  select(sparql: string, options?: DeltaReadOptions): Promise<Array<Record<string, TermLike>>>;
  /** Exact membership, including for quads carrying blank nodes. */
  has?(quad: QuadLike): Promise<boolean> | boolean;
  /** A private, mutable copy of this store, for simulating a program. */
  fork?(): Promise<SimulationStore>;
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
  update(sparql: string, options?: { dataset?: DeltaDataset }): Promise<void> | void;
  /** True when `update` applies `options.dataset`. A dataset is refused otherwise. */
  supportsUpdateDataset?: boolean;
  /** Release whatever the copy holds. Called even when derivation throws. */
  close?(): Promise<void> | void;
}
