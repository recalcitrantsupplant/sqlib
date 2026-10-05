import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryCacheManager } from '../../src/lib/MemoryCacheManager.js';
import { SYSTEM_LIBRARY_ID, SystemQueryCatalog } from '../../src/lib/system-queries/SystemQueryCatalog.js';
import type { LDKitEntity } from '../../src/persistence/EntityTypes.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

// This suite's subject is cache logic; storage is the in-memory fake, so what
// is asserted is what the cache did with what the store held.
describe('MemoryCacheManager system store bootstrap', () => {
  let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

  beforeEach(async () => {
    store = await installFakePersistenceAdapter([
      {
        type: 'Library',
        entity: { $id: 'https://sparql-query-lib/example/library', '@type': 'Library', name: 'User Library' },
      },
    ]);
  });

  afterEach(() => store.restore());

  it('preloads system store assets and merges backend entities', async () => {
    const cache = new MemoryCacheManager();
    await cache.loadAll();

    const library = cache.get(SYSTEM_LIBRARY_ID);
    expect(library?.name).toBe('System Library');
    const def = SystemQueryCatalog.getDefinition('libraryCollection');
    expect(cache.get(def.versionId)).toBeTruthy();

    const userLibrary = cache.get('https://sparql-query-lib/example/library');
    expect(userLibrary?.name).toBe('User Library');
  });

  it('blocks updates to system ids', async () => {
    const cache = new MemoryCacheManager();
    await cache.loadAll();

    await expect(cache.update(SYSTEM_LIBRARY_ID, { name: 'Nope' }, 'Library')).rejects.toThrow(/System entity/);
    await expect(cache.delete(SYSTEM_LIBRARY_ID, 'Library')).rejects.toThrow(/System entity/);
    expect(store.get(SYSTEM_LIBRARY_ID)).toBeUndefined();
  });

  it('blocks creates for system ids', async () => {
    const cache = new MemoryCacheManager();

    const systemLibrary: LDKitEntity = { $id: SYSTEM_LIBRARY_ID, name: 'Nope' };
    await expect(cache.create(systemLibrary, 'Library'))
      .rejects
      .toThrow(/System entity/);
    expect(store.get(SYSTEM_LIBRARY_ID)).toBeUndefined();
  });
});
