/**
 * Runs queries over an in-memory Oxigraph store in worker threads, and stops a
 * worker when its query passes the deadline.
 *
 * `Store.query` is synchronous. On the main thread one slow query holds the
 * event loop until it ends: no deadline can stop it, and every other request
 * waits. With `SQLIB_QUERY_WORKERS` above 0, `oxigraphExecutor()` returns an
 * executor that sends each query to a worker holding a copy of the store
 * (`lib/queryWorker.ts`). At `SQLIB_EXECUTION_TIMEOUT_MS` the worker is
 * terminated, and the query fails with 504.
 *
 * - A worker loads the store from an N-Quads dump. It is reused for the next
 *   query on the same store, while the store has not changed.
 * - Updates run on the main thread's store. The next query sees the change
 *   and loads a fresh copy.
 * - At most `SQLIB_QUERY_WORKERS` queries run at once. A query that waits for
 *   a slot spends its own deadline waiting.
 */
import { isMainThread, Worker } from 'node:worker_threads';
import type * as oxigraph from 'oxigraph';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import type { SparqlQueryOptions } from '../server/ISparqlExecutor.js';
import { executionDeadlineMs, queryWorkers } from '../config/executionLimits.js';
import { abortReason, executionSignal, raceAbort } from './cancellation.js';
import { storeWriteCount } from './storeWrites.js';
import { WarmWorkers, WORKER_RESOURCE_LIMITS, workerSource } from './warmWorkers.js';

export type QueryMethod = 'selectQueryParsed' | 'constructQueryParsed' | 'askQuery';

/** The query options that cross to a worker. A signal cannot. */
type WorkerQueryOptions = Pick<SparqlQueryOptions, 'acceptHeader' | 'dataset'>;

export type QueryWorkerRequest =
  | { id: number; type: 'load'; nquads: string }
  | { id: number; type: 'call'; method: QueryMethod; query: string; options: WorkerQueryOptions };

/** A request before `send` numbers it. */
type UnnumberedRequest =
  | { type: 'load'; nquads: string }
  | { type: 'call'; method: QueryMethod; query: string; options: WorkerQueryOptions };

export type QueryWorkerReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; message: string };

/** How long an idle copy stays loaded before its worker ends. */
const IDLE_MS = 60_000;

const warm = new WarmWorkers(() => {
  const { url, execArgv } = workerSource(
    import.meta.url,
    new URL('./queryWorker.ts', import.meta.url),
    new URL('./queryWorker.js', import.meta.url),
  );
  return new Worker(url, { execArgv, resourceLimits: WORKER_RESOURCE_LIMITS });
});

/** The store's state, as far as a loaded copy must match it. */
function versionOf(store: oxigraph.Store): string {
  return `${storeWriteCount(store)}:${store.size}`;
}

/** One worker holding one copy of a store. */
class StoreCopy {
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private idleTimer: NodeJS.Timeout | null = null;
  private dead = false;

  constructor(private readonly worker: Worker, readonly store: oxigraph.Store, readonly version: string) {
    live += 1;
    worker.on('message', (reply: QueryWorkerReply) => {
      const waiter = this.pending.get(reply.id);
      if (!waiter) return;
      this.pending.delete(reply.id);
      if (reply.ok) waiter.resolve(reply.result);
      else waiter.reject(new Error(reply.message));
    });
    const fail = (error: Error) => {
      this.markDead();
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', code => fail(new Error(`The query worker stopped (exit ${code}).`)));
  }

  get alive(): boolean {
    return !this.dead;
  }

  send(request: UnnumberedRequest): Promise<unknown> {
    if (this.dead) return Promise.reject(new Error('The query worker has stopped.'));
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id });
    });
  }

  /** Parked between queries: it must not keep the process alive. */
  park(onExpire: () => void): void {
    this.worker.unref();
    this.idleTimer = setTimeout(onExpire, IDLE_MS);
    this.idleTimer.unref();
  }

  unpark(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.worker.ref();
  }

  terminate(): void {
    this.unpark();
    this.markDead();
    void this.worker.terminate();
  }

  private markDead(): void {
    if (this.dead) return;
    this.dead = true;
    live -= 1;
  }
}

/**
 * Loaded copies not running a query, oldest first. With the busy ones they
 * number at most `SQLIB_QUERY_WORKERS`: a new copy first ends the oldest idle
 * one, of any store, so memory stays bounded by the setting.
 */
const idle: StoreCopy[] = [];
/** Copies alive: busy, idle or loading. */
let live = 0;
/** Stores whose copies must end when they come back: `releaseIsolatedStore`. */
const released = new WeakSet<oxigraph.Store>();
/** The last dump of each store, by version, so a burst of queries dumps once. */
const dumps = new WeakMap<oxigraph.Store, { version: string; nquads: string }>();

let busy = 0;
const waiting: Array<() => void> = [];

function dumpOf(store: oxigraph.Store, version: string): string {
  const cached = dumps.get(store);
  if (cached?.version === version) return cached.nquads;
  const nquads = store.size === 0 ? '' : store.dump({ format: 'nq' });
  dumps.set(store, { version, nquads });
  return nquads;
}

/** Waits for a free slot, or for `signal`. */
function acquireSlot(signal: AbortSignal): Promise<void> {
  if (busy < queryWorkers()) {
    busy += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const at = waiting.indexOf(grant);
      if (at >= 0) waiting.splice(at, 1);
      reject(abortReason(signal));
    };
    const grant = () => {
      signal.removeEventListener('abort', onAbort);
      busy += 1;
      resolve();
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    waiting.push(grant);
  });
}

function releaseSlot(): void {
  busy -= 1;
  waiting.shift()?.();
}

function removeIdle(copy: StoreCopy): void {
  const at = idle.indexOf(copy);
  if (at >= 0) idle.splice(at, 1);
}

/** The newest idle copy of `store` at `version`, taken out of the pool. */
function takeIdle(store: oxigraph.Store, version: string): StoreCopy | null {
  for (let at = idle.length - 1; at >= 0; at -= 1) {
    const copy = idle[at];
    if (copy.store !== store) continue;
    idle.splice(at, 1);
    copy.unpark();
    if (copy.alive && copy.version === version) return copy;
    copy.terminate();
  }
  return null;
}

/** A new copy of `store`, after ending idle copies until it fits the limit. */
function newCopy(store: oxigraph.Store, version: string): StoreCopy {
  while (live >= queryWorkers() && idle.length > 0) idle.shift()!.terminate();
  return new StoreCopy(warm.take(), store, version);
}

function park(copy: StoreCopy): void {
  if (!copy.alive || released.has(copy.store) || copy.version !== versionOf(copy.store) || live > queryWorkers()) {
    copy.terminate();
    return;
  }
  idle.push(copy);
  copy.park(() => {
    removeIdle(copy);
    copy.terminate();
  });
}

/** Workers alive and idle now. For tests and diagnostics. */
export function isolatedQueryStats(): { live: number; idle: number; busy: number } {
  return { live, idle: idle.length, busy };
}

/** Ends every idle copy of `store`, and each busy one when its query ends. */
export function releaseIsolatedStore(store: oxigraph.Store): void {
  released.add(store);
  for (const copy of idle.filter(candidate => candidate.store === store)) {
    removeIdle(copy);
    copy.terminate();
  }
}

export async function runIsolatedQuery(
  store: oxigraph.Store,
  method: QueryMethod,
  query: string,
  options: SparqlQueryOptions | undefined,
): Promise<unknown> {
  const stop = executionSignal(options?.signal, executionDeadlineMs());
  try {
    await acquireSlot(stop.signal);
    let copy: StoreCopy | null = null;
    try {
      const version = versionOf(store);
      copy = takeIdle(store, version);
      if (!copy) {
        copy = newCopy(store, version);
        await raceAbort(copy.send({ type: 'load', nquads: dumpOf(store, version) }), stop.signal);
      }
      const result = await raceAbort(
        copy.send({
          type: 'call',
          method,
          query,
          options: { acceptHeader: options?.acceptHeader, dataset: options?.dataset },
        }),
        stop.signal,
      );
      return result;
    } finally {
      // A query stopped by the deadline or the caller may still be running, so
      // its worker ends. After a result or a query error the copy is reused.
      if (copy) {
        if (stop.signal.aborted) copy.terminate();
        else park(copy);
      }
      releaseSlot();
    }
  } finally {
    stop.dispose();
  }
}

/** An Oxigraph executor whose queries run in worker threads. */
export class IsolatedOxigraphSparqlExecutor extends OxigraphSparqlExecutor {
  constructor(private readonly source: oxigraph.Store) {
    super(source);
  }

  override selectQueryParsed(query: string, options?: SparqlQueryOptions) {
    return runIsolatedQuery(this.source, 'selectQueryParsed', query, options) as ReturnType<
      OxigraphSparqlExecutor['selectQueryParsed']
    >;
  }

  override constructQueryParsed(query: string, options?: SparqlQueryOptions) {
    return runIsolatedQuery(this.source, 'constructQueryParsed', query, options) as ReturnType<
      OxigraphSparqlExecutor['constructQueryParsed']
    >;
  }

  override askQuery(query: string, options?: SparqlQueryOptions) {
    return runIsolatedQuery(this.source, 'askQuery', query, options) as ReturnType<OxigraphSparqlExecutor['askQuery']>;
  }
}

/**
 * The executor for an in-memory store that serves callers' queries: isolated
 * when `SQLIB_QUERY_WORKERS` is above 0, on this thread otherwise. A worker
 * thread always gets the plain one.
 */
export function oxigraphExecutor(store: oxigraph.Store): OxigraphSparqlExecutor {
  return isMainThread && queryWorkers() > 0 ? new IsolatedOxigraphSparqlExecutor(store) : new OxigraphSparqlExecutor(store);
}
