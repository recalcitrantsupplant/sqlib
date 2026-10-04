/**
 * Version numbers under concurrency, and without a preloaded cache.
 *
 * Every version writer read the highest number and then wrote the next with
 * nothing in between, so overlapping saves of one entity took the same number;
 * and with `CACHE_PRELOAD=false` the cache did not see versions an earlier
 * process wrote, so numbering restarted at 1. `allocateVersion` holds a
 * per-parent lock across the read, the create and the pointer flip, and asks
 * the store when the cache is not the whole picture.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ScenarioTestBaseUnmocked,
  type ScenarioTestContext,
} from '../scenarios/fixtures/scenario-test-base-unmocked.js';
import { getCacheCoordinator } from '../../src/lib/CacheCoordinatorProvider.js';
import { allocateVersion } from '../../src/lib/versionNumbering.js';

describe('version allocation', () => {
  let context: ScenarioTestContext;
  let writeThroughBefore: string | undefined;

  const createQuery = async (name: string): Promise<string> => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: { name, isPartOf: [context.libraryId] },
    });
    expect(response.statusCode, response.payload).toBe(201);
    return response.json().id as string;
  };

  const saveVersion = (queryId: string, n: number) =>
    context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(queryId)}/versions`,
      payload: { queryVersion: { queryString: `SELECT * WHERE { ?s ?p ${n} }` } },
    });

  beforeAll(async () => {
    writeThroughBefore = process.env.CACHE_WRITE_THROUGH;
    // The harness runs without preload, which is the case the store fallback is
    // for; write-through puts the versions where that fallback looks.
    context = await ScenarioTestBaseUnmocked.createTestContext('version-allocation');
    process.env.CACHE_WRITE_THROUGH = 'true';
    await ScenarioTestBaseUnmocked.createLibrary(context, 'library');
  }, 60000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
    if (writeThroughBefore === undefined) delete process.env.CACHE_WRITE_THROUGH;
    else process.env.CACHE_WRITE_THROUGH = writeThroughBefore;
  });

  it('numbers ten concurrent saves 1..10 and points at the last', async () => {
    const queryId = await createQuery('concurrent');

    const responses = await Promise.all(Array.from({ length: 10 }, (_, n) => saveVersion(queryId, n)));

    for (const response of responses) expect(response.statusCode, response.payload).toBe(201);
    const versions = getCacheCoordinator()
      .list('QueryVersion')
      .filter(version => version.isPartOf === queryId);
    expect(versions.map(version => version.version).sort((a, b) => Number(a) - Number(b)))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const current = getCacheCoordinator().get(getCacheCoordinator().get(queryId)?.currentVersion as string);
    expect(current?.version).toBe(10);
  });

  it('continues from the store after the cache forgets, rather than restarting at 1', async () => {
    const queryId = await createQuery('restarted');
    for (let n = 0; n < 3; n++) expect((await saveVersion(queryId, n)).statusCode).toBe(201);

    // What a restart without preload looks like: the versions are in the
    // store and nowhere in the cache.
    const coordinator = getCacheCoordinator();
    for (const version of coordinator.list('QueryVersion').filter(v => v.isPartOf === queryId)) {
      coordinator.cache.delete(version.$id);
    }

    expect(await allocateVersion('QueryVersion', queryId, async version => version)).toBe(4);
  });

  it('serialises writers for one parent and leaves other parents alone', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });

    const first = allocateVersion('QueryVersion', 'urn:test:parent:a', async version => {
      order.push(`a${version} start`);
      await firstHeld;
      order.push(`a${version} end`);
    });
    const second = allocateVersion('QueryVersion', 'urn:test:parent:a', async version => {
      order.push(`a${version} start`);
    });
    const other = allocateVersion('QueryVersion', 'urn:test:parent:b', async version => {
      order.push(`b${version} start`);
    });

    await other;
    expect(order).toEqual(['a1 start', 'b1 start']);
    releaseFirst();
    await Promise.all([first, second]);
    // Nothing was stored for parent a, so both see 1; what matters is that the
    // second did not start until the first had finished.
    expect(order).toEqual(['a1 start', 'b1 start', 'a1 end', 'a1 start']);
  });

  it('releases the lock when a writer fails', async () => {
    await expect(
      allocateVersion('QueryVersion', 'urn:test:parent:c', async () => { throw new Error('refused'); }),
    ).rejects.toThrow('refused');

    expect(await allocateVersion('QueryVersion', 'urn:test:parent:c', async version => version)).toBe(1);
  });
});
