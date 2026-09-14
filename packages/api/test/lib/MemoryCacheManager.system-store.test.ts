import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/persistence/utils/entityRepository.js', async () => {
  const actual = await vi.importActual<any>('../../src/persistence/utils/entityRepository.js');
  return {
    ...actual,
    loadAllSystemEntities: vi.fn(),
  };
});

// This suite's subject is cache logic; storage is a stub. It runs against a
// double built from those stubs (see lensBackedAdapter), so what is asserted is
// what the cache did, not what the persistence layer did.
vi.mock('../../src/persistence/adapterRegistry', async () => {
  const { lensBackedAdapter } = await import('../persistence/lensBackedAdapter.js');
  return { getPersistenceAdapter: () => lensBackedAdapter, setPersistenceAdapter: () => {} };
});

import { MemoryCacheManager } from '../../src/lib/MemoryCacheManager.js';
import { loadAllSystemEntities } from '../../src/persistence/utils/entityRepository.js';
import { SYSTEM_LIBRARY_ID, SystemQueryCatalog } from '../../src/lib/system-queries/SystemQueryCatalog.js';

describe('MemoryCacheManager system store bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preloads system store assets and merges backend entities', async () => {
    const backendEntities = new Map<string, any>();
    backendEntities.set('https://sparql-query-lib/example/library', {
      $id: 'https://sparql-query-lib/example/library',
      '@type': 'Library',
      name: 'User Library',
    });
    (loadAllSystemEntities as any).mockResolvedValue(backendEntities);

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
    (loadAllSystemEntities as any).mockResolvedValue(new Map());
    const cache = new MemoryCacheManager();
    await cache.loadAll();

    await expect(cache.update(SYSTEM_LIBRARY_ID, { name: 'Nope' } as any, 'Library')).rejects.toThrow(/System entity/);
    await expect(cache.delete(SYSTEM_LIBRARY_ID, 'Library')).rejects.toThrow(/System entity/);
  });

  it('blocks creates for system ids', async () => {
    const cache = new MemoryCacheManager();

    await expect(cache.create({ $id: SYSTEM_LIBRARY_ID, name: 'Nope' } as any, 'Library'))
      .rejects
      .toThrow(/System entity/);
  });
});
