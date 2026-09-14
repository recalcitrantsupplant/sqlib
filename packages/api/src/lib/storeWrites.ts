/**
 * A monotonic write counter per in-process Oxigraph store.
 *
 * This exists so the periodic checkpoint can tell a durable store that has
 * been written since its last snapshot from one that has not. The distinction
 * is worth a module because a checkpoint is not cheap and not asynchronous:
 * `Store.dump` runs synchronously inside wasm, so a store of a million quads
 * stops every request in flight for ~3.7 s — once a minute, on a store nobody
 * has touched, to write a file identical to the one already on disk (#443).
 *
 * **Why a counter and not a comparison.** `store.size` cannot answer the
 * question: a `DELETE`/`INSERT` of equal counts changes the store and not its
 * size. Hashing the content means dumping it, which is the cost being avoided.
 * The only sound signal available is the writes themselves, so they are
 * recorded as they happen.
 *
 * **Why a `WeakMap` keyed on the store.** The store object is the thing that
 * gets written — it is handed out by `OxigraphStoreManager` and held by
 * long-lived executors (`ExecutorFactory` caches them), so a writer generally
 * does not know which backend id, if any, it is writing to. Keying on the
 * object means a writer needs no such knowledge, and a dropped store takes its
 * entry with it.
 *
 * **The counter only ever increases**, which is what makes it safe to read
 * before a dump and record afterwards: a write that lands *during* the dump
 * raises the count past the recorded one, so the next checkpoint runs rather
 * than skipping a change it did not capture.
 *
 * Everything that mutates a manager-owned store must call `markStoreWritten`.
 * Today that is `OxigraphSparqlExecutor.update`, `OxigraphStoreManager`'s own
 * load paths, and `hydrateStoreFromDataGraphs`;
 * `test/lib/storeWriteSites.test.ts` fails if a fourth appears, because a write
 * path that forgets to say so is a checkpoint that skips a change.
 */

/** The store surface this module needs: nothing. Identity is the whole key. */
type StoreKey = object;

const writeCounts = new WeakMap<StoreKey, number>();

/**
 * Record that `store` was mutated.
 *
 * Cheap by design — one map write — because it sits on the update path of
 * every SPARQL write the process makes.
 */
export function markStoreWritten(store: StoreKey): void {
  writeCounts.set(store, (writeCounts.get(store) ?? 0) + 1);
}

/**
 * How many recorded writes this store has taken.
 *
 * A store that has never been written reads 0, which is also what a store
 * restored from its snapshot reads — correctly, since the snapshot and the
 * store then agree.
 */
export function storeWriteCount(store: StoreKey): number {
  return writeCounts.get(store) ?? 0;
}
