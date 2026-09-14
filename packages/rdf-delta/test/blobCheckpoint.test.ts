/**
 * The blob sink's storage half, checked at the level a sink is wrong at.
 *
 * `blobSnapshot.test.ts` pins POC-3's harness — the protocol the emulator
 * models, and the rebase re-deriving rather than replaying. This suite is about
 * the promoted sink instead, and about the three things it does that the
 * harness did not:
 *
 * 1. **It skips.** A checkpoint whose content has not moved must not write,
 *    because the write is a stop rather than a cost — and it must decide that
 *    on the content, since the bytes are not a function of the graph.
 * 2. **It folds.** Azure refuses a create with 409 and S3 with 412, and a sink
 *    that could tell them apart would be a sink with a vendor in it.
 * 3. **It reports the ceiling.** A dump that traps inside wasm is catchable, so
 *    the graph that will not fit is named rather than crashing the process.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as oxigraph from 'oxigraph';

import {
  BlobStoreError,
  RebaseExhaustedError,
  SnapshotCapacityError,
  checkpointGraph,
  contentDigest,
  dumpGraph,
  httpConditionalBlobStore,
  loadGraph,
  memoryConditionalBlobStore,
  rebaseAndRetry,
} from '../src/index.js';
import type { BlobFetch, BlobResponseLike, RebaseStoreLike } from '../src/index.js';
import { expectedConflictStatus, startBlobEmulator, type BlobEmulator } from '../poc/blobEmulator.js';
import { putSnapshot } from '../poc/blobSnapshot.js';

const GRAPH = oxigraph.namedNode('http://ex/g');
const OTHER = oxigraph.namedNode('http://ex/other');
const P = 'http://ex/p';
const KEY = 'graph-g';

let emulator: BlobEmulator | undefined;

afterEach(async () => {
  await emulator?.close();
  emulator = undefined;
});

function storeOf(values: number[], graph = GRAPH.value): RebaseStoreLike {
  const store = new oxigraph.Store();
  store.load(values.map((i) => `<http://ex/s/${i}> <${P}> "v-${i}" <${graph}> .\n`).join(''), {
    format: 'application/n-quads',
  });
  return store as unknown as RebaseStoreLike;
}

describe('a graph checkpointed to its blob', () => {
  it('is a create the first time and a replace after', async () => {
    const blobs = memoryConditionalBlobStore();
    const store = storeOf([1, 2, 3]);

    const first = await checkpointGraph({ store, graph: GRAPH, blobs, key: KEY });
    expect(first.outcome).toBe('stored');
    if (first.outcome !== 'stored') return;

    (store as unknown as oxigraph.Store).update(
      `INSERT DATA { GRAPH <${GRAPH.value}> { <http://ex/s/4> <${P}> "v-4" } }`,
    );
    const second = await checkpointGraph({ store, graph: GRAPH, blobs, key: KEY, etag: first.etag });
    expect(second.outcome).toBe('stored');
    expect(second).not.toMatchObject({ digest: first.digest });
  });

  it('carries the named graph and nothing else the store holds', async () => {
    const blobs = memoryConditionalBlobStore();
    const store = storeOf([1, 2]);
    (store as unknown as oxigraph.Store).load(`<http://ex/z> <${P}> "elsewhere" <${OTHER.value}> .\n`, {
      format: 'application/n-quads',
    });

    await checkpointGraph({ store, graph: GRAPH, blobs, key: KEY });
    const stored = blobs.peek(KEY)!;
    expect(new TextDecoder().decode(stored.body)).not.toContain('elsewhere');
  });

  /**
   * The skip, and why it is a rule rather than an optimisation.
   *
   * A dump is a synchronous call into wasm, so a checkpoint that writes an
   * unchanged graph is not a wasted PUT — it is an outage on a cadence. POC-3
   * measured 1,611 ms for a 1M-quad store.
   */
  it('does not write when the content has not moved', async () => {
    const blobs = memoryConditionalBlobStore();
    const store = storeOf([1, 2, 3]);

    const first = await checkpointGraph({ store, graph: GRAPH, blobs, key: KEY });
    if (first.outcome !== 'stored') throw new Error('expected the first checkpoint to store');
    const etagAfterFirst = blobs.peek(KEY)!.etag;

    const second = await checkpointGraph({
      store,
      graph: GRAPH,
      blobs,
      key: KEY,
      etag: first.etag,
      lastDigest: first.digest,
    });
    expect(second.outcome).toBe('unchanged');
    // Not merely "reported unchanged": nothing reached the store, so the ETag
    // the caller holds is still the live one.
    expect(blobs.peek(KEY)!.etag).toBe(etagAfterFirst);
  });

  /**
   * And the skip is decided on content, not bytes.
   *
   * `dump` emits insertion order, so a store rebuilt from a snapshot writes
   * different bytes for the same graph. A sink comparing bytes would checkpoint
   * every tick after any restart, which is the pause it exists to avoid.
   */
  it('sees a graph rebuilt in another order as unchanged', async () => {
    const blobs = memoryConditionalBlobStore();
    const forwards = storeOf([1, 2, 3, 4, 5, 6, 7, 8]);

    const first = await checkpointGraph({ store: forwards, graph: GRAPH, blobs, key: KEY });
    if (first.outcome !== 'stored') throw new Error('expected the first checkpoint to store');

    const rebuilt = storeOf([]);
    loadGraph(rebuilt, GRAPH, blobs.peek(KEY)!.body);
    expect(Buffer.from(dumpGraph(rebuilt, GRAPH)).equals(Buffer.from(blobs.peek(KEY)!.body))).toBe(false);

    const second = await checkpointGraph({
      store: rebuilt,
      graph: GRAPH,
      blobs,
      key: KEY,
      etag: first.etag,
      lastDigest: first.digest,
    });
    expect(second.outcome).toBe('unchanged');
  });

  it('reports a stale etag as a conflict rather than throwing', async () => {
    const blobs = memoryConditionalBlobStore();
    const store = storeOf([1]);
    await checkpointGraph({ store, graph: GRAPH, blobs, key: KEY });

    const conflicted = await checkpointGraph({ store: storeOf([2]), graph: GRAPH, blobs, key: KEY, etag: '"stale"' });
    expect(conflicted).toMatchObject({ outcome: 'conflict', status: 412 });
  });

  it('reports a create over an existing blob as a conflict', async () => {
    const blobs = memoryConditionalBlobStore();
    await checkpointGraph({ store: storeOf([1]), graph: GRAPH, blobs, key: KEY });

    // No etag: the caller believes this graph has never been checkpointed. It
    // has, so the write is refused rather than landing on top of it.
    const conflicted = await checkpointGraph({ store: storeOf([2]), graph: GRAPH, blobs, key: KEY });
    expect(conflicted.outcome).toBe('conflict');
    expect(new TextDecoder().decode(blobs.peek(KEY)!.body)).toContain('v-1');
  });
});

describe('the ceiling', () => {
  const trapping = (error: unknown): RebaseStoreLike =>
    ({
      dump(): string {
        throw error;
      },
      load(): void {
        throw error;
      },
      query: () => undefined,
      match: () => [],
      update: () => undefined,
    }) as unknown as RebaseStoreLike;

  it.each([
    ['a wasm trap', new WebAssembly.RuntimeError('unreachable')],
    ['a string too long for V8', new RangeError('Invalid string length')],
  ])('names the graph when the dump hits %s', async (_label, error) => {
    expect(() => dumpGraph(trapping(error), GRAPH)).toThrow(SnapshotCapacityError);
    try {
      dumpGraph(trapping(error), GRAPH);
    } catch (thrown) {
      expect((thrown as SnapshotCapacityError).graph).toBe(GRAPH.value);
      expect((thrown as SnapshotCapacityError).cause).toBe(error);
    }
  });

  /**
   * The other half, and the reason `isCapacityFailure` is a list rather than a
   * catch-all: a parse failure reported as a size problem would send a caller
   * partitioning a graph that is already small.
   */
  it('rethrows a failure that is not the ceiling', () => {
    const parseError = new Error('expected "." at line 3');
    expect(() => loadGraph(trapping(parseError), GRAPH, new Uint8Array())).toThrow(parseError);
  });
});

describe('the two dialects, through the port', () => {
  it.each(['azure', 's3'] as const)('%s: a refused create is one outcome, whatever the status', async (dialect) => {
    emulator = await startBlobEmulator(dialect);
    const blobs = httpConditionalBlobStore({ baseUrl: emulator.url, fetch: fetch as unknown as BlobFetch });

    const first = await checkpointGraph({ store: storeOf([1]), graph: GRAPH, blobs, key: KEY });
    expect(first.outcome).toBe('stored');

    const second = await checkpointGraph({ store: storeOf([2]), graph: GRAPH, blobs, key: KEY });
    expect(second.outcome).toBe('conflict');
    if (second.outcome !== 'conflict') return;

    // The raw probe still sees the difference the port hides — which is the
    // point: the status is reported, and no decision is taken on it.
    expect(second.status).toBe(expectedConflictStatus(dialect, 'if-none-match'));
    const raw = await putSnapshot(emulator.url, KEY, Buffer.from(''), { ifNoneMatch: '*' });
    expect(raw.status).toBe(second.status);
  });

  it('a replace of a blob that is gone is refused, not turned into a create', async () => {
    emulator = await startBlobEmulator('s3');
    const blobs = httpConditionalBlobStore({ baseUrl: emulator.url, fetch: fetch as unknown as BlobFetch });

    const outcome = await checkpointGraph({
      store: storeOf([1]),
      graph: GRAPH,
      blobs,
      key: 'never-existed',
      etag: '"whatever"',
    });
    expect(outcome).toMatchObject({ outcome: 'conflict', status: 412 });
  });

  function respondingWith(response: Partial<BlobResponseLike> & { status: number }): BlobFetch {
    return async () =>
      ({
        status: response.status,
        headers: response.headers ?? { get: () => null },
        text: response.text ?? (async () => ''),
        arrayBuffer: response.arrayBuffer ?? (async () => new ArrayBuffer(0)),
      }) as BlobResponseLike;
  }

  /**
   * 409 is folded where Azure sends it and nowhere else. On other operations
   * and other services it means a genuine conflict, and a sink reading those as
   * "somebody beat me to it" would rebase against a state nobody wrote.
   */
  it('does not fold a 409 on a replace', async () => {
    const blobs = httpConditionalBlobStore({
      baseUrl: 'http://blobs.invalid',
      fetch: respondingWith({ status: 409 }),
    });
    await expect(blobs.put(KEY, new Uint8Array(), { kind: 'replace', etag: '"e"' })).rejects.toThrow(BlobStoreError);
  });

  it('does not fold a server error into a lost race', async () => {
    const blobs = httpConditionalBlobStore({
      baseUrl: 'http://blobs.invalid',
      fetch: respondingWith({ status: 503 }),
    });
    await expect(blobs.put(KEY, new Uint8Array(), { kind: 'create' })).rejects.toMatchObject({ status: 503 });
  });

  /**
   * Azure reports its code in a header as well as the body, and an error
   * response can arrive with the header and no body at all — which is what
   * `poc/blobSnapshot.ts` could not read, so it reported `undefined` for
   * exactly the refusal it existed to explain.
   */
  it('reads the error code from the header when the body is empty', async () => {
    const blobs = httpConditionalBlobStore({
      baseUrl: 'http://blobs.invalid',
      fetch: respondingWith({
        status: 409,
        headers: { get: (name: string) => (name === 'x-ms-error-code' ? 'BlobAlreadyExists' : null) },
      }),
    });
    await expect(blobs.put(KEY, new Uint8Array(), { kind: 'create' })).resolves.toMatchObject({
      outcome: 'precondition-failed',
      code: 'BlobAlreadyExists',
    });
  });
});

describe('a rebase against a blob that is not there', () => {
  /**
   * The harness threw here, which is right for a POC whose blob it created
   * itself and wrong for a sink: the graph then has no checkpoint at all, and
   * refusing to write one leaves it that way.
   */
  it('creates it rather than refusing', async () => {
    const blobs = memoryConditionalBlobStore();
    const result = await rebaseAndRetry({
      blobs,
      key: KEY,
      graph: GRAPH,
      update: `INSERT DATA { GRAPH <${GRAPH.value}> { <http://ex/s/1> <${P}> "v-1" } }`,
      createStore: () => storeOf([]),
    });

    expect(result.attempts).toBe(1);
    expect(result.additions).toBe(1);
    expect(await contentDigest(blobs.peek(KEY)!.body)).toBe(result.digest);
  });

  it('gives up by name when the blob keeps moving', async () => {
    const blobs = memoryConditionalBlobStore();
    await blobs.put(KEY, new Uint8Array(), { kind: 'create' });

    // Every read hands back an ETag that a competing write has already retired.
    const racing = {
      get: async () => ({ outcome: 'found' as const, body: new Uint8Array(), etag: '"gone"' }),
      put: async () => ({ outcome: 'precondition-failed' as const, status: 412 }),
    };

    await expect(
      rebaseAndRetry({
        blobs: racing,
        key: KEY,
        graph: GRAPH,
        update: `INSERT DATA { GRAPH <${GRAPH.value}> { <http://ex/s/1> <${P}> "v-1" } }`,
        createStore: () => storeOf([]),
        maxAttempts: 2,
      }),
    ).rejects.toBeInstanceOf(RebaseExhaustedError);
  });
});
