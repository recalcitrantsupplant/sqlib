import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheCoordinator, EntityExistsError } from '../../src/lib/CacheCoordinator.js';
import { ImmutableEntityError } from '../../src/lib/immutability.js';
import { config } from '../../src/server/config.js';
import { loadSystemStore } from '../../src/system-store/SystemStoreLoader.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

// This suite's subject is cache logic; storage is the in-memory fake, so what
// is asserted is what the cache did and what reached the store.
vi.mock('../../src/system-store/SystemStoreLoader', () => ({
  loadSystemStore: vi.fn(async () => ({
    cacheEntries: new Map(),
    assetDir: 'mock-system-store',
    store: {} as any,
  })),
  getKnownSystemEntityIds: vi.fn(() => new Set()),
}));

vi.mock('../../src/server/config', () => ({
  config: {
    cachePreloadEnabled: true,
    cacheWriteThroughEnabled: true,
  }
}));

describe('CacheCoordinator', () => {
  let coordinator: CacheCoordinator;
  let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = await installFakePersistenceAdapter();
    coordinator = new CacheCoordinator();
    (loadSystemStore as any).mockResolvedValue({
      cacheEntries: new Map(),
      assetDir: 'mock-assets',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.restore();
  });

  it('handles read operations correctly after loading', async () => {
    store.put('Backend', { $id: 'id1', '@type': 'Backend', name: 'Backend 1' });
    await coordinator.loadAll();

    expect(coordinator.get('id1')).toEqual({ $id: 'id1', '@type': 'Backend', name: 'Backend 1' });
    expect(coordinator.getAll()).toEqual([{ $id: 'id1', '@type': 'Backend', name: 'Backend 1' }]);
    expect(coordinator.list('Backend')).toEqual([{ $id: 'id1', '@type': 'Backend', name: 'Backend 1' }]);
  });

  it('handles write operations', async () => {
    await coordinator.loadAll();

    const entity = { $id: 'id1', name: 'New' };

    const created = await coordinator.create('Backend', entity);
    expect(store.get('id1')).toMatchObject(entity);
    expect(created).toMatchObject(entity);
    expect(coordinator.get('id1')).toMatchObject(entity);

    await coordinator.delete('Backend', 'id1');
    expect(store.get('id1')).toBeUndefined();
    expect(coordinator.get('id1')).toBeNull();
  });

  it('handles lifecycle and stats', async () => {
    expect(coordinator.isReady()).toBe(false);
    await coordinator.loadAll();
    expect(coordinator.isReady()).toBe(true);
    expect(coordinator.getStats().totalEntities).toBe(0);
  });

  it('handles ephemeral entities', async () => {
    await coordinator.loadAll();
    const entity = { $id: 'temp1', name: 'Ephemeral' };
    
    coordinator.addEphemeral(entity, 'Backend');
    expect(coordinator.get('temp1')).toMatchObject(entity);
    
    coordinator.removeEphemeral('temp1');
    expect(coordinator.get('temp1')).toBeNull();
  });

  describe('frozen versions', () => {
    const versionTypes = [
      'QueryVersion', 'QueryGroupVersion', 'RuleVersion', 'DataBlockVersion', 'RuleSetVersion',
      'DataGraphVersion', 'TestVersion', 'TupleSetVersion', 'ArgumentSetVersion', 'EtlJobVersion',
      'EtlColumnMappingVersion',
    ] as const;

    it.each(versionTypes)('refuses a content update to a %s that carries no immutable flag', async (type) => {
      await coordinator.loadAll();
      coordinator.cache.set('urn:v:legacy', { $id: 'urn:v:legacy', '@type': type, version: 1 });

      await expect(coordinator.update(type, 'urn:v:legacy', { version: 2 } as never))
        .rejects.toBeInstanceOf(ImmutableEntityError);
      expect(coordinator.get('urn:v:legacy')).toMatchObject({ version: 1 });
    });

    it('refuses a create over an existing version id rather than rewriting the snapshot', async () => {
      await coordinator.loadAll();
      coordinator.cache.set('urn:v:frozen', { $id: 'urn:v:frozen', '@type': 'QueryVersion', version: 1, queryString: 'ASK {}' });

      await expect(coordinator.create('QueryVersion', { $id: 'urn:v:frozen', version: 1, queryString: 'SELECT * {}' } as never))
        .rejects.toBeInstanceOf(EntityExistsError);
      expect(coordinator.get('urn:v:frozen')).toMatchObject({ queryString: 'ASK {}' });
    });
  });

  describe('create over an existing id', () => {
    it('refuses an id already cached under the same type, and writes nothing', async () => {
      await coordinator.loadAll();
      await coordinator.create('Backend', { $id: 'urn:b:taken', name: 'First' });
      const insert = vi.spyOn(store, 'insert');

      await expect(coordinator.create('Backend', { $id: 'urn:b:taken', name: 'Second' }))
        .rejects.toBeInstanceOf(EntityExistsError);
      expect(insert).not.toHaveBeenCalled();
      expect(store.get('urn:b:taken')).toMatchObject({ name: 'First' });
      expect(coordinator.get('urn:b:taken')).toMatchObject({ name: 'First' });
    });

    it('refuses an id cached under another type, which it would otherwise re-type', async () => {
      store.put('Library', { $id: 'urn:lib:1', '@type': 'Library', name: 'Payroll' });
      await coordinator.loadAll();

      await expect(coordinator.create('Backend', { $id: 'urn:lib:1', name: 'Takeover' }))
        .rejects.toMatchObject({ statusCode: 409 });
      expect(coordinator.get('urn:lib:1')).toMatchObject({ '@type': 'Library' });
      expect(store.get('urn:lib:1')).toMatchObject({ '@type': 'Library', name: 'Payroll' });
    });

    it('promotes an ephemeral entity rather than refusing it', async () => {
      await coordinator.loadAll();
      coordinator.addEphemeral({ $id: 'urn:b:scratch', name: 'Scratch' }, 'Backend');

      await expect(coordinator.create('Backend', { $id: 'urn:b:scratch', name: 'Kept' }))
        .resolves.toMatchObject({ name: 'Kept' });
    });

    it('asks the store when the cache was not preloaded', async () => {
      const mutable = config as { cachePreloadEnabled: boolean };
      mutable.cachePreloadEnabled = false;
      try {
        await coordinator.loadAll();
        store.put('Backend', { $id: 'urn:b:cold', '@type': 'Backend' });

        await expect(coordinator.create('Backend', { $id: 'urn:b:cold', name: 'Again' }))
          .rejects.toBeInstanceOf(EntityExistsError);
        expect(store.get('urn:b:cold')).not.toHaveProperty('name');
      } finally {
        mutable.cachePreloadEnabled = true;
      }
    });
  });

  describe('resolveExisting', () => {
    it('resolves from the cache when the entity is loaded', async () => {
      store.put('Backend', { $id: 'urn:b:1', '@type': 'Backend', name: 'Cached' });
      await coordinator.loadAll();
      const findByIri = vi.spyOn(store, 'findByIri');

      const resolved = await coordinator.resolveExisting('urn:b:1', ['Backend']);
      expect(resolved).toMatchObject({ type: 'Backend' });
      // Answered from cache, so the store was never asked.
      expect(findByIri).not.toHaveBeenCalled();
    });

    it('falls back to the store for an entity the cache never loaded', async () => {
      // What CACHE_PRELOAD=false looks like: the IRI is perfectly valid, it is
      // just not in memory. A cache-only check would reject a correct payload.
      await coordinator.loadAll();
      store.put('Backend', { $id: 'urn:b:2', '@type': 'Backend', name: 'Only in the store' });
      const findByIri = vi.spyOn(store, 'findByIri');

      const resolved = await coordinator.resolveExisting('urn:b:2', ['Backend']);
      expect(resolved).toMatchObject({ type: 'Backend' });
      expect(findByIri).toHaveBeenCalledWith('Backend', 'urn:b:2');
    });

    it('returns null when neither the cache nor the store has it', async () => {
      await coordinator.loadAll();

      expect(await coordinator.resolveExisting('urn:b:missing', ['Backend'])).toBeNull();
    });

    it('does not touch the store when no candidate types are given', async () => {
      await coordinator.loadAll();
      const findByIri = vi.spyOn(store, 'findByIri');

      expect(await coordinator.resolveExisting('urn:b:3')).toBeNull();
      expect(findByIri).not.toHaveBeenCalled();
    });
  });
});