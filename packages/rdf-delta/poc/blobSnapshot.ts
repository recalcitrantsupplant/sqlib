/**
 * POC-3's harness: the checkpoint, timed.
 *
 * The logic this file used to hold was promoted to `src/blobSnapshot.ts` when
 * the topology survived — the same move `poc/patchLogSql.ts` made for POC-2's
 * SQL, and for the same reason: a second copy is a copy that drifts from the
 * sink's. What is left here is what a POC is actually for and a sink must not
 * carry, the **measurement**.
 *
 * The one deliberate duplicate is {@link putSnapshot}/{@link getSnapshot}. The
 * sink's HTTP store folds a refused conditional write into one outcome, which
 * is the right answer for a caller and the wrong one for a probe: what POC-3
 * had to find out is *which status each service sends*, and a helper that hides
 * it could not have found the 409/412 disagreement in the first place. These
 * two are that probe, and `test/blobCheckpoint.test.ts` pins the folded view
 * against the same emulator so the pair cannot disagree in silence.
 *
 * Nothing here imports Fastify or touches the repository's own store manager.
 * The shape it models is `OxigraphStoreManager.serializeDurableStore` with the
 * `.nq` file replaced by a conditional blob and the whole store replaced by one
 * graph — which is the difference option C proposes, and the only difference.
 */

import { gzipSync } from 'node:zlib';
import type * as oxigraph from 'oxigraph';

import {
  contentDigest,
  dumpGraph,
  httpConditionalBlobStore,
  loadGraph,
  rebaseAndRetry as rebaseCheckpoint,
  type BlobFetch,
  type RebaseStoreLike,
} from '../src/index.js';

export { contentDigest };

export interface BlockingMeasurement<T> {
  value: T;
  /** Wall clock across the call. */
  elapsedMs: number;
  /**
   * How long a `setTimeout(…, 0)` scheduled immediately beforehand was starved.
   *
   * This is the number that distinguishes a 3-second checkpoint from a
   * 3-second outage. Oxigraph's `dump` is a synchronous call into wasm, so the
   * process answers no query, accepts no connection and runs no timer while it
   * is in there — and a checkpoint on a cadence makes that pause periodic.
   */
  loopBlockedMs: number;
  /** The same timer's latency measured immediately beforehand, with no work. */
  controlMs: number;
}

/** How long a `setTimeout(…, 0)` takes to fire with nothing in its way. */
async function idleTimerLatency(): Promise<number> {
  const scheduledAt = performance.now();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return performance.now() - scheduledAt;
}

/** Run `fn`, timing it and measuring how long it starved the event loop. */
export async function measureBlocking<T>(fn: () => T): Promise<BlockingMeasurement<T>> {
  // A timer never fires at exactly 0ms, and a large synchronous allocation can
  // provoke a collection that delays it further. Taking the idle latency first
  // means `loopBlockedMs` is read against a control from the same moment in the
  // same process, rather than against an assumed zero.
  const controlMs = await idleTimerLatency();

  const scheduledAt = performance.now();
  let ranAt = Number.NaN;
  const timerFired = new Promise<void>((resolve) => {
    setTimeout(() => {
      ranAt = performance.now();
      resolve();
    }, 0);
  });

  const startedAt = performance.now();
  const value = fn();
  const elapsedMs = performance.now() - startedAt;

  await timerFired;
  return { value, elapsedMs, loopBlockedMs: ranAt - scheduledAt, controlMs };
}

export interface SnapshotResult {
  body: Buffer;
  bytes: number;
  gzipBytes: number;
  dumpMs: number;
  dumpLoopBlockedMs: number;
  timerControlMs: number;
  gzipMs: number;
}

/**
 * Serialize one named graph, timed.
 *
 * `from_graph_name` is what makes the partitioning question worth asking at
 * all: if it scanned the store, splitting a dataset into graphs would buy
 * nothing, because every graph's checkpoint would cost the whole dataset. The
 * run measures that it does not — one graph out of twenty costs what the same
 * graph costs alone.
 */
export async function snapshotGraph(
  store: oxigraph.Store,
  graph: oxigraph.NamedNode,
  options: { compress?: boolean } = {},
): Promise<SnapshotResult> {
  const dump = await measureBlocking(() => dumpGraph(store as unknown as RebaseStoreLike, graph));
  const body = Buffer.from(dump.value);

  let gzipBytes = 0;
  let gzipMs = 0;
  if (options.compress) {
    const t0 = performance.now();
    gzipBytes = gzipSync(body).byteLength;
    gzipMs = performance.now() - t0;
  }

  return {
    body,
    bytes: body.byteLength,
    gzipBytes,
    dumpMs: dump.elapsedMs,
    dumpLoopBlockedMs: dump.loopBlockedMs,
    timerControlMs: dump.controlMs,
    gzipMs,
  };
}

export interface RestoreResult {
  loadMs: number;
  loadLoopBlockedMs: number;
  timerControlMs: number;
  quads: number;
}

/**
 * Parse a snapshot back into a named graph, timed.
 *
 * The bytes are handed over as a `Buffer`, not a string. Above `String::
 * kMaxLength` a snapshot cannot be *made* into a string at all (#436), so a
 * restore path that asks for one has a ceiling it never needed — and the one
 * in `OxigraphStoreManager` reads its `.nq` file as `utf8` today.
 */
export async function restoreGraph(
  store: oxigraph.Store,
  graph: oxigraph.NamedNode,
  body: Buffer,
): Promise<RestoreResult> {
  const before = store.size;
  const load = await measureBlocking(() => loadGraph(store as unknown as RebaseStoreLike, graph, body));
  return {
    loadMs: load.elapsedMs,
    loadLoopBlockedMs: load.loopBlockedMs,
    timerControlMs: load.controlMs,
    quads: store.size - before,
  };
}

// --- the raw protocol probe -------------------------------------------------

export interface PutOutcome {
  status: number;
  etag?: string;
  /** The service's error code, when the conditional write was refused. */
  code?: string;
}

export interface ConditionalPut {
  /** Overwrite only if the blob still carries this ETag. */
  ifMatch?: string;
  /** Create only if the blob does not exist. */
  ifNoneMatch?: '*';
}

export async function putSnapshot(
  baseUrl: string,
  key: string,
  body: Buffer,
  condition: ConditionalPut,
): Promise<PutOutcome> {
  const headers: Record<string, string> = { 'content-type': 'application/n-triples' };
  if (condition.ifNoneMatch) headers['if-none-match'] = condition.ifNoneMatch;
  else if (condition.ifMatch) headers['if-match'] = condition.ifMatch;

  const response = await fetch(`${baseUrl}/${key}`, { method: 'PUT', headers, body: body as unknown as BodyInit });
  if (response.status >= 400) {
    const text = await response.text();
    return { status: response.status, code: /<Code>([^<]+)<\/Code>/.exec(text)?.[1] };
  }
  return { status: response.status, etag: response.headers.get('etag') ?? undefined };
}

export interface GetOutcome {
  status: number;
  body?: Buffer;
  etag?: string;
}

export async function getSnapshot(baseUrl: string, key: string): Promise<GetOutcome> {
  const response = await fetch(`${baseUrl}/${key}`);
  if (response.status !== 200) return { status: response.status };
  return {
    status: 200,
    body: Buffer.from(await response.arrayBuffer()),
    etag: response.headers.get('etag') ?? undefined,
  };
}

// --- the losing writer ------------------------------------------------------

export interface RebaseResult {
  /** How many conditional PUTs it took, the PUT that lost and the one that landed included. */
  attempts: number;
  etag: string;
  /** Time in the rebase itself: fetch, reload, re-derive, re-apply, re-dump. */
  rebaseMs: number;
  /** Quads the re-derivation found, against the state the winner left. */
  additions: number;
  deletions: number;
}

export interface RebaseInputs {
  baseUrl: string;
  key: string;
  graph: oxigraph.NamedNode;
  /** The update this writer is trying to land. */
  update: string;
  /** How to make an empty store — a rebase reloads the winner's state into one. */
  createStore: () => oxigraph.Store;
  maxAttempts?: number;
}

/**
 * Land an update against a blob another writer moved underneath it, timed.
 *
 * The rebase itself is `src/blobSnapshot.ts`; the argument for why it
 * re-derives rather than replaying is there, and `test/blobSnapshot.test.ts`
 * pins the two apart. What this adds is the wall clock — the cost is the
 * finding, 4.4× the uncontended dump — and the harness's own numbering, which
 * counts the PUT that lost as attempt 1 because that is what the caller here
 * already spent.
 */
export async function rebaseAndRetry(inputs: RebaseInputs): Promise<RebaseResult> {
  const startedAt = performance.now();
  const result = await rebaseCheckpoint({
    blobs: httpBlobStore(inputs.baseUrl),
    key: inputs.key,
    graph: inputs.graph,
    update: inputs.update,
    createStore: () => inputs.createStore() as unknown as RebaseStoreLike,
    maxAttempts: inputs.maxAttempts,
  });

  return {
    attempts: result.attempts + 1,
    etag: result.etag ?? '',
    rebaseMs: performance.now() - startedAt,
    additions: result.additions,
    deletions: result.deletions,
  };
}

function httpBlobStore(baseUrl: string): ReturnType<typeof httpConditionalBlobStore> {
  return httpConditionalBlobStore({ baseUrl, fetch: fetch as unknown as BlobFetch });
}
