/**
 * Saving a data graph version invalidates the in-memory stores that follow
 * its head.
 *
 * This is the whole "kept in sync" mechanism, and it is only cheap because
 * every data-graph write goes through `createDataGraphVersion` — so that is
 * where the test looks.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
  invalidateTracking: vi.fn(async (_id: string) => [] as string[]),
  created: [] as unknown[],
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: (id: string) => hoisted.entities.get(id) ?? null,
    list: (type: string) =>
      Array.from(hoisted.entities.values()).filter(entity => entity['@type'] === type),
    create: vi.fn(async (_type: string, payload: Record<string, unknown>) => {
      const id = (payload.$id ?? payload['@id']) as string;
      const stored = { ...payload, $id: id, '@type': 'DataGraphVersion' };
      hoisted.entities.set(id, stored);
      hoisted.created.push(stored);
      return stored;
    }),
    update: vi.fn(async (_type: string, id: string, updates: Record<string, unknown>) => {
      const existing = hoisted.entities.get(id) ?? {};
      const merged = { ...existing, ...updates };
      hoisted.entities.set(id, merged);
      return merged;
    }),
  }),
}));

vi.mock('../../src/lib/OxigraphStoreManager.js', () => ({
  oxigraphStoreManager: {
    invalidateStoresTrackingDataGraph: hoisted.invalidateTracking,
  },
}));

const { createDataGraphVersion } = await import('../../src/lib/DataGraphVersionWriter.js');

const TURTLE = '@prefix ex: <http://example.org/> .\nex:a ex:knows ex:b .\n';

describe('createDataGraphVersion - store invalidation', () => {
  beforeEach(() => {
    hoisted.entities.clear();
    hoisted.created.length = 0;
    hoisted.invalidateTracking.mockClear();
    hoisted.invalidateTracking.mockResolvedValue([]);
    hoisted.entities.set('g1', {
      $id: 'g1',
      '@type': 'DataGraph',
      name: 'g1',
      isPartOf: ['lib1'],
      currentVersion: null,
    });
  });

  it('invalidates stores tracking the graph whose head just moved', async () => {
    await createDataGraphVersion('g1', { contentString: TURTLE });

    expect(hoisted.invalidateTracking).toHaveBeenCalledWith('g1');
  });

  it('invalidates only after the parent points at the new version', async () => {
    // Order matters: a store rebuilt by an invalidation that landed first would
    // re-read the *old* head and go straight back to being stale.
    hoisted.invalidateTracking.mockImplementation(async (id: string) => {
      expect((hoisted.entities.get(id) as { currentVersion?: string }).currentVersion).toBeTruthy();
      return [];
    });

    await createDataGraphVersion('g1', { contentString: TURTLE });

    expect(hoisted.invalidateTracking).toHaveBeenCalledTimes(1);
  });

  it('still reports the save as successful when invalidation fails', async () => {
    // The version is written and the parent already points at it, so throwing
    // here would report a successful write as an error.
    hoisted.invalidateTracking.mockRejectedValue(new Error('store manager exploded'));

    const created = await createDataGraphVersion('g1', { contentString: TURTLE });

    expect(created.$id).toBeTruthy();
    expect((hoisted.entities.get('g1') as { currentVersion?: string }).currentVersion).toBe(created.$id);
  });
});
