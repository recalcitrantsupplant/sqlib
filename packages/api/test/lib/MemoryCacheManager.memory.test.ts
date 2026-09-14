import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryCacheManager } from '../../src/lib/MemoryCacheManager.js';
import { loadAllSystemEntities } from '../../src/persistence/utils/entityRepository.js';

// Mock the entity repository module
vi.mock('../../src/persistence/utils/entityRepository.js', () => ({
  loadAllSystemEntities: vi.fn(),
  createRepositoryLens: vi.fn(() => ({
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findByIri: vi.fn(),
    find: vi.fn(),
  })),
}));

// This suite's subject is cache logic; storage is a stub. It runs against a
// double built from those stubs (see lensBackedAdapter), so what is asserted is
// what the cache did, not what the persistence layer did.
vi.mock('../../src/persistence/adapterRegistry', async () => {
  const { lensBackedAdapter } = await import('../persistence/lensBackedAdapter.js');
  return { getPersistenceAdapter: () => lensBackedAdapter, setPersistenceAdapter: () => {} };
});

vi.mock('../../src/system-store/SystemStoreLoader.js', () => ({
  loadSystemStore: vi.fn(async () => ({
    cacheEntries: new Map(),
    assetDir: 'test-assets',
  })),
  getKnownSystemEntityIds: vi.fn(() => new Set()),
}));

// Mock all the lens utilities
vi.mock('../../src/persistence/utils/BackendUtils.js', () => ({
  Backends: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findByIri: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/LibraryUtils.js', () => ({
  Libraries: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findByIri: vi.fn(),
    find: vi.fn(),
  },
}));

describe('MemoryCacheManager - Enhanced Memory Statistics', () => {
  let cacheManager: MemoryCacheManager;

  beforeEach(() => {
    cacheManager = new MemoryCacheManager();
    vi.clearAllMocks();
  });

  describe('enhanced getStats with memory estimation', () => {
    it('should include memory estimation in stats', async () => {
      const mockEntities = new Map([
        ['id1', { $id: 'id1', '@type': 'Backend', name: 'Test Backend', url: 'http://example.com' }],
        ['id2', { $id: 'id2', '@type': 'Library', name: 'Test Library', description: 'A test library' }],
      ]);

      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();

      const stats = cacheManager.getStats();

      // Check new structure
      expect(stats).toHaveProperty('estimatedMemoryBytes');
      expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);

      // Check entity types structure
      expect(stats.entityTypes).toHaveProperty('Backend');
      expect(stats.entityTypes).toHaveProperty('Library');

      expect(stats.entityTypes.Backend).toEqual({
        count: 1,
        memoryBytes: expect.any(Number)
      });

      expect(stats.entityTypes.Library).toEqual({
        count: 1,
        memoryBytes: expect.any(Number)
      });

      // Total memory should equal sum of type memories plus overhead
      const expectedMemory = stats.entityTypes.Backend.memoryBytes +
                            stats.entityTypes.Library.memoryBytes +
                            (2 * 50); // Map overhead for 2 entries

      expect(stats.estimatedMemoryBytes).toBe(expectedMemory);
    });

    it('should handle entities with varying sizes', async () => {
      const smallEntity = { $id: 'small', '@type': 'Backend', name: 'S' };
      const largeEntity = {
        $id: 'large',
        '@type': 'Backend',
        name: 'Large Backend with lots of data',
        description: 'This is a very long description that should take up more memory space than the small entity above',
        metadata: {
          tags: ['tag1', 'tag2', 'tag3'],
          config: {
            option1: true,
            option2: 'complex value',
            option3: [1, 2, 3, 4, 5]
          }
        }
      };

      const mockEntities = new Map([
        ['small', smallEntity],
        ['large', largeEntity],
      ]);

      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();

      const stats = cacheManager.getStats();

      // Both entities are Backend type, so they should be aggregated
      expect(stats.entityTypes.Backend.count).toBe(2);
      expect(stats.entityTypes.Backend.memoryBytes).toBeGreaterThan(0);

      // Verify that the large entity contributes significantly more to memory
      const smallJson = JSON.stringify(smallEntity);
      const largeJson = JSON.stringify(largeEntity);
      const smallBytes = Buffer.byteLength(smallJson, 'utf8');
      const largeBytes = Buffer.byteLength(largeJson, 'utf8');

      expect(largeBytes).toBeGreaterThan(smallBytes * 2); // Large should be significantly bigger
      expect(stats.entityTypes.Backend.memoryBytes).toBe(smallBytes + largeBytes);
    });

    it('should include Map overhead in total memory calculation', async () => {
      const mockEntities = new Map([
        ['id1', { $id: 'id1', '@type': 'Backend' }],
        ['id2', { $id: 'id2', '@type': 'Backend' }],
        ['id3', { $id: 'id3', '@type': 'Backend' }],
      ]);

      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();

      const stats = cacheManager.getStats();

      // Calculate expected overhead (50 bytes per Map entry)
      const expectedOverhead = 3 * 50;
      const entityMemory = stats.entityTypes.Backend.memoryBytes;

      expect(stats.estimatedMemoryBytes).toBe(entityMemory + expectedOverhead);
    });

    it('should handle empty cache memory calculation', () => {
      const stats = cacheManager.getStats();

      expect(stats.estimatedMemoryBytes).toBe(0);
      expect(stats.entityTypes).toEqual({});
    });

    it('should handle entities with special characters and unicode', async () => {
      const unicodeEntity = {
        $id: 'unicode-test',
        '@type': 'Library',
        name: 'Test with émojis 🚀 and ünïcödé',
        description: 'This entity contains special characters: ñáéíóú, 中文, العربية, русский'
      };

      const mockEntities = new Map([['unicode-test', unicodeEntity]]);

      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();

      const stats = cacheManager.getStats();

      // Unicode characters should be properly counted using Buffer.byteLength
      const expectedBytes = Buffer.byteLength(JSON.stringify(unicodeEntity), 'utf8');
      expect(stats.entityTypes.Library.memoryBytes).toBe(expectedBytes);
    });

    it('should track memory by multiple entity types', async () => {
      const mockEntities = new Map([
        ['backend1', { $id: 'backend1', '@type': 'Backend', name: 'Backend 1' }],
        ['backend2', { $id: 'backend2', '@type': 'Backend', name: 'Backend 2' }],
        ['library1', { $id: 'library1', '@type': 'Library', name: 'Library 1' }],
        ['query1', { $id: 'query1', '@type': 'Query', name: 'Query 1' }],
        ['unknown1', { $id: 'unknown1', name: 'No Type' }], // Entity without @type
      ]);

      (loadAllSystemEntities as any).mockResolvedValue(mockEntities);
      await cacheManager.loadAll();

      const stats = cacheManager.getStats();

      expect(stats.totalEntities).toBe(5);
      expect(Object.keys(stats.entityTypes)).toHaveLength(4); // Backend, Library, Query, Unknown

      expect(stats.entityTypes.Backend.count).toBe(2);
      expect(stats.entityTypes.Library.count).toBe(1);
      expect(stats.entityTypes.Query.count).toBe(1);
      expect(stats.entityTypes.Unknown.count).toBe(1);

      // Each type should have positive memory usage
      Object.values(stats.entityTypes).forEach(typeStats => {
        expect(typeStats.memoryBytes).toBeGreaterThan(0);
      });

      // Total memory should be sum of all type memories plus overhead
      const totalTypeMemory = Object.values(stats.entityTypes)
        .reduce((sum, typeStats) => sum + typeStats.memoryBytes, 0);
      const overhead = 5 * 50; // 5 entities * 50 bytes overhead each

      expect(stats.estimatedMemoryBytes).toBe(totalTypeMemory + overhead);
    });
  });
});
