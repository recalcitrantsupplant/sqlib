import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheCoordinator } from '../../src/lib/CacheCoordinator.js';
import { loadAllSystemEntities } from '../../src/persistence/utils/entityRepository.js';
import { getKnownSystemEntityIds, loadSystemStore } from '../../src/system-store/SystemStoreLoader.js';
import { Backends } from '../../src/persistence/utils/BackendUtils.js';

// Mock all external dependencies
vi.mock('../../src/persistence/utils/entityRepository', () => ({
  loadAllSystemEntities: vi.fn(),
  createRepositoryLens: vi.fn(),
}));

// This suite's subject is cache logic; storage is a stub. It runs against a
// double built from those stubs (see lensBackedAdapter), so what is asserted is
// what the cache did, not what the persistence layer did.
vi.mock('../../src/persistence/adapterRegistry', async () => {
  const { lensBackedAdapter } = await import('../persistence/lensBackedAdapter.js');
  return { getPersistenceAdapter: () => lensBackedAdapter, setPersistenceAdapter: () => {} };
});

vi.mock('../../src/system-store/SystemStoreLoader', () => ({
  loadSystemStore: vi.fn(async () => ({
    cacheEntries: new Map(),
    assetDir: 'mock-system-store',
    store: {} as any,
  })),
  getKnownSystemEntityIds: vi.fn(() => new Set()),
}));

vi.mock('../../src/persistence/utils/BackendUtils', () => ({
  Backends: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/server/config', () => ({
  config: {
    cachePreloadEnabled: true,
    cacheWriteThroughEnabled: true,
  }
}));

describe('CacheCoordinator', () => {
  let coordinator: CacheCoordinator;

  beforeEach(async () => {
    vi.clearAllMocks();
    coordinator = new CacheCoordinator();
    (loadAllSystemEntities as any).mockResolvedValue(new Map());
    (loadSystemStore as any).mockResolvedValue({
      cacheEntries: new Map(),
      assetDir: 'mock-assets',
    });
  });

  it('handles read operations correctly after loading', async () => {
    const mockEntities = new Map([
      ['id1', { $id: 'id1', '@type': 'Backend', name: 'Backend 1' }],
    ]);
    (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
    await coordinator.loadAll();

    expect(coordinator.get('id1')).toEqual({ $id: 'id1', '@type': 'Backend', name: 'Backend 1' });
    expect(coordinator.getAll()).toEqual([{ $id: 'id1', '@type': 'Backend', name: 'Backend 1' }]);
    expect(coordinator.list('Backend')).toEqual([{ $id: 'id1', '@type': 'Backend', name: 'Backend 1' }]);
  });

  it('handles write operations', async () => {
    (loadAllSystemEntities as any).mockResolvedValue(new Map());
    await coordinator.loadAll();

    const entity = { $id: 'id1', name: 'New' };
    (Backends.insert as any).mockResolvedValue(undefined);

    const created = await coordinator.create('Backend', entity);
    expect(Backends.insert).toHaveBeenCalledWith(expect.objectContaining(entity));
    expect(created).toMatchObject(entity);
    expect(coordinator.get('id1')).toMatchObject(entity);

    await coordinator.delete('Backend', 'id1');
    expect(Backends.delete).toHaveBeenCalledWith('id1');
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

  describe('resolveExisting', () => {
    it('resolves from the cache when the entity is loaded', async () => {
      (loadAllSystemEntities as any).mockResolvedValue(new Map([
        ['urn:b:1', { $id: 'urn:b:1', '@type': 'Backend', name: 'Cached' }],
      ]));
      await coordinator.loadAll();

      const resolved = await coordinator.resolveExisting('urn:b:1', ['Backend']);
      expect(resolved).toMatchObject({ type: 'Backend' });
      // Answered from cache, so the store was never asked.
      expect(Backends.findByIri).not.toHaveBeenCalled();
    });

    it('falls back to the store for an entity the cache never loaded', async () => {
      // What CACHE_PRELOAD=false looks like: the IRI is perfectly valid, it is
      // just not in memory. A cache-only check would reject a correct payload.
      await coordinator.loadAll();
      (Backends.findByIri as any).mockResolvedValue({
        $id: 'urn:b:2', '@type': 'Backend', name: 'Only in the store',
      });

      const resolved = await coordinator.resolveExisting('urn:b:2', ['Backend']);
      expect(resolved).toMatchObject({ type: 'Backend' });
      expect(Backends.findByIri).toHaveBeenCalledWith('urn:b:2');
    });

    it('returns null when neither the cache nor the store has it', async () => {
      await coordinator.loadAll();
      (Backends.findByIri as any).mockResolvedValue(null);

      expect(await coordinator.resolveExisting('urn:b:missing', ['Backend'])).toBeNull();
    });

    it('does not touch the store when no candidate types are given', async () => {
      await coordinator.loadAll();

      expect(await coordinator.resolveExisting('urn:b:3')).toBeNull();
      expect(Backends.findByIri).not.toHaveBeenCalled();
    });
  });
});