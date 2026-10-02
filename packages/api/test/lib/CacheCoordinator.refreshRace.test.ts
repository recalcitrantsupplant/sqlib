/**
 * A background refresh must not undo a write that landed while it was
 * reading the store.
 *
 * Both refreshes await the store and then apply what they read. The type
 * refresh used to drop every cached entity of the type and replace them with
 * its snapshot, and the id refresh to overwrite the entry, so a create, update
 * or delete committed during that await was reverted in the cache until the
 * next refresh. These hold the store read open, write, release it, and assert
 * what the cache holds afterwards, not how often the store was called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EntityType } from '../../src/lib/EntityRegistry.js';

type Entity = { $id: string; name?: string; isPartOf?: string; [key: string]: unknown };

/** A store whose reads can be held open until the test releases them. */
const store = {
  byType: new Map<string, Map<string, Entity>>(),
  heldFindAll: null as null | { type: string; release: () => void },
  heldFindByIri: null as null | { id: string; release: () => void },
  failFindAll: new Set<string>(),
  holdNextFindAll: false,
  holdNextFindByIri: false,
  findAllCalls: 0,

  of(type: string) {
    let entries = this.byType.get(type);
    if (!entries) this.byType.set(type, (entries = new Map()));
    return entries;
  },
};

const adapter = {
  async loadAll() {
    const all = new Map<string, Entity>();
    for (const [type, entries] of store.byType) {
      if (store.failFindAll.has(type)) continue;
      for (const [id, entity] of entries) all.set(id, { ...entity, '@type': type });
    }
    return all;
  },
  async findAll(type: EntityType) {
    store.findAllCalls++;
    if (store.failFindAll.has(type)) throw new Error(`${type} unavailable`);
    const snapshot = [...store.of(type).values()].map(entity => ({ ...entity }));
    if (store.holdNextFindAll) {
      store.holdNextFindAll = false;
      await new Promise<void>(resolve => { store.heldFindAll = { type, release: resolve }; });
    }
    return snapshot;
  },
  async findByIri(type: EntityType, id: string) {
    const found = store.of(type).get(id);
    const snapshot = found ? { ...found } : null;
    if (store.holdNextFindByIri) {
      store.holdNextFindByIri = false;
      await new Promise<void>(resolve => { store.heldFindByIri = { id, release: resolve }; });
    }
    return snapshot;
  },
  async insert(type: EntityType, entity: Entity) {
    store.of(type).set(entity.$id, { ...entity });
  },
  async update(type: EntityType, id: string, patch: Partial<Entity>) {
    const existing = store.of(type).get(id);
    if (existing) store.of(type).set(id, { ...existing, ...patch });
  },
  async delete(type: EntityType, id: string) {
    store.of(type).delete(id);
  },
};

vi.mock('../../src/persistence/adapterRegistry', () => ({
  getPersistenceAdapter: () => adapter,
  setPersistenceAdapter: () => {},
}));

vi.mock('../../src/system-store/SystemStoreLoader', () => ({
  loadSystemStore: vi.fn(async () => ({ cacheEntries: new Map(), assetDir: 'mock' })),
  getKnownSystemEntityIds: vi.fn(() => new Set()),
}));

vi.mock('../../src/server/config', () => ({
  config: { cachePreloadEnabled: true, cacheWriteThroughEnabled: true },
}));

const { CacheCoordinator } = await import('../../src/lib/CacheCoordinator.js');

/** Let the refresh's own awaits run up to the held store read. */
async function untilHeld(get: () => unknown): Promise<void> {
  for (let i = 0; i < 50 && !get(); i++) await new Promise(resolve => setTimeout(resolve, 0));
  expect(get(), 'the refresh never reached the store').toBeTruthy();
}

/** Let the refresh finish applying what it read. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

describe('CacheCoordinator refresh against concurrent writes', () => {
  let coordinator: InstanceType<typeof CacheCoordinator>;

  beforeEach(async () => {
    store.byType.clear();
    store.heldFindAll = null;
    store.heldFindByIri = null;
    store.failFindAll.clear();
    store.holdNextFindAll = false;
    store.holdNextFindByIri = false;
    store.findAllCalls = 0;
    store.of('Tag').set('urn:tag:a', { $id: 'urn:tag:a', name: 'a' });
    store.of('Tag').set('urn:tag:b', { $id: 'urn:tag:b', name: 'b' });

    coordinator = new CacheCoordinator();
    await coordinator.loadAll();
  });

  /** Start a type refresh and leave it holding its store snapshot. */
  async function typeRefreshHeld(): Promise<void> {
    store.holdNextFindAll = true;
    coordinator.list('Tag');
    await untilHeld(() => store.heldFindAll);
  }

  it('keeps an entity created during a type refresh', async () => {
    await typeRefreshHeld();

    await coordinator.create('Tag', { $id: 'urn:tag:c', name: 'c' });
    store.heldFindAll!.release();
    await settle();

    expect(coordinator.get('urn:tag:c')?.name).toBe('c');
    expect(coordinator.list('Tag').map(tag => tag.$id).sort()).toEqual(['urn:tag:a', 'urn:tag:b', 'urn:tag:c']);
  });

  it('keeps an update made during a type refresh', async () => {
    await typeRefreshHeld();

    await coordinator.update('Tag', 'urn:tag:a', { name: 'renamed' });
    store.heldFindAll!.release();
    await settle();

    expect(coordinator.get('urn:tag:a')?.name).toBe('renamed');
  });

  it('does not resurrect an entity deleted during a type refresh', async () => {
    await typeRefreshHeld();

    await coordinator.delete('Tag', 'urn:tag:b');
    store.heldFindAll!.release();
    await settle();

    expect(coordinator.get('urn:tag:b')).toBeNull();
  });

  it('still applies the store to entities nobody wrote meanwhile', async () => {
    store.of('Tag').set('urn:tag:a', { $id: 'urn:tag:a', name: 'changed elsewhere' });
    store.of('Tag').delete('urn:tag:b');
    await typeRefreshHeld();

    await coordinator.create('Tag', { $id: 'urn:tag:c', name: 'c' });
    store.heldFindAll!.release();
    await settle();

    expect(coordinator.get('urn:tag:a')?.name).toBe('changed elsewhere');
    expect(coordinator.get('urn:tag:b')).toBeNull();
    expect(coordinator.get('urn:tag:c')?.name).toBe('c');
  });

  it('keeps an update made during an id refresh', async () => {
    // Make the entry stale so the next read refreshes it.
    (coordinator as unknown as { caches: Map<string, { lastRefreshedById: Map<string, number> }> })
      .caches.get('Tag')!.lastRefreshedById.set('urn:tag:a', 0);
    store.holdNextFindByIri = true;
    coordinator.get('urn:tag:a');
    await untilHeld(() => store.heldFindByIri);

    await coordinator.update('Tag', 'urn:tag:a', { name: 'renamed' });
    store.heldFindByIri!.release();
    await settle();

    expect(coordinator.get('urn:tag:a')?.name).toBe('renamed');
  });

  it('repopulates a type whose boot load failed once it is listed', async () => {
    store.of('Backend').set('urn:backend:1', { $id: 'urn:backend:1', name: 'one' });
    store.failFindAll.add('Backend');
    coordinator = new CacheCoordinator();
    await coordinator.loadAll();
    expect(coordinator.list('Backend')).toEqual([]);
    await settle();

    store.failFindAll.delete('Backend');
    coordinator.list('Backend');
    await settle();

    expect(coordinator.list('Backend').map(backend => backend.$id)).toEqual(['urn:backend:1']);
  });

  it('recomputes per-type stats after a write to that type', async () => {
    const before = coordinator.getStats().entityTypes.Tag;
    expect(before.count).toBe(2);

    await coordinator.create('Tag', { $id: 'urn:tag:c', name: 'a longer name than the others' });

    const after = coordinator.getStats().entityTypes.Tag;
    expect(after.count).toBe(3);
    expect(after.memoryBytes).toBeGreaterThan(before.memoryBytes);
  });
});
