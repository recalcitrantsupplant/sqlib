import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('OxigraphStoreManager - Memory Tracking', () => {
  let storeManager: OxigraphStoreManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join('/tmp', `oxigraph-test-${Date.now()}`);
    storeManager = new OxigraphStoreManager(tempDir);
    await storeManager.initialize();
  });

  afterEach(async () => {
    await storeManager.shutdown();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('store statistics tracking', () => {
    it('should track memory usage for ephemeral stores', () => {
      const storeId = 'test-ephemeral-store';
      const store = storeManager.createEphemeralStore(storeId);

      const stats = storeManager.getStoreStats(storeId);
      expect(stats).toBeDefined();
      expect(stats!.tripleCount).toBe(0);
      expect(stats!.memoryUsage).toBe(0); // Empty store
      expect(stats!.createdAt).toBeInstanceOf(Date);
      expect(stats!.lastAccessed).toBeInstanceOf(Date);
    });

    it('should update memory usage when triples are added', async () => {
      const storeId = 'test-store-with-data';
      const store = storeManager.createEphemeralStore(storeId);

      // Add some test data
      const testData = `
        @prefix ex: <http://example.org/> .
        ex:subject1 ex:predicate1 "value1" .
        ex:subject2 ex:predicate2 "value2" .
        ex:subject3 ex:predicate3 "value3" .
      `;

      await storeManager.loadDataFromString(store, testData, 'turtle');

      const stats = storeManager.getStoreStats(storeId);
      expect(stats).toBeDefined();
      expect(stats!.tripleCount).toBe(3);
      expect(stats!.memoryUsage).toBeGreaterThan(0);
      expect(stats!.memoryUsage).toBe(3 * 100); // 100 bytes per triple estimate
    });

    it('should track multiple stores independently', async () => {
      const store1Id = 'store1';
      const store2Id = 'store2';

      const store1 = storeManager.createEphemeralStore(store1Id);
      const store2 = storeManager.createEphemeralStore(store2Id);

      // Add different amounts of data to each store
      const smallData = '@prefix ex: <http://example.org/> . ex:s1 ex:p1 "v1" .';
      const largeData = `
        @prefix ex: <http://example.org/> .
        ex:s1 ex:p1 "v1" .
        ex:s2 ex:p2 "v2" .
        ex:s3 ex:p3 "v3" .
        ex:s4 ex:p4 "v4" .
        ex:s5 ex:p5 "v5" .
      `;

      await storeManager.loadDataFromString(store1, smallData, 'turtle');
      await storeManager.loadDataFromString(store2, largeData, 'turtle');

      const stats1 = storeManager.getStoreStats(store1Id);
      const stats2 = storeManager.getStoreStats(store2Id);

      expect(stats1!.tripleCount).toBe(1);
      expect(stats2!.tripleCount).toBe(5);
      expect(stats2!.memoryUsage).toBeGreaterThan(stats1!.memoryUsage);
    });

    it('should provide aggregate statistics', async () => {
      // Create multiple stores with data
      const store1 = storeManager.createEphemeralStore('agg-store-1');
      const store2 = storeManager.createEphemeralStore('agg-store-2');

      const data1 = '@prefix ex: <http://example.org/> . ex:s1 ex:p1 "v1" . ex:s2 ex:p2 "v2" .';
      const data2 = '@prefix ex: <http://example.org/> . ex:s3 ex:p3 "v3" . ex:s4 ex:p4 "v4" . ex:s5 ex:p5 "v5" .';

      await storeManager.loadDataFromString(store1, data1, 'turtle');
      await storeManager.loadDataFromString(store2, data2, 'turtle');

      const allStats = storeManager.getAllStoreStats();

      expect(allStats.size).toBe(2);

      let totalTriples = 0;
      let totalMemory = 0;
      allStats.forEach(stats => {
        totalTriples += stats.tripleCount;
        totalMemory += stats.memoryUsage;
      });

      expect(totalTriples).toBe(5); // 2 + 3 triples
      expect(totalMemory).toBe(500); // 5 * 100 bytes
    });

    it('should update access time when stores are retrieved', async () => {
      const storeId = 'access-time-test';
      storeManager.createEphemeralStore(storeId);

      const initialStats = storeManager.getStoreStats(storeId);
      const initialAccessTime = initialStats!.lastAccessed.getTime();

      // Wait a moment and access the store
      await new Promise(resolve => setTimeout(resolve, 10));

      storeManager.getEphemeralStore(storeId);

      const updatedStats = storeManager.getStoreStats(storeId);
      expect(updatedStats!.lastAccessed.getTime()).toBeGreaterThanOrEqual(initialAccessTime);
    });

    it('should clean up stats when stores are destroyed', () => {
      const storeId = 'cleanup-test';
      storeManager.createEphemeralStore(storeId);

      expect(storeManager.getStoreStats(storeId)).toBeDefined();

      storeManager.destroyEphemeralStore(storeId);

      expect(storeManager.getStoreStats(storeId)).toBeNull();
      expect(storeManager.getAllStoreStats().has(storeId)).toBe(false);
    });
  });

  describe('memory estimation accuracy', () => {
    it('should provide reasonable memory estimates', async () => {
      const storeId = 'memory-estimate-test';
      const store = storeManager.createEphemeralStore(storeId);

      // Add a known amount of data
      const testTriples = Array.from({ length: 100 }, (_, i) =>
        `@prefix ex: <http://example.org/> . ex:subject${i} ex:predicate${i} "value${i}" .`
      ).join('\n');

      await storeManager.loadDataFromString(store, testTriples, 'turtle');

      const stats = storeManager.getStoreStats(storeId);
      expect(stats!.tripleCount).toBe(100);
      expect(stats!.memoryUsage).toBe(100 * 100); // 100 bytes per triple

      // Memory estimate should be proportional to triple count
      expect(stats!.memoryUsage / stats!.tripleCount).toBe(100);
    });
  });
});