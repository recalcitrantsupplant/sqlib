import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryCacheManager } from '../../src/lib/MemoryCacheManager.js';
import { loadAllSystemEntities } from '../../src/persistence/utils/entityRepository.js';
import { Backends } from '../../src/persistence/utils/BackendUtils.js';
import { Queries } from '../../src/persistence/utils/QueryUtils.js';
import { QueryGroups } from '../../src/persistence/utils/QueryGroupUtils.js';
import { QueryNodes } from '../../src/persistence/utils/QueryNodeUtils.js';
import { QueryEdges } from '../../src/persistence/utils/QueryEdgeUtils.js';
import { Libraries } from '../../src/persistence/utils/LibraryUtils.js';
import { QueryVersions } from '../../src/persistence/utils/QueryVersionUtils.js';
import { QueryGroupVersions } from '../../src/persistence/utils/QueryGroupVersionUtils.js';

// Mock external dependencies
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

// In these unit tests we don't want system-store assets affecting totals.
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

vi.mock('../../src/persistence/utils/QueryUtils', () => ({
  Queries: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/QueryVersionUtils', () => ({
  QueryVersions: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/QueryGroupVersionUtils', () => ({
  QueryGroupVersions: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/QueryGroupUtils', () => ({
  QueryGroups: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/QueryNodeUtils', () => ({
  QueryNodes: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/QueryEdgeUtils', () => ({
  QueryEdges: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/LibraryUtils', () => ({
  Libraries: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/DynamicQueryNodeUtils', () => ({
  DynamicQueryNodes: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/StartNodeUtils', () => ({
  StartNodes: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/EndNodeUtils', () => ({
  EndNodes: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/LimitParameterUtils', () => ({
  LimitParameters: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/OffsetParameterUtils', () => ({
  OffsetParameters: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/QueryInputUtils', () => ({
  QueryInputs: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/QueryOutputUtils', () => ({
  QueryOutputs: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/QueryInputTupleUtils', () => ({
  QueryInputTuples: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/QueryOutputTupleUtils', () => ({
  QueryOutputTuples: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/TupleMemberUtils', () => ({
  TupleMembers: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/RdfOutputUtils', () => ({
  RdfOutputs: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
    findByIri: vi.fn(),
  },
}));

describe('MemoryCacheManager', () => {
  let cacheManager: MemoryCacheManager;
  let originalConsoleLog: any;
  let originalConsoleError: any;
  let originalConsoleWarn: any;
  let originalDateNow: any;
  let originalCacheWriteThrough: string | undefined;
  let originalCachePreload: string | undefined;

  beforeEach(() => {
    cacheManager = new MemoryCacheManager();
    // Reset all mocks before each test
    vi.clearAllMocks();
    // Mock console methods to reduce noise in tests
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    console.log = vi.fn();
    console.error = vi.fn();
    console.warn = vi.fn();
    
    // Store original Date.now
    originalDateNow = Date.now;
    originalCacheWriteThrough = process.env.CACHE_WRITE_THROUGH;
    originalCachePreload = process.env.CACHE_PRELOAD;
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    
    // Restore Date.now
    Date.now = originalDateNow;
    if (originalCacheWriteThrough === undefined) {
      delete process.env.CACHE_WRITE_THROUGH;
    } else {
      process.env.CACHE_WRITE_THROUGH = originalCacheWriteThrough;
    }
    if (originalCachePreload === undefined) {
      delete process.env.CACHE_PRELOAD;
    } else {
      process.env.CACHE_PRELOAD = originalCachePreload;
    }
    
    // Clear any pending timers
    vi.clearAllTimers();
  });

  describe('loadAll', () => {
    it('should load all entities into the cache', async () => {
      const mockEntities = new Map([
        ['id1', { $id: 'id1', '@type': 'Backend' }],
        ['id2', { $id: 'id2', '@type': 'Query' }],
      ]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);

      await cacheManager.loadAll();

      expect(loadAllSystemEntities).toHaveBeenCalledTimes(1);
      expect(cacheManager.isReady()).toBe(true);
      expect(cacheManager.getAll()).toEqual(Array.from(mockEntities.values()));
      expect(cacheManager.getStats().totalEntities).toBe(2);
    });

    it('should handle errors during loading', async () => {
      const mockError = new Error('Failed to connect to SPARQL');
      (loadAllSystemEntities as any).mockRejectedValue(mockError);

      await expect(cacheManager.loadAll()).rejects.toThrow(mockError);
      expect(loadAllSystemEntities).toHaveBeenCalledTimes(1);
      expect(cacheManager.isReady()).toBe(false);
      expect(cacheManager.getStats().totalEntities).toBe(0);
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      const mockEntities = new Map([
        ['id1', { $id: 'id1', '@type': 'Backend', name: 'Backend 1' }],
        ['id2', { $id: 'id2', '@type': 'Query', name: 'Query 1' }],
      ]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();
    });

    it('should return an entity if found', () => {
      const entity = cacheManager.get('id1');
      expect(entity).toEqual({ $id: 'id1', '@type': 'Backend', name: 'Backend 1' });
    });

    it('should return null if entity not found', () => {
      const entity = cacheManager.get('nonExistentId');
      expect(entity).toBeNull();
    });

    it('should throw error if cache not loaded', () => {
      const freshCacheManager = new MemoryCacheManager();
      expect(() => freshCacheManager.get('id1')).toThrow('Cache not loaded. Call loadAll() first.');
    });
  });

  describe('getByType', () => {
    beforeEach(async () => {
      const mockEntities = new Map([
        ['id1', { $id: 'id1', '@type': 'Backend', name: 'Backend 1' }],
        ['id2', { $id: 'id2', '@type': 'Query', name: 'Query 1' }],
        ['id3', { $id: 'id3', '@type': 'Backend', name: 'Backend 2' }],
      ]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();
    });

    it('should return all entities of a specific type', () => {
      const backends = cacheManager.getByType('Backend');
      expect(backends).toEqual([
        { $id: 'id1', '@type': 'Backend', name: 'Backend 1' },
        { $id: 'id3', '@type': 'Backend', name: 'Backend 2' },
      ]);
    });

    it('should return an empty array if no entities of the type exist', () => {
      const libraries = cacheManager.getByType('Library');
      expect(libraries).toEqual([]);
    });

    it('should throw error if cache not loaded', () => {
      const freshCacheManager = new MemoryCacheManager();
      expect(() => freshCacheManager.getByType('Backend')).toThrow('Cache not loaded. Call loadAll() first.');
    });
  });

  describe('getAll', () => {
    beforeEach(async () => {
      const mockEntities = new Map([
        ['id1', { $id: 'id1', '@type': 'Backend' }],
        ['id2', { $id: 'id2', '@type': 'Query' }],
      ]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();
    });

    it('should return all entities in the cache', () => {
      const allEntities = cacheManager.getAll();
      expect(allEntities).toEqual([
        { $id: 'id1', '@type': 'Backend' },
        { $id: 'id2', '@type': 'Query' },
      ]);
    });

    it('should return an empty array if cache is empty', async () => {
      (loadAllSystemEntities as any).mockResolvedValue(new Map());
      await cacheManager.loadAll();
      const allEntities = cacheManager.getAll();
      expect(allEntities).toEqual([]);
    });

    it('should throw error if cache not loaded', () => {
      const freshCacheManager = new MemoryCacheManager();
      expect(() => freshCacheManager.getAll()).toThrow('Cache not loaded. Call loadAll() first.');
    });
  });

  describe('create', () => {
    beforeEach(async () => {
      (loadAllSystemEntities as any).mockResolvedValue(new Map());
      await cacheManager.loadAll();
    });

    it('should create an entity and add it to the cache', async () => {
      const newBackend = { $id: 'newBackend1', name: 'New Backend' };
      const entityType = 'Backend';
      (Backends.insert as any).mockResolvedValue(undefined);

      const createdEntity = await cacheManager.create(newBackend, entityType);

      expect(Backends.insert).toHaveBeenCalledWith(expect.objectContaining(newBackend));
      expect(createdEntity).toEqual(expect.objectContaining({ ...newBackend }));
      expect(cacheManager.get('newBackend1')).toEqual(expect.objectContaining({ ...newBackend }));
      expect(cacheManager.getStats().totalEntities).toBe(1);
    });

    it('should throw error for unknown entity type', async () => {
      const newEntity = { $id: 'unknown1', name: 'Unknown Entity' };
      const entityType = 'UnknownType';

      await expect(cacheManager.create(newEntity, entityType)).rejects.toThrow('Unknown entity type: UnknownType');
    });
  });

  describe('update', () => {
    const existingBackend = { $id: 'backend1', '@type': 'Backend', name: 'Old Name', endpoint: 'old.com' };

    beforeEach(async () => {
      const mockEntities = new Map([
        ['backend1', existingBackend],
      ]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();
    });

    it('should update an entity and reflect changes in cache', async () => {
      const updates = { name: 'New Name', endpoint: 'new.com' };
      const entityType = 'Backend';
      (Backends.update as any).mockResolvedValue(undefined);

      const updatedEntity = await cacheManager.update('backend1', updates, entityType);

      expect(Backends.update).toHaveBeenCalledWith(expect.objectContaining({
        $id: 'backend1',
        ...updates,
        dateModified: expect.any(String),
      }));
      expect(updatedEntity).not.toBeNull();
      expect(updatedEntity).toMatchObject({
        ...existingBackend,
        ...updates,
        dateModified: expect.any(String),
      });
      expect(cacheManager.get('backend1')).toMatchObject({
        ...existingBackend,
        ...updates,
        dateModified: expect.any(String),
      });
    });

    it('returns null when updating an unknown entity', async () => {
      const newId = 'nonExistentBackend';
      const updates = { name: 'Newly Added', endpoint: 'new.com' };
      const entityType = 'Backend';

      const updatedEntity = await cacheManager.update(newId, updates, entityType);

      expect(updatedEntity).toBeNull();
      expect(Backends.update).not.toHaveBeenCalled();
      expect(cacheManager.get(newId)).toBeNull();
    });

    it('should throw error for unknown entity type', async () => {
      const updates = { name: 'New Name' };
      const entityType = 'UnknownType';

      await expect(cacheManager.update('backend1', updates, entityType)).rejects.toThrow('Unknown entity type: UnknownType');
    });

    it('should merge updates when repository fetch returns partial entity data', async () => {
      const versionId = 'urn:qgv:merge';
      const initialVersion = {
        $id: versionId,
        '@type': 'QueryGroupVersion',
        groupId: 'urn:group:merge',
        version: 1,
      };

      cacheManager = new MemoryCacheManager();
      (loadAllSystemEntities as any).mockResolvedValue(new Map([[versionId, initialVersion]]));
      await cacheManager.loadAll();

      (QueryGroupVersions.update as any).mockResolvedValue(undefined);
      (QueryGroupVersions.findByIri as any).mockResolvedValue({
        $id: versionId,
        groupId: 'urn:group:merge',
        version: 1,
        '@type': 'QueryGroupVersion',
      });

      const updates = {
        executionNodes: ['urn:node:a', 'urn:node:b'],
        edges: ['urn:edge:a'],
        startNode: 'urn:start:a',
        endNode: 'urn:end:a',
      };

      const updatedEntity = await cacheManager.update(versionId, updates, 'QueryGroupVersion');

      expect(QueryGroupVersions.update).toHaveBeenCalledWith(expect.objectContaining({
        $id: versionId,
        ...updates,
        dateModified: expect.any(String),
      }));
      expect(updatedEntity).not.toBeNull();
      expect(updatedEntity).toMatchObject({
        executionNodes: updates.executionNodes,
        edges: updates.edges,
        startNode: 'urn:start:a',
        endNode: 'urn:end:a',
        dateModified: expect.any(String),
      });
      expect(cacheManager.get(versionId)).toMatchObject({
        executionNodes: updates.executionNodes,
        edges: updates.edges,
        startNode: 'urn:start:a',
        endNode: 'urn:end:a',
        dateModified: expect.any(String),
      });
    });
  });

  describe('delete', () => {
    const existingQuery = { $id: 'query1', '@type': 'Query', name: 'My Query' };

    beforeEach(async () => {
      const mockEntities = new Map([
        ['query1', existingQuery],
      ]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();
    });

    it('should delete an entity from backend and cache', async () => {
      const entityType = 'Query';
      (Queries.delete as any).mockResolvedValue(undefined);

      await cacheManager.delete('query1', entityType);

      expect(Queries.delete).toHaveBeenCalledWith('query1');
      expect(cacheManager.get('query1')).toBeNull();
      expect(cacheManager.getStats().totalEntities).toBe(0);
    });

    it('should not throw error if entity not found in cache but deleted from backend', async () => {
      const entityType = 'Query';
      (Queries.delete as any).mockResolvedValue(undefined);
      // Manually remove from cache to simulate it not being there
      (cacheManager as any)['cache'].delete('query1');

      await cacheManager.delete('query1', entityType);

      expect(Queries.delete).toHaveBeenCalledWith('query1');
      expect(cacheManager.get('query1')).toBeNull();
      expect(cacheManager.getStats().totalEntities).toBe(0);
    });

    it('should throw error for unknown entity type', async () => {
      const entityType = 'UnknownType';

      await expect(cacheManager.delete('query1', entityType)).rejects.toThrow('Unknown entity type: UnknownType');
    });
  });

  describe('refreshEntityType', () => {
    const initialEntities = new Map([
      ['backend1', { $id: 'backend1', '@type': 'Backend', name: 'Backend A' }],
      ['query1', { $id: 'query1', '@type': 'Query', name: 'Query X' }],
      ['backend2', { $id: 'backend2', '@type': 'Backend', name: 'Backend B' }],
    ]);

    beforeEach(async () => {
      (loadAllSystemEntities as any).mockResolvedValue(initialEntities);
      await cacheManager.loadAll();
    });

    it('should refresh entities of a specific type', async () => {
      const freshBackends = [
        { $id: 'backend1', '@type': 'Backend', name: 'Backend A Updated' },
        { $id: 'backend3', '@type': 'Backend', name: 'Backend C New' },
      ];
      (Backends.find as any).mockResolvedValue(freshBackends);

      await cacheManager.refreshEntityType('Backend');

      expect(Backends.find).toHaveBeenCalledTimes(1);
      // Check that old Backend entities are replaced by fresh ones
      expect(cacheManager.get('backend1')).toEqual({ $id: 'backend1', '@type': 'Backend', name: 'Backend A Updated' });
      expect(cacheManager.get('backend2')).toBeNull(); // Old backend2 should be removed
      expect(cacheManager.get('backend3')).toEqual({ $id: 'backend3', '@type': 'Backend', name: 'Backend C New' });
      // Other entity types should remain untouched
      expect(cacheManager.get('query1')).toEqual({ $id: 'query1', '@type': 'Query', name: 'Query X' });
      expect(cacheManager.getStats().totalEntities).toBe(3); // 2 new backends + 1 existing query
    });

    it('should handle refreshing an entity type with no existing entities', async () => {
      const freshLibraries = [
        { $id: 'lib1', '@type': 'Library', name: 'New Library' },
      ];
      (Libraries.find as any).mockResolvedValue(freshLibraries);

      await cacheManager.refreshEntityType('Library');

      expect(Libraries.find).toHaveBeenCalledTimes(1);
      expect(cacheManager.get('lib1')).toEqual({ $id: 'lib1', '@type': 'Library', name: 'New Library' });
      expect(cacheManager.getStats().totalEntities).toBe(4); // 3 initial + 1 new library
    });

    it('should throw error for unknown entity type', async () => {
      await expect(cacheManager.refreshEntityType('UnknownType')).rejects.toThrow('Unknown entity type: UnknownType');
    });
  });

  describe('isReady', () => {
    it('should return false when cache is not loaded', () => {
      expect(cacheManager.isReady()).toBe(false);
    });

    it('should return true when cache is loaded', async () => {
      (loadAllSystemEntities as any).mockResolvedValue(new Map());
      await cacheManager.loadAll();
      expect(cacheManager.isReady()).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics for an empty cache', () => {
      const stats = cacheManager.getStats();
      expect(stats).toEqual({
        totalEntities: 0,
        isLoaded: false,
        estimatedMemoryBytes: 0,
        entityTypes: {},
      });
    });

    it('should return correct statistics for a loaded cache', async () => {
      const mockEntities = new Map([
        ['id1', { $id: 'id1', '@type': 'Backend' }],
        ['id2', { $id: 'id2', '@type': 'Query' }],
        ['id3', { $id: 'id3', '@type': 'Backend' }],
        ['id4', { $id: 'id4', '@type': 'Library' }],
      ]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();

      const stats = cacheManager.getStats();
      expect(stats.totalEntities).toBe(4);
      expect(stats.isLoaded).toBe(true);
      expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);
      expect(stats.entityTypes).toEqual({
        Backend: { count: 2, memoryBytes: expect.any(Number) },
        Query: { count: 1, memoryBytes: expect.any(Number) },
        Library: { count: 1, memoryBytes: expect.any(Number) },
      });
    });

    it('should handle entities without @type', async () => {
      const mockEntities = new Map([
        ['id1', { $id: 'id1', '@type': 'Backend' }],
        ['id2', { $id: 'id2', name: 'No Type' }], // Entity without @type
      ]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();

      const stats = cacheManager.getStats();
      expect(stats.totalEntities).toBe(2);
      expect(stats.isLoaded).toBe(true);
      expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);
      expect(stats.entityTypes).toEqual({
        Backend: { count: 1, memoryBytes: expect.any(Number) },
        Unknown: { count: 1, memoryBytes: expect.any(Number) },
      });
    });
  });

  describe('getLensForType (private method)', () => {
    // This is a private method, but we can test it indirectly or by casting to any
    it('should return the correct lens for Backend type', async () => {
      const lens = await (cacheManager as any).getLensForType('Backend');
      expect(lens).toBe(Backends);
    });

    it('should return the correct lens for Query type', async () => {
      const lens = await (cacheManager as any).getLensForType('Query');
      expect(lens).toBe(Queries);
    });

    it('should return the correct lens for QueryGroup type', async () => {
      const lens = await (cacheManager as any).getLensForType('QueryGroup');
      expect(lens).toBe(QueryGroups);
    });

    it('should return the correct lens for QueryNode type', async () => {
      const lens = await (cacheManager as any).getLensForType('QueryNode');
      expect(lens).toBe(QueryNodes);
    });

    it('should return the correct lens for QueryEdge type', async () => {
      const lens = await (cacheManager as any).getLensForType('QueryEdge');
      expect(lens).toBe(QueryEdges);
    });

    it('should return the correct lens for Library type', async () => {
      const lens = await (cacheManager as any).getLensForType('Library');
      expect(lens).toBe(Libraries);
    });

    it('should throw an error for an unknown entity type', async () => {
      await expect((cacheManager as any).getLensForType('NonExistentType')).rejects.toThrow('Unknown entity type: NonExistentType');
    });
  });

  // Comprehensive TTL and Stale-While-Revalidate (SWR) tests
  describe('TTL and Stale-While-Revalidate (SWR)', () => {
    let mockDateNow: number;

    beforeEach(async () => {
      vi.useFakeTimers();
      mockDateNow = 1000000; // Fixed timestamp for testing
      Date.now = vi.fn(() => mockDateNow);

      const mockEntities = new Map([
        ['query1', { $id: 'query1', '@type': 'Query', name: 'Test Query' }],
        ['backend1', { $id: 'backend1', '@type': 'Backend', name: 'Test Backend' }],
        ['queryversion1', { $id: 'queryversion1', '@type': 'QueryVersion', name: 'Test Version' }]
      ]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should not trigger refresh for entities within TTL', () => {
      // Advance time but stay within Query TTL (15 seconds)
      mockDateNow += 10000; // 10 seconds later
      Date.now = vi.fn(() => mockDateNow);

      const entity = cacheManager.get('query1');
      expect(entity).toEqual({ $id: 'query1', '@type': 'Query', name: 'Test Query' });

      // Should not trigger any refresh calls
      expect(Queries.findByIri).not.toHaveBeenCalled();
    });

    it('should trigger individual entity refresh when TTL expires', async () => {
      (Queries.findByIri as any).mockResolvedValue({
        $id: 'query1',
        name: 'Updated Test Query',
        dateModified: new Date().toISOString()
      });

      // Advance time beyond Query TTL (15 seconds)
      mockDateNow += 20000; // 20 seconds later
      Date.now = vi.fn(() => mockDateNow);

      const entity = cacheManager.get('query1');
      expect(entity).toEqual({ $id: 'query1', '@type': 'Query', name: 'Test Query' });

      // Give some time for the async refresh to complete
      await vi.advanceTimersByTimeAsync(10);

      // Should have triggered refresh
      expect(Queries.findByIri).toHaveBeenCalledWith('query1');
    });

    it('should not refresh immutable entity types (infinite TTL)', () => {
      // Advance time significantly
      mockDateNow += 1000000; // Much later
      Date.now = vi.fn(() => mockDateNow);

      const entity = cacheManager.get('queryversion1');
      expect(entity).toEqual({ $id: 'queryversion1', '@type': 'QueryVersion', name: 'Test Version' });

      // Should not trigger any refresh for QueryVersion (infinite TTL)
      expect(QueryVersions.findByIri).not.toHaveBeenCalled();
    });

    it('should trigger type-based refresh when getting entities by type beyond TTL', async () => {
      (Queries.find as any).mockResolvedValue([
        { $id: 'query1', name: 'Updated Query 1' },
        { $id: 'query2', name: 'New Query 2' }
      ]);

      // Advance time beyond Query TTL
      mockDateNow += 20000;
      Date.now = vi.fn(() => mockDateNow);

      const entities = cacheManager.getByType('Query');
      expect(entities).toEqual([{ $id: 'query1', '@type': 'Query', name: 'Test Query' }]);

      // Give some time for the async refresh to complete
      await vi.advanceTimersByTimeAsync(10);

      expect(Queries.find).toHaveBeenCalled();
    });

    it('should handle different TTL values for different entity types', async () => {
      // Test Backend TTL (180 seconds)
      mockDateNow += 170000; // 170 seconds later (within Backend TTL)
      Date.now = vi.fn(() => mockDateNow);

      cacheManager.get('backend1');
      expect(Backends.findByIri).not.toHaveBeenCalled(); // Still within TTL

      // Now exceed Backend TTL
      mockDateNow += 20000; // Total 190 seconds (beyond 180s TTL)
      Date.now = vi.fn(() => mockDateNow);

      cacheManager.get('backend1');

      // Should trigger refresh, advance timers to execute it
      await vi.advanceTimersByTimeAsync(20);

      expect(Backends.findByIri).toHaveBeenCalledWith('backend1');
    });

    it('should not trigger multiple concurrent refreshes for same entity', async () => {
      (Queries.findByIri as any).mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ $id: 'query1', name: 'Slow Update' }), 100))
      );

      // Advance time beyond TTL
      mockDateNow += 20000;
      Date.now = vi.fn(() => mockDateNow);

      // Make multiple calls that should trigger refresh
      cacheManager.get('query1');
      cacheManager.get('query1');
      cacheManager.get('query1');

      await vi.advanceTimersByTimeAsync(150);

      // Should only call findByIri once despite multiple get calls
      expect(Queries.findByIri).toHaveBeenCalledTimes(1);
    });

    it('should handle refresh errors gracefully', async () => {
      (Queries.findByIri as any).mockRejectedValue(new Error('SPARQL endpoint unavailable'));

      // Advance time beyond TTL
      mockDateNow += 20000;
      Date.now = vi.fn(() => mockDateNow);

      // Should still return cached entity even if refresh fails
      const entity = cacheManager.get('query1');
      expect(entity).toEqual({ $id: 'query1', '@type': 'Query', name: 'Test Query' });

      await vi.advanceTimersByTimeAsync(10);

      // Should have logged a warning about failed refresh
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Cache][SWR] Failed to refresh id query1 of type Query'),
        expect.any(Error)
      );
    });

    it('should update cache when refresh succeeds', async () => {
      const updatedEntity = { $id: 'query1', name: 'Successfully Updated Query' };
      (Queries.findByIri as any).mockResolvedValue(updatedEntity);

      // Advance time beyond TTL
      mockDateNow += 20000;
      Date.now = vi.fn(() => mockDateNow);

      // Initial get triggers refresh
      cacheManager.get('query1');

      // Wait for refresh to complete
      await vi.advanceTimersByTimeAsync(10);

      // Subsequent get should return updated entity
      const entity = cacheManager.get('query1');
      expect(entity).toEqual({ ...updatedEntity, '@type': 'Query' });
    });
  });

  // Error handling and edge cases
  describe('Error Handling and Edge Cases', () => {
    beforeEach(async () => {
      (loadAllSystemEntities as any).mockResolvedValue(new Map());
      await cacheManager.loadAll();
    });

    it('should handle create operation when backend insert fails', async () => {
      const insertError = new Error('Backend unavailable');
      (Backends.insert as any).mockRejectedValue(insertError);

      const newBackend = { $id: 'failing-backend', name: 'Will Fail' };
      
      await expect(cacheManager.create(newBackend, 'Backend')).rejects.toThrow(insertError);
      
      // Entity should not be in cache after failed insert
      expect(cacheManager.get('failing-backend')).toBeNull();
    });

    it('should handle update operation when backend update fails', async () => {
      // First create an entity successfully
      (Backends.insert as any).mockResolvedValue(undefined);
      const entity = { $id: 'test-backend', name: 'Original' };
      await cacheManager.create(entity, 'Backend');
      
      // Now make update fail
      const updateError = new Error('Update failed');
      (Backends.update as any).mockRejectedValue(updateError);

      await expect(cacheManager.update('test-backend', { name: 'Updated' }, 'Backend')).rejects.toThrow(updateError);
      
      // Entity should still have original values in cache
      const cachedEntity = cacheManager.get('test-backend');
      expect(cachedEntity).toEqual(expect.objectContaining({ name: 'Original' }));
    });

    it('should handle delete operation when backend delete fails', async () => {
      // Create an entity first
      (Backends.insert as any).mockResolvedValue(undefined);
      const entity = { $id: 'test-backend', name: 'To Delete' };
      await cacheManager.create(entity, 'Backend');
      
      // Make delete fail
      const deleteError = new Error('Delete failed');
      (Backends.delete as any).mockRejectedValue(deleteError);

      await expect(cacheManager.delete('test-backend', 'Backend')).rejects.toThrow(deleteError);
      
      // Entity should still be in cache after failed delete
      expect(cacheManager.get('test-backend')).not.toBeNull();
    });

    it('should handle entities with missing $id gracefully', async () => {
      const entitiesWithMissingId = new Map([
        ['valid1', { $id: 'valid1', '@type': 'Backend', name: 'Valid' }],
        ['invalid1', { '@type': 'Backend', name: 'Missing ID' }] // No $id
      ]);
      
      // Test refreshEntityType with entities missing $id
      (Backends.find as any).mockResolvedValue([
        { $id: 'valid1', name: 'Valid Backend' },
        { name: 'Backend Without ID' } // No $id
      ]);

      await cacheManager.refreshEntityType('Backend');
      
      // Only entities with $id should be cached
      expect(cacheManager.get('valid1')).toEqual({ $id: 'valid1', '@type': 'Backend', name: 'Valid Backend' });
      expect(cacheManager.getByType('Backend')).toHaveLength(1);
    });

    it('should handle create with automatic dateCreated and dateModified', async () => {
      const mockDate = '2023-01-01T00:00:00.000Z';
      const originalToISOString = Date.prototype.toISOString;
      Date.prototype.toISOString = vi.fn(() => mockDate);

      (Backends.insert as any).mockResolvedValue(undefined);
      const entity = { $id: 'test-backend', name: 'Test' };
      
      const result = await cacheManager.create(entity, 'Backend');
      
      expect(Backends.insert).toHaveBeenCalledWith({
        ...entity,
        dateCreated: mockDate,
        dateModified: mockDate
      });
      
      expect(result).toEqual(expect.objectContaining({
        dateCreated: mockDate,
        dateModified: mockDate
      }));

      Date.prototype.toISOString = originalToISOString;
    });

    it('should not override existing dateCreated in create operation', async () => {
      const mockDate = '2023-01-01T00:00:00.000Z';
      const existingDate = '2022-01-01T00:00:00.000Z';
      const originalToISOString = Date.prototype.toISOString;
      Date.prototype.toISOString = vi.fn(() => mockDate);

      (Backends.insert as any).mockResolvedValue(undefined);
      const entity = { 
        $id: 'test-backend', 
        name: 'Test',
        dateCreated: existingDate 
      };
      
      await cacheManager.create(entity, 'Backend');
      
      expect(Backends.insert).toHaveBeenCalledWith({
        ...entity,
        dateCreated: existingDate, // Should preserve existing
        dateModified: mockDate
      });

      Date.prototype.toISOString = originalToISOString;
    });

    it('should handle update with fresh entity fetch when available', async () => {
      const originalEntity = { $id: 'test-backend', '@type': 'Backend', name: 'Original' };
      const mockEntities = new Map([['test-backend', originalEntity]]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();

      const freshEntity = { $id: 'test-backend', name: 'Fresh From Backend', version: 2 };
      (Backends.update as any).mockResolvedValue(undefined);
      (Backends.findByIri as any).mockResolvedValue(freshEntity);

      const updates = { name: 'Updated' };
      const result = await cacheManager.update('test-backend', updates, 'Backend');
      
      // Should return fresh entity hydrated with requested updates
      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        ...freshEntity,
        ...updates,
        '@type': 'Backend',
        dateModified: expect.any(String),
      });
      expect(cacheManager.get('test-backend')).toMatchObject({
        ...freshEntity,
        ...updates,
        '@type': 'Backend',
        dateModified: expect.any(String),
      });
    });

    it('should fallback to local merge when fresh entity fetch fails', async () => {
      const originalEntity = { $id: 'test-backend', '@type': 'Backend', name: 'Original' };
      const mockEntities = new Map([['test-backend', originalEntity]]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();

      (Backends.update as any).mockResolvedValue(undefined);
      (Backends.findByIri as any).mockRejectedValue(new Error('Fetch failed'));

      const updates = { name: 'Updated' };
      const result = await cacheManager.update('test-backend', updates, 'Backend');
      
      // Should merge updates with cached entity
      expect(result).toEqual({ 
        ...originalEntity, 
        ...updates, 
        dateModified: expect.any(String)
      });
    });
  });

  // Concurrency and race condition tests
  describe('Concurrency and Race Conditions', () => {
    beforeEach(async () => {
      (loadAllSystemEntities as any).mockResolvedValue(new Map());
      await cacheManager.loadAll();
    });

    it('should handle concurrent create operations for same entity', async () => {
      let insertCallCount = 0;
      (Backends.insert as any).mockImplementation(async () => {
        insertCallCount++;
        // Simulate some delay
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      const entity = { $id: 'concurrent-backend', name: 'Concurrent' };
      
      // Start two concurrent create operations
      const promise1 = cacheManager.create(entity, 'Backend');
      const promise2 = cacheManager.create(entity, 'Backend');

      const [result1, result2] = await Promise.all([promise1, promise2]);
      
      // Both should succeed
      expect(result1).toEqual(expect.objectContaining(entity));
      expect(result2).toEqual(expect.objectContaining(entity));
      expect(insertCallCount).toBe(2); // Both should call insert
    });

    it('should handle concurrent update operations', async () => {
      // Create initial entity
      (Backends.insert as any).mockResolvedValue(undefined);
      await cacheManager.create({ $id: 'test-backend', name: 'Original' }, 'Backend');

      let updateCallCount = 0;
      (Backends.update as any).mockImplementation(async (data: any) => {
        updateCallCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
      });
      (Backends.findByIri as any).mockResolvedValue(null); // No fresh fetch

      // Concurrent updates
      const promise1 = cacheManager.update('test-backend', { name: 'Update 1' }, 'Backend');
      const promise2 = cacheManager.update('test-backend', { name: 'Update 2' }, 'Backend');

      await Promise.all([promise1, promise2]);
      
      expect(updateCallCount).toBe(2);
    });

    it('should handle mixed concurrent operations (create, read, update, delete)', async () => {
      (Backends.insert as any).mockResolvedValue(undefined);
      (Backends.update as any).mockResolvedValue(undefined);
      (Backends.delete as any).mockResolvedValue(undefined);
      (Backends.findByIri as any).mockResolvedValue(null);

      const entityId = 'mixed-ops-backend';
      
      // Start various operations concurrently
      const operations = [
        cacheManager.create({ $id: entityId, name: 'Created' }, 'Backend'),
        // These will likely fail due to entity not existing yet, but shouldn't crash
        new Promise(resolve => {
          setTimeout(() => resolve(cacheManager.get(entityId)), 5);
        }),
        new Promise(resolve => {
          setTimeout(async () => {
            try {
              await cacheManager.update(entityId, { name: 'Updated' }, 'Backend');
            } catch (e) {
              // Expected to possibly fail
            }
            resolve(null);
          }, 8);
        })
      ];

      // Should not throw any unhandled errors
      await expect(Promise.all(operations)).resolves.toBeDefined();
    });

    it('should prevent concurrent type refreshes', async () => {
      const mockDateNow = Date.now() + 100000; // Far in future to trigger refresh
      Date.now = vi.fn(() => mockDateNow);

      let findCallCount = 0;
      (Backends.find as any).mockImplementation(async () => {
        findCallCount++;
        await new Promise(resolve => setTimeout(resolve, 20));
        return [{ $id: 'backend1', name: 'Refreshed' }];
      });

      // Load initial data that will be stale
      const mockEntities = new Map([
        ['backend1', { $id: 'backend1', '@type': 'Backend', name: 'Original' }]
      ]);
      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();

      // Make multiple calls that should trigger type refresh
      const calls = [
        cacheManager.getByType('Backend'),
        cacheManager.getByType('Backend'),
        cacheManager.getByType('Backend')
      ];

      await Promise.all(calls.map(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
      }));

      // Should only call find once due to in-flight protection
      expect(findCallCount).toBe(1);
    });
  });

  // Performance and stress tests
  describe('Performance and Stress Tests', () => {
    it('should handle large cache efficiently', async () => {
      const largeEntityMap = new Map();
      
      // Create 10,000 entities
      for (let i = 0; i < 10000; i++) {
        largeEntityMap.set(`entity${i}`, {
          $id: `entity${i}`,
          '@type': i % 2 === 0 ? 'Backend' : 'Query',
          name: `Entity ${i}`,
          data: 'Some data '.repeat(10) // Add some bulk
        });
      }

      (loadAllSystemEntities as any).mockResolvedValue(largeEntityMap);

      const start = performance.now();
      await cacheManager.loadAll();
      const loadTime = performance.now() - start;

      expect(cacheManager.isReady()).toBe(true);
      expect(cacheManager.getStats().totalEntities).toBe(10000);
      
      // Test retrieval performance
      const retrievalStart = performance.now();
      const entity5000 = cacheManager.get('entity5000');
      const backends = cacheManager.getByType('Backend');
      const retrievalTime = performance.now() - retrievalStart;

      expect(entity5000).toBeDefined();
      expect(backends.length).toBe(5000);
      
      // These are generous limits - cache should be much faster
      expect(loadTime).toBeLessThan(1000); // 1 second to load 10k entities
      expect(retrievalTime).toBeLessThan(100); // 100ms for retrieval operations
    });

    it('should handle rapid CRUD operations', async () => {
      (loadAllSystemEntities as any).mockResolvedValue(new Map());
      await cacheManager.loadAll();

      (Backends.insert as any).mockResolvedValue(undefined);
      (Backends.update as any).mockResolvedValue(undefined);
      (Backends.delete as any).mockResolvedValue(undefined);
      (Backends.findByIri as any).mockResolvedValue(null);

      const operations = [];
      const numOperations = 1000;

      const start = performance.now();
      
      // Create many entities rapidly
      for (let i = 0; i < numOperations; i++) {
        operations.push(
          cacheManager.create(
            { $id: `rapid-entity-${i}`, name: `Entity ${i}` },
            'Backend'
          )
        );
      }

      await Promise.all(operations);
      const totalTime = performance.now() - start;

      expect(cacheManager.getStats().totalEntities).toBe(numOperations);
      expect(totalTime).toBeLessThan(5000); // Should complete in under 5 seconds
    });


    it('should handle memory efficiently with large entities', async () => {
      const createLargeEntity = (id: string) => ({
        $id: id,
        '@type': 'Backend',
        name: `Large Entity ${id}`,
        largeData: 'x'.repeat(10000), // 10KB of data per entity
        metadata: {
          nested: {
            deep: {
              data: 'y'.repeat(5000) // More nested data
            }
          }
        }
      });

      const largeEntities = new Map();
      for (let i = 0; i < 100; i++) {
        const entity = createLargeEntity(`large-${i}`);
        largeEntities.set(`large-${i}`, entity);
      }

      (loadAllSystemEntities as any).mockResolvedValue(largeEntities);
      
      const start = performance.now();
      await cacheManager.loadAll();
      const loadTime = performance.now() - start;

      expect(cacheManager.getStats().totalEntities).toBe(100);
      expect(loadTime).toBeLessThan(500); // Should load quickly even with large entities
      
      // Test that we can still retrieve efficiently
      const retrievalStart = performance.now();
      const entity = cacheManager.get('large-50');
      const retrievalTime = performance.now() - retrievalStart;

      expect(entity).toBeDefined();
      expect(entity?.largeData).toHaveLength(10000);
      expect(retrievalTime).toBeLessThan(10); // Very fast retrieval
    });
  });

  // Integration-style tests (testing multiple components together)
  describe('Integration Tests', () => {
    it('should work correctly with real entity types and operations', async () => {
      (loadAllSystemEntities as any).mockResolvedValue(new Map());
      await cacheManager.loadAll();

      // Mock all the different entity utilities
      (Backends.insert as any).mockResolvedValue(undefined);
      (Queries.insert as any).mockResolvedValue(undefined);
      (QueryGroups.insert as any).mockResolvedValue(undefined);
      (Libraries.insert as any).mockResolvedValue(undefined);

      (Backends.update as any).mockResolvedValue(undefined);
      (Queries.update as any).mockResolvedValue(undefined);

      (Backends.delete as any).mockResolvedValue(undefined);
      (Queries.delete as any).mockResolvedValue(undefined);

      // Create entities of different types
      const backend = await cacheManager.create({
        $id: 'test-backend-1',
        name: 'Test SPARQL Backend',
        endpoint: 'https://example.com/sparql'
      }, 'Backend');

      const query = await cacheManager.create({
        $id: 'test-query-1',
        name: 'Test Query',
        sparqlQuery: 'SELECT * WHERE { ?s ?p ?o } LIMIT 10'
      }, 'Query');

      const queryGroup = await cacheManager.create({
        $id: 'test-group-1',
        name: 'Test Query Group',
        description: 'A group of related queries'
      }, 'QueryGroup');

      const library = await cacheManager.create({
        $id: 'test-library-1',
        name: 'Test Library',
        version: '1.0.0'
      }, 'Library');

      // Verify all entities are cached correctly
      expect(cacheManager.getStats().totalEntities).toBe(4);
      expect(cacheManager.getByType('Backend')).toHaveLength(1);
      expect(cacheManager.getByType('Query')).toHaveLength(1);
      expect(cacheManager.getByType('QueryGroup')).toHaveLength(1);
      expect(cacheManager.getByType('Library')).toHaveLength(1);

      // Update entities
      const updatedBackend = await cacheManager.update('test-backend-1', {
        endpoint: 'https://updated.example.com/sparql'
      }, 'Backend');

      expect(updatedBackend).not.toBeNull();
      expect(updatedBackend!.endpoint).toBe('https://updated.example.com/sparql');
      expect(cacheManager.get('test-backend-1')).toEqual(updatedBackend);

      // Delete an entity
      await cacheManager.delete('test-query-1', 'Query');
      expect(cacheManager.get('test-query-1')).toBeNull();
      expect(cacheManager.getByType('Query')).toHaveLength(0);
      expect(cacheManager.getStats().totalEntities).toBe(3);
    });

    it('should handle complete cache refresh cycle', async () => {
      // Start with initial data
      const initialEntities = new Map([
        ['backend1', { $id: 'backend1', '@type': 'Backend', name: 'Backend 1' }],
        ['query1', { $id: 'query1', '@type': 'Query', name: 'Query 1' }]
      ]);
      (loadAllSystemEntities as any).mockResolvedValue(initialEntities);
      await cacheManager.loadAll();

      expect(cacheManager.getStats().totalEntities).toBe(2);

      // Mock fresh data for refresh
      (Backends.find as any).mockResolvedValue([
        { $id: 'backend1', name: 'Updated Backend 1' },
        { $id: 'backend3', name: 'New Backend 3' }
      ]);

      (Queries.find as any).mockResolvedValue([
        { $id: 'query1', name: 'Updated Query 1' },
        { $id: 'query2', name: 'New Query 2' }
      ]);

      // Refresh both entity types
      await cacheManager.refreshEntityType('Backend');
      await cacheManager.refreshEntityType('Query');

      // Verify the cache has been updated correctly
      expect(cacheManager.getStats().totalEntities).toBe(4);
      
      // Old entities should be updated
      expect(cacheManager.get('backend1')).toEqual({
        $id: 'backend1',
        '@type': 'Backend',
        name: 'Updated Backend 1'
      });
      expect(cacheManager.get('query1')).toEqual({
        $id: 'query1',
        '@type': 'Query',
        name: 'Updated Query 1'
      });

      // New entities should be added
      expect(cacheManager.get('backend3')).toEqual({
        $id: 'backend3',
        '@type': 'Backend',
        name: 'New Backend 3'
      });
      expect(cacheManager.get('query2')).toEqual({
        $id: 'query2',
        '@type': 'Query',
        name: 'New Query 2'
      });
    });
  });

  describe('behavior flags and invariants', () => {
    beforeEach(async () => {
      (loadAllSystemEntities as any).mockResolvedValue(new Map());
      await cacheManager.loadAll();
    });

    it('skips backend writes when CACHE_WRITE_THROUGH=false', async () => {
      process.env.CACHE_WRITE_THROUGH = 'false';
      const entity = { $id: 'backend-flag', name: 'Flag Backend' };

      await cacheManager.create(entity, 'Backend');

      expect(Backends.insert).not.toHaveBeenCalled();
      expect(cacheManager.get(entity.$id)).toMatchObject({ ...entity, '@type': 'Backend' });
    });

    it('avoids backend delete for ephemeral entities', async () => {
      const entity = { $id: 'ephemeral-query', name: 'Ephemeral Query' };
      cacheManager.addEphemeral(entity, 'Query');

      await cacheManager.delete(entity.$id, 'Query');

      expect(Queries.delete).not.toHaveBeenCalled();
      expect(cacheManager.get(entity.$id)).toBeNull();
    });

    it('removes ephemeral entities without persistence', async () => {
      const entity = { $id: 'ephemeral-remove', name: 'Remove Me' };
      cacheManager.addEphemeral(entity, 'Query');

      cacheManager.removeEphemeral(entity.$id);

      expect(Queries.delete).not.toHaveBeenCalled();
      expect(Queries.findByIri).not.toHaveBeenCalled();
      expect(cacheManager.get(entity.$id)).toBeNull();
    });

    it('does not trigger SWR refresh for ephemeral entities', async () => {
      const entity = { $id: 'ephemeral-swr', name: 'Ephemeral SWR' };
      cacheManager.addEphemeral(entity, 'Query');

      const now = Date.now();
      Date.now = vi.fn(() => now + 20_000);

      const result = cacheManager.get(entity.$id);

      expect(result).toMatchObject({ ...entity, '@type': 'Query' });
      expect(Queries.findByIri).not.toHaveBeenCalled();
    });

    it('does not trigger refresh when CACHE_PRELOAD=false', async () => {
      process.env.CACHE_PRELOAD = 'false';
      process.env.CACHE_WRITE_THROUGH = 'false';

      const freshCache = new MemoryCacheManager();
      (loadAllSystemEntities as any).mockResolvedValue(new Map());
      await freshCache.loadAll();

      const entity = { $id: 'backend-preload', name: 'Preload Backend' };
      await freshCache.create(entity, 'Backend');

      const now = Date.now();
      Date.now = vi.fn(() => now + 120_000);

      freshCache.getByType('Backend');

      await Promise.resolve();
      expect(Backends.find).not.toHaveBeenCalled();
    });
  });
});
