/**
 * The POC-3 harness, checked rather than trusted.
 *
 * A POC's numbers are only worth as much as the thing that produced them, so
 * the parts of `poc/` that can be wrong in a way a timing would not reveal are
 * pinned here: the conditional-write protocol the emulator models, the two
 * properties the round trip claims about fidelity, and — the one that matters —
 * that a rebase which *re-derives* lands a different graph from one that
 * replays the patch it computed before the race. If those agreed, the design
 * argument in `poc/blobSnapshot.ts` would be decoration.
 *
 * Deliberately small graphs throughout. This suite is about behaviour; the
 * sizes live in the harness, which is not run by CI.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as oxigraph from 'oxigraph';

import { derivePatch, oxigraphDeltaStore, patchToSparqlUpdate } from '../src/index.js';
import type { OxigraphStoreLike } from '../src/index.js';
import { expectedConflictStatus, startBlobEmulator, type BlobEmulator } from '../poc/blobEmulator.js';
import {
  contentDigest,
  getSnapshot,
  putSnapshot,
  rebaseAndRetry,
  restoreGraph,
  snapshotGraph,
} from '../poc/blobSnapshot.js';

const GRAPH = oxigraph.namedNode('http://ex/g');
const OTHER = oxigraph.namedNode('http://ex/other');
const P = 'http://ex/p';

let emulator: BlobEmulator | undefined;

afterEach(async () => {
  await emulator?.close();
  emulator = undefined;
});

function storeWith(quads: Array<[string, string, string, string]>): oxigraph.Store {
  const store = new oxigraph.Store();
  store.load(
    quads.map(([s, p, o, g]) => `<${s}> <${p}> "${o}" <${g}> .\n`).join(''),
    { format: 'application/n-quads' },
  );
  return store;
}

function seeded(count: number, graph = GRAPH.value): oxigraph.Store {
  return storeWith(
    Array.from({ length: count }, (_, i) => [`http://ex/s/${i}`, P, `v-${i}`, graph] as const).map(
      (row) => [...row] as [string, string, string, string],
    ),
  );
}

describe('the conditional-write protocol', () => {
  it.each(['azure', 's3'] as const)('%s: a create lands, and a second create is refused', async (dialect) => {
    emulator = await startBlobEmulator(dialect);
    const body = Buffer.from('<http://ex/s> <http://ex/p> "v" .\n');

    const created = await putSnapshot(emulator.url, 'g', body, { ifNoneMatch: '*' });
    expect(created.status).toBe(201);
    expect(created.etag).toBeTruthy();

    const again = await putSnapshot(emulator.url, 'g', body, { ifNoneMatch: '*' });
    expect(again.status).toBe(expectedConflictStatus(dialect, 'if-none-match'));
  });

  /**
   * The reason both dialects are modelled at all. §8 decision 3 of the
   * topologies note is still open, and this is what it costs to get wrong: a
   * caller that matches on 412 handles every refusal Azure will ever send it
   * *except* the one its first checkpoint of a new graph produces.
   */
  it('the two services disagree, and only on create-if-absent', async () => {
    expect(expectedConflictStatus('azure', 'if-none-match')).toBe(409);
    expect(expectedConflictStatus('s3', 'if-none-match')).toBe(412);
    expect(expectedConflictStatus('azure', 'if-match')).toBe(expectedConflictStatus('s3', 'if-match'));
  });

  it.each(['azure', 's3'] as const)('%s: a stale etag is refused and a current one lands', async (dialect) => {
    emulator = await startBlobEmulator(dialect);
    const first = Buffer.from('<http://ex/s> <http://ex/p> "one" .\n');
    const second = Buffer.from('<http://ex/s> <http://ex/p> "two" .\n');

    const created = await putSnapshot(emulator.url, 'g', first, { ifNoneMatch: '*' });
    const stale = await putSnapshot(emulator.url, 'g', second, { ifMatch: '"not-the-etag"' });
    expect(stale.status).toBe(412);

    const fresh = await putSnapshot(emulator.url, 'g', second, { ifMatch: created.etag! });
    expect(fresh.status).toBe(200);
    expect(fresh.etag).not.toBe(created.etag);

    const read = await getSnapshot(emulator.url, 'g');
    expect(read.body?.toString()).toBe(second.toString());
  });

  it('an overwrite of a blob that is gone is refused, not turned into a create', async () => {
    emulator = await startBlobEmulator('azure');
    const outcome = await putSnapshot(emulator.url, 'absent', Buffer.from('x'), { ifMatch: '"any"' });
    expect(outcome.status).toBe(412);
    expect(emulator.peek('absent')).toBeUndefined();
  });

  it('azure mints a fresh etag for identical bytes', async () => {
    emulator = await startBlobEmulator('azure');
    const body = Buffer.from('<http://ex/s> <http://ex/p> "v" .\n');
    const first = await putSnapshot(emulator.url, 'g', body, { ifNoneMatch: '*' });
    const second = await putSnapshot(emulator.url, 'g', body, { ifMatch: first.etag! });
    expect(second.etag).not.toBe(first.etag);
  });
});

describe('the snapshot round trip', () => {
  it('carries the named graph and nothing else in the store', async () => {
    const store = seeded(5);
    store.load('<http://ex/z> <http://ex/p> "elsewhere" <http://ex/other> .\n', {
      format: 'application/n-quads',
    });

    const snapshot = await snapshotGraph(store, GRAPH);
    expect(snapshot.body.toString()).not.toContain('elsewhere');

    const restored = new oxigraph.Store();
    const result = await restoreGraph(restored, GRAPH, snapshot.body);
    expect(result.quads).toBe(5);
    expect(restored.match(null, null, null, OTHER)).toHaveLength(0);
  });

  it('restores the same content', async () => {
    const source = seeded(20);
    const snapshot = await snapshotGraph(source, GRAPH);
    const restored = new oxigraph.Store();
    await restoreGraph(restored, GRAPH, snapshot.body);
    const reDump = await snapshotGraph(restored, GRAPH);
    expect(await contentDigest(reDump.body)).toBe(await contentDigest(snapshot.body));
  });

  /**
   * The finding, as a test rather than a sentence: `dump` emits the store's
   * insertion order, so the bytes are not a function of the graph. A checkpoint
   * loop must therefore not compare its own output — or a hash of it — against
   * the last blob to decide whether anything changed, and two servers holding
   * one graph will not agree on the blob they would write for it.
   */
  it('does not restore the same bytes, because dump order follows insertion', async () => {
    const forwards = seeded(20);
    const snapshot = await snapshotGraph(forwards, GRAPH);

    const backwards = new oxigraph.Store();
    await restoreGraph(backwards, GRAPH, snapshot.body);
    const reDump = await snapshotGraph(backwards, GRAPH);

    expect(reDump.body.equals(snapshot.body)).toBe(false);
    expect(await contentDigest(reDump.body)).toBe(await contentDigest(snapshot.body));
  });

  it('contentDigest ignores order and notices content', async () => {
    const a = Buffer.from('<http://ex/1> <http://ex/p> "x" .\n<http://ex/2> <http://ex/p> "y" .\n');
    const b = Buffer.from('<http://ex/2> <http://ex/p> "y" .\n<http://ex/1> <http://ex/p> "x" .\n');
    const c = Buffer.from('<http://ex/1> <http://ex/p> "x" .\n');
    expect(await contentDigest(a)).toBe(await contentDigest(b));
    expect(await contentDigest(a)).not.toBe(await contentDigest(c));
  });
});

describe('two writers, one loses', () => {
  const winnerUpdate =
    `INSERT DATA { GRAPH <${GRAPH.value}> { ` +
    `<http://ex/new/1> <${P}> "extra" . <http://ex/new/2> <${P}> "extra" . } }`;
  const loserUpdate = `DELETE WHERE { GRAPH <${GRAPH.value}> { ?s <${P}> "extra" } }`;

  async function raceToLoss(): Promise<{ key: string; seedBody: Buffer; sharedEtag: string }> {
    const key = 'contended';
    const seed = seeded(10);
    const seedSnapshot = await snapshotGraph(seed, GRAPH);
    const created = await putSnapshot(emulator!.url, key, seedSnapshot.body, { ifNoneMatch: '*' });

    const winner = new oxigraph.Store();
    await restoreGraph(winner, GRAPH, seedSnapshot.body);
    winner.update(winnerUpdate);
    const winnerSnapshot = await snapshotGraph(winner, GRAPH);
    const landed = await putSnapshot(emulator!.url, key, winnerSnapshot.body, { ifMatch: created.etag! });
    expect(landed.status).toBe(200);

    return { key, seedBody: seedSnapshot.body, sharedEtag: created.etag! };
  }

  it('the loser is refused on the etag it read', async () => {
    emulator = await startBlobEmulator('azure');
    const { key, seedBody, sharedEtag } = await raceToLoss();

    const loser = new oxigraph.Store();
    await restoreGraph(loser, GRAPH, seedBody);
    loser.update(loserUpdate);
    const refused = await putSnapshot(emulator.url, key, (await snapshotGraph(loser, GRAPH)).body, {
      ifMatch: sharedEtag,
    });
    expect(refused.status).toBe(412);
  });

  it('re-deriving lands the graph a sequential apply would have produced', async () => {
    emulator = await startBlobEmulator('azure');
    const { key, seedBody } = await raceToLoss();

    const rebase = await rebaseAndRetry({
      baseUrl: emulator.url,
      key,
      graph: GRAPH,
      update: loserUpdate,
      createStore: () => new oxigraph.Store(),
    });
    expect(rebase.attempts).toBe(2);
    expect(rebase.deletions).toBe(2);

    const oracle = new oxigraph.Store();
    await restoreGraph(oracle, GRAPH, seedBody);
    oracle.update(winnerUpdate);
    oracle.update(loserUpdate);

    const landed = await getSnapshot(emulator.url, key);
    expect(await contentDigest(landed.body!)).toBe(await contentDigest((await snapshotGraph(oracle, GRAPH)).body));
  });

  /**
   * Why the rebase re-derives instead of replaying.
   *
   * The loser's patch against the state it *read* is empty — nothing there
   * carried `"extra"`. Replaying that patch onto the winner's state would land
   * the winner's two quads intact, which is not what `DELETE WHERE` means. This
   * pins the two apart, so a later "optimisation" that caches the first
   * derivation fails here rather than in someone's graph.
   */
  it('replaying the pre-race patch would land a different graph', async () => {
    emulator = await startBlobEmulator('azure');
    const { key, seedBody } = await raceToLoss();

    const asRead = new oxigraph.Store();
    await restoreGraph(asRead, GRAPH, seedBody);
    const preRace = await derivePatch(loserUpdate, oxigraphDeltaStore(asRead as unknown as OxigraphStoreLike));
    expect(preRace.deletionCount).toBe(0);

    // Replay: take the winner's state and apply the patch derived before it.
    const winnersState = await getSnapshot(emulator.url, key);
    const replayed = new oxigraph.Store();
    await restoreGraph(replayed, GRAPH, winnersState.body!);
    if (preRace.additionCount > 0 || preRace.deletionCount > 0) {
      replayed.update(patchToSparqlUpdate(preRace));
    }

    const oracle = new oxigraph.Store();
    await restoreGraph(oracle, GRAPH, seedBody);
    oracle.update(winnerUpdate);
    oracle.update(loserUpdate);

    const replayedDigest = await contentDigest((await snapshotGraph(replayed, GRAPH)).body);
    const oracleDigest = await contentDigest((await snapshotGraph(oracle, GRAPH)).body);
    expect(replayedDigest).not.toBe(oracleDigest);

    // And re-deriving does agree with the oracle — same input, other strategy.
    await rebaseAndRetry({
      baseUrl: emulator.url,
      key,
      graph: GRAPH,
      update: loserUpdate,
      createStore: () => new oxigraph.Store(),
    });
    const landed = await getSnapshot(emulator.url, key);
    expect(await contentDigest(landed.body!)).toBe(oracleDigest);
  });

  it('gives up by name rather than looping forever', async () => {
    emulator = await startBlobEmulator('azure');
    const key = 'never-settles';
    await putSnapshot(emulator.url, key, (await snapshotGraph(seeded(3), GRAPH)).body, { ifNoneMatch: '*' });

    // A competing writer lands between every GET and PUT the rebase makes, so
    // the etag it read is always one behind. The interfering writes go through
    // `original` rather than the helpers, which would re-enter this hook.
    const original = globalThis.fetch;
    let interfering = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT' && !interfering) {
        interfering = true;
        try {
          const read = await original(`${emulator!.url}/${key}`);
          const body = Buffer.from(await read.arrayBuffer());
          await original(`${emulator!.url}/${key}`, {
            method: 'PUT',
            headers: { 'if-match': read.headers.get('etag')! },
            body: Buffer.concat([body, Buffer.from(`<http://ex/x/${Date.now()}> <${P}> "n" .\n`)]) as never,
          });
        } finally {
          interfering = false;
        }
      }
      return original(input as never, init);
    }) as typeof fetch;

    try {
      await expect(
        rebaseAndRetry({
          baseUrl: emulator.url,
          key,
          graph: GRAPH,
          update: `INSERT DATA { GRAPH <${GRAPH.value}> { <http://ex/mine> <${P}> "v" } }`,
          createStore: () => new oxigraph.Store(),
          maxAttempts: 3,
        }),
      ).rejects.toThrow(/gave up on never-settles after 3 attempts/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
