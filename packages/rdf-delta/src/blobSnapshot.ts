/**
 * One named graph, checkpointed to a blob and restored from it.
 *
 * This is the storage half of the blob sink — MVP-3's other sink, beside the
 * DuckDB log (`patchLog.ts`). It takes the graph as the unit of
 * serialization, the unit of addressing and the unit of contention, all three
 * at once, which is what makes a checkpoint cost the graph that changed
 * rather than the store it lives in.
 *
 * The measurements that gate it come from the blob-snapshot proof of concept
 * under `poc/`, and three of its findings shape the code here rather than
 * merely reporting a number:
 *
 * 1. **A dump is a stop, not a cost.** `Store.dump` is a synchronous call into
 *    wasm — ~16 ms per MB at 0.7 MB, 42–48 ms/MB above 100 MB — and the process
 *    answers nothing while it is in there. So a checkpoint that writes anyway
 *    is not merely wasteful, it is an outage; hence `unchanged` below.
 * 2. **A snapshot round-trips its content, not its bytes.** `dump` emits
 *    insertion order, so a graph reloaded from a snapshot dumps different bytes
 *    from the graph it was taken of. A checkpoint therefore cannot hash its own
 *    output to detect "nothing changed" — {@link contentDigest} hashes the
 *    sorted lines, which is the same question asked of the content.
 * 3. **The ceiling traps rather than throwing.** Above ~6M quads the dump ends
 *    in `RuntimeError: unreachable` inside wasm, and it *is* catchable, so a
 *    checkpoint can report rather than crash — {@link SnapshotCapacityError}.
 *
 * Nothing here imports Oxigraph, `fs` or a vendor SDK: the store is taken
 * structurally and storage is the {@link ConditionalBlobStore} port, so the same
 * code checkpoints a server's store to a bucket and a browser's to IndexedDB.
 */

import { derivePatch } from './derive.js';
import { oxigraphDeltaStore, type OxigraphStoreLike } from './oxigraph.js';
import { patchToSparqlUpdate } from './patch.js';
import type { BlobPutCondition, ConditionalBlobStore } from './blobStore.js';

/** N-Triples, because a per-graph blob does not repeat its own graph name. */
export const SNAPSHOT_FORMAT = 'application/n-triples';

/**
 * The store's own term for a graph.
 *
 * Passed through to `dump`/`load` untouched — it is Oxigraph's `NamedNode`, or
 * whatever the caller's store answers with — and read only to name the graph in
 * an error.
 */
export interface GraphNameLike {
  readonly value: string;
}

/**
 * The subset of a store a snapshot uses.
 *
 * Wider than {@link OxigraphStoreLike}'s optional `dump`/`load` in two ways that
 * matter: the graph arguments, without which a checkpoint would cost the whole
 * store, and `load` taking bytes. Oxigraph's own `.d.ts` declares `load` as
 * taking a string, and its wasm accepts bytes — which is not a nicety, because
 * a snapshot above `String::kMaxLength` cannot be *made* into a string at all
 * (#436), so a restore path that asks for one has a ceiling it never needed.
 */
export interface SnapshotStoreLike {
  dump(options: { format: string; from_graph_name?: unknown }): string;
  load(data: string | Uint8Array, options: { format: string; to_graph_name?: unknown }): void;
}

/** A dump or load that ran out of room inside wasm rather than failing cleanly. */
export class SnapshotCapacityError extends Error {
  /** The graph being serialized, which is the thing that has to get smaller. */
  readonly graph: string;
  readonly cause?: unknown;

  constructor(message: string, graph: string, cause?: unknown) {
    super(message);
    this.name = 'SnapshotCapacityError';
    this.graph = graph;
    this.cause = cause;
  }
}

/**
 * Was this failure the ceiling, or a real error?
 *
 * Three spellings, because the ceiling is reached in three places: wasm's own
 * trap when the serialized graph will not fit in its 4 GiB (`unreachable`),
 * V8's refusal to make a string that long (`Invalid string length`, the #436
 * case), and an allocation failure on the way out. Anything else is rethrown
 * unchanged — a parse error in a restore is not a size problem, and reporting
 * it as one would send a caller partitioning a graph that is already small.
 */
function isCapacityFailure(error: unknown): boolean {
  if (typeof WebAssembly !== 'undefined' && error instanceof WebAssembly.RuntimeError) return true;
  if (error instanceof RangeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /unreachable|invalid string length|out of memory|allocation failed/i.test(message);
}

const encoder = new TextEncoder();

/**
 * Serialize one named graph.
 *
 * Synchronous, and deliberately so: it is the pause, and a caller that wants to
 * measure it (`poc/blobSnapshot.ts`) has to be able to wrap the call itself
 * rather than a promise around it.
 */
export function dumpGraph(store: SnapshotStoreLike, graph: GraphNameLike): Uint8Array {
  try {
    return encoder.encode(store.dump({ format: SNAPSHOT_FORMAT, from_graph_name: graph }));
  } catch (error) {
    if (isCapacityFailure(error)) {
      throw new SnapshotCapacityError(
        `snapshot of <${graph.value}> exceeded what the store can serialize in one call`,
        graph.value,
        error,
      );
    }
    throw error;
  }
}

/** Parse a snapshot back into a named graph. */
export function loadGraph(store: SnapshotStoreLike, graph: GraphNameLike, body: Uint8Array): void {
  try {
    store.load(body, { format: SNAPSHOT_FORMAT, to_graph_name: graph });
  } catch (error) {
    if (isCapacityFailure(error)) {
      throw new SnapshotCapacityError(
        `snapshot of <${graph.value}> exceeded what the store can parse in one call`,
        graph.value,
        error,
      );
    }
    throw error;
  }
}

/**
 * A digest of the graph's *content*, independent of how the store came by it.
 *
 * Byte equality is the wrong test, and that is a finding rather than an
 * inconvenience: two stores holding exactly the same graph — one loaded from a
 * snapshot, one built by running the updates — dump different bytes, because
 * `dump` emits insertion order. Sorting the lines asks the question the caller
 * meant.
 *
 * WebCrypto rather than `node:crypto`, so this runs wherever the package does.
 */
export async function contentDigest(body: Uint8Array): Promise<string> {
  const lines = new TextDecoder().decode(body).split('\n').filter(Boolean);
  lines.sort();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(lines.join('\n')));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface CheckpointInputs {
  store: SnapshotStoreLike;
  graph: GraphNameLike;
  blobs: ConditionalBlobStore;
  /** The blob this graph lives in. One key per graph is the partitioning scheme. */
  key: string;
  /**
   * The ETag the caller holds for that blob.
   *
   * Absent means "this graph has never been checkpointed", and the write is a
   * create — the one case where the two vendors' refusals disagree, which is
   * why the port folds them rather than the caller.
   */
  etag?: string;
  /**
   * The {@link contentDigest} of the last checkpoint, when the caller kept it.
   *
   * This is what turns finding 2 into a rule: a checkpoint loop cannot compare
   * its bytes to the stored ones, but it can compare the content it is about to
   * write to the content it wrote last time, and skip the pause when they
   * agree.
   */
  lastDigest?: string;
}

export type CheckpointOutcome =
  | { readonly outcome: 'stored'; readonly etag?: string; readonly digest: string; readonly bytes: number }
  | { readonly outcome: 'unchanged'; readonly digest: string; readonly bytes: number }
  | { readonly outcome: 'conflict'; readonly status: number; readonly code?: string; readonly digest: string };

/**
 * Write one graph's current state to its blob, if it has moved.
 *
 * A conflict is returned rather than thrown, and is not an error: it is the
 * ordinary outcome of two writers sharing a graph, and what the caller does
 * about it — {@link rebaseAndRetry}, or give up and let the next tick try — is
 * the caller's decision. The digest comes back with it, so a caller that
 * retries does not pay for the sort twice.
 */
export async function checkpointGraph(inputs: CheckpointInputs): Promise<CheckpointOutcome> {
  const body = dumpGraph(inputs.store, inputs.graph);
  const digest = await contentDigest(body);

  if (inputs.lastDigest && inputs.lastDigest === digest) {
    return { outcome: 'unchanged', digest, bytes: body.byteLength };
  }

  const condition: BlobPutCondition =
    inputs.etag === undefined ? { kind: 'create' } : { kind: 'replace', etag: inputs.etag };
  const put = await inputs.blobs.put(inputs.key, body, condition);

  if (put.outcome === 'precondition-failed') {
    return { outcome: 'conflict', status: put.status, code: put.code, digest };
  }
  return { outcome: 'stored', etag: put.etag, digest, bytes: body.byteLength };
}

/** A rebase that kept losing. Typed, because "how many attempts" is the diagnosis. */
export class RebaseExhaustedError extends Error {
  readonly key: string;
  readonly attempts: number;

  constructor(key: string, attempts: number) {
    super(`rebase: gave up on ${key} after ${attempts} attempts`);
    this.name = 'RebaseExhaustedError';
    this.key = key;
    this.attempts = attempts;
  }
}

/**
 * A store a rebase can drive: snapshot it, read it, and advance it.
 *
 * Spelled out rather than intersected with {@link OxigraphStoreLike}, whose
 * `dump`/`load` are optional and narrower — an intersection of the two would
 * read as an overload set and resolve calls by declaration order, which is a
 * subtle way to end up parsing bytes through the string signature.
 */
export interface RebaseStoreLike extends SnapshotStoreLike {
  query(query: string, options?: Record<string, unknown>): unknown;
  match(subject?: unknown, predicate?: unknown, object?: unknown, graph?: unknown): unknown[];
  update(update: string, options?: Record<string, unknown>): void;
}

export interface RebaseInputs {
  blobs: ConditionalBlobStore;
  key: string;
  graph: GraphNameLike;
  /** The update this writer is trying to land. */
  update: string;
  /**
   * How to make an empty store — a rebase reloads the winner's state into one.
   *
   * The store is made rather than reused because the loser's own store holds a
   * state that lost: see below.
   */
  createStore: () => RebaseStoreLike;
  maxAttempts?: number;
}

export interface RebaseResult {
  /** How many conditional writes it took, the successful one included. */
  attempts: number;
  etag?: string;
  digest: string;
  /** Quads the re-derivation found, against the state the winner left. */
  additions: number;
  deletions: number;
}

/**
 * Land an update against a blob another writer moved underneath it.
 *
 * The rebase **re-derives** rather than replaying the quads it computed the
 * first time, and that is the whole correctness argument: a patch is the ground
 * effect of an update *against a particular state*, so a writer that reapplied
 * its first patch would be asserting the old state's answer about the new one.
 * POC-3's harness is the smallest version of that — the loser's `DELETE WHERE`
 * derives 0 deletions against the state it read and 2 against the state it lost
 * to, and only the second is what the update means. So the loser's own mutated
 * store is not an input here; the work it represents is redone.
 *
 * The cost is the finding: a rebase is a read, a full parse, a derivation and a
 * full dump — 4.4× the uncontended checkpoint. Since the blob is also the
 * contention unit, one number bounds both.
 *
 * A blob that has gone missing between attempts is created rather than treated
 * as unreadable. `poc/blobSnapshot.ts` threw there, which is right for a
 * harness whose blob it created itself, and wrong for a sink: the graph then
 * has no checkpoint at all, and refusing to write one leaves it that way.
 */
export async function rebaseAndRetry(inputs: RebaseInputs): Promise<RebaseResult> {
  const maxAttempts = inputs.maxAttempts ?? 5;
  let additions = 0;
  let deletions = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const current = await inputs.blobs.get(inputs.key);

    // The winner's state, parsed into a store of this writer's own.
    const rebased = inputs.createStore();
    if (current.outcome === 'found') {
      if (current.etag === undefined) {
        // Without a token there is nothing to write against, and writing
        // anyway would be the unconditional overwrite the port exists to make
        // unrepresentable. A store that answers a read with no ETag cannot
        // host a contended graph, and saying so beats losing one.
        throw new Error(`rebase: ${inputs.key} was read without an ETag to write against`);
      }
      if (current.body.byteLength > 0) loadGraph(rebased, inputs.graph, current.body);
    }

    // Re-derive against it, then apply. `createStore` is passed through because
    // a multi-operation program needs to fork to be derived at all.
    const deltaStore = oxigraphDeltaStore(rebased, { createStore: () => inputs.createStore() });
    const patch = await derivePatch(inputs.update, deltaStore);
    additions = patch.additionCount;
    deletions = patch.deletionCount;

    if (patch.applyMode !== 'ground-sparql') {
      throw new Error(`rebase: patch is ${patch.applyMode}, which a blob snapshot cannot land as SPARQL`);
    }
    if (patch.additionCount > 0 || patch.deletionCount > 0) {
      rebased.update?.(patchToSparqlUpdate(patch));
    }

    const checkpoint = await checkpointGraph({
      store: rebased,
      graph: inputs.graph,
      blobs: inputs.blobs,
      key: inputs.key,
      etag: current.outcome === 'found' ? current.etag : undefined,
    });

    if (checkpoint.outcome === 'stored') {
      return { attempts: attempt, etag: checkpoint.etag, digest: checkpoint.digest, additions, deletions };
    }
    // `unchanged` is unreachable here — no `lastDigest` is passed, precisely
    // because a rebase must write even when its re-derivation turns out to be a
    // no-op: the ETag it is racing for is the thing being claimed.
  }

  throw new RebaseExhaustedError(inputs.key, maxAttempts);
}
