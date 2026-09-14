import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests for OxigraphStoreManager.
 *
 * NOTE: Oxigraph JS only supports in-memory stores. "Durable" stores are
 * serialized to .nq files on shutdown and restored on startup.
 * This is NOT true disk-backed persistence like RocksDB.
 */
describe('OxigraphStoreManager', () => {
  let manager: OxigraphStoreManager;
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for testing
    tempDir = path.join(os.tmpdir(), `oxigraph-test-${Date.now()}`);
    manager = new OxigraphStoreManager(tempDir);
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.shutdown();
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should create storage directory', async () => {
      const stats = await fs.stat(tempDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('durable stores', () => {
    it('should create a durable store', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await manager.createDurableStore('test-backend', config);
      expect(store).toBeDefined();
      expect(store.size).toBe(0);
    });

    it('should get existing durable store', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store1 = await manager.createDurableStore('test-backend', config);
      const store2 = manager.getDurableStore('test-backend');

      expect(store1).toBe(store2);
    });

    it('should support legacy persistent naming', async () => {
      const config = {
        storeType: 'persistent' as const,
        loadMethod: 'none' as const
      };

      // Legacy methods should still work
      const store = await manager.createPersistentStore('test-backend', config);
      expect(store).toBeDefined();
      expect(manager.getPersistentStore('test-backend')).toBe(store);
    });

    it('should load data from string', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await manager.createDurableStore('test-backend', config);
      const turtle = '<http://example.org/subject> <http://example.org/predicate> "object" .';

      await manager.loadDataFromString(store, turtle, 'turtle');
      expect(store.size).toBe(1);
    });

    it('should get store statistics', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      await manager.createDurableStore('test-backend', config);
      const stats = manager.getStoreStats('test-backend');

      expect(stats).toBeDefined();
      expect(stats!.tripleCount).toBe(0);
      expect(stats!.storeType).toBe('durable');
      expect(stats!.createdAt).toBeInstanceOf(Date);
      expect(stats!.lastAccessed).toBeInstanceOf(Date);
    });
  });

  describe('ephemeral stores', () => {
    it('should create ephemeral store', () => {
      const store = manager.createEphemeralStore('temp-store-1');
      expect(store).toBeDefined();
      expect(store.size).toBe(0);
    });

    it('should get existing ephemeral store', () => {
      const store1 = manager.createEphemeralStore('temp-store-1');
      const store2 = manager.getEphemeralStore('temp-store-1');
      
      expect(store1).toBe(store2);
    });

    it('should destroy ephemeral store', () => {
      manager.createEphemeralStore('temp-store-1');
      expect(manager.getEphemeralStore('temp-store-1')).toBeDefined();
      
      manager.destroyEphemeralStore('temp-store-1');
      expect(manager.getEphemeralStore('temp-store-1')).toBeNull();
    });

    it('should track ephemeral store statistics', () => {
      manager.createEphemeralStore('temp-store-1');
      const stats = manager.getStoreStats('temp-store-1');
      
      expect(stats).toBeDefined();
      expect(stats!.tripleCount).toBe(0);
    });
  });

  describe('data loading', () => {
    it('should load turtle data', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await manager.createDurableStore('test-backend', config);
      const turtle = `
        @prefix ex: <http://example.org/> .
        ex:subject1 ex:predicate1 "value1" .
        ex:subject2 ex:predicate2 "value2" .
      `;

      await manager.loadDataFromString(store, turtle, 'turtle');
      expect(store.size).toBe(2);
    });

    it('should load n-triples data', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await manager.createDurableStore('test-backend', config);
      const ntriples = `
        <http://example.org/subject1> <http://example.org/predicate1> "value1" .
        <http://example.org/subject2> <http://example.org/predicate2> "value2" .
      `;

      await manager.loadDataFromString(store, ntriples, 'ntriples');
      expect(store.size).toBe(2);
    });

    it('should handle invalid RDF data', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await manager.createDurableStore('test-backend', config);
      const invalidTurtle = 'invalid turtle data';

      await expect(
        manager.loadDataFromString(store, invalidTurtle, 'turtle')
      ).rejects.toThrow();
    });
  });

  describe('format detection', () => {
    const testCases = [
      { format: 'turtle', expected: 'text/turtle' },
      { format: 'ttl', expected: 'text/turtle' },
      { format: 'ntriples', expected: 'application/n-triples' },
      { format: 'nt', expected: 'application/n-triples' },
      { format: 'rdfxml', expected: 'application/rdf+xml' },
      { format: 'jsonld', expected: 'application/ld+json' },
      { format: 'unknown', expected: 'text/turtle' }, // default
    ];

    testCases.forEach(({ format, expected }) => {
      it(`should convert ${format} to ${expected}`, () => {
        // Access private method for testing
        const mimeType = (manager as any).formatToMimeType(format);
        expect(mimeType).toBe(expected);
      });
    });
  });

  describe('serialization', () => {
    it('should serialize durable store to .nq file', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await manager.createDurableStore('test-backend', config);
      const turtle = '<http://example.org/subject> <http://example.org/predicate> "object" .';
      await manager.loadDataFromString(store, turtle, 'turtle');

      await manager.serializeDurableStore('test-backend');

      // Check that file was created (backend ID with special chars becomes underscores)
      const expectedFile = path.join(tempDir, 'test_backend.nq');
      const stats = await fs.stat(expectedFile);
      expect(stats.isFile()).toBe(true);

      const content = await fs.readFile(expectedFile, 'utf8');
      expect(content).toContain('<http://example.org/subject>');
      expect(content).toContain('<http://example.org/predicate>');
      expect(content).toContain('"object"');
    });

    it('should restore durable store from .nq file on next creation', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      // Create and populate store
      const store1 = await manager.createDurableStore('test-backend', config);
      const turtle = '<http://example.org/subject> <http://example.org/predicate> "object" .';
      await manager.loadDataFromString(store1, turtle, 'turtle');
      expect(store1.size).toBe(1);

      // Serialize and shutdown
      await manager.serializeDurableStore('test-backend');
      await manager.shutdown();

      // Create new manager and verify data is restored
      const manager2 = new OxigraphStoreManager(tempDir);
      await manager2.initialize();
      const store2 = await manager2.createDurableStore('test-backend', config);

      expect(store2.size).toBe(1);
      await manager2.shutdown();
    });

    it('should support legacy serializePersistentStore method', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await manager.createDurableStore('test-backend', config);
      const turtle = '<http://example.org/subject> <http://example.org/predicate> "object" .';
      await manager.loadDataFromString(store, turtle, 'turtle');

      // Legacy method should still work
      await manager.serializePersistentStore('test-backend');

      const expectedFile = path.join(tempDir, 'test_backend.nq');
      const stats = await fs.stat(expectedFile);
      expect(stats.isFile()).toBe(true);
    });

    it('should refuse to start empty when a snapshot exists but cannot be read', async () => {
      // The chain this guards: a snapshot that fails to load used to be
      // swallowed as "no snapshot", the store came up empty, and the next
      // checkpoint wrote the empty store over the file. The data was still on
      // disk right up to that write.
      const snapshotPath = path.join(tempDir, 'test_backend.nq');
      await fs.writeFile(snapshotPath, 'not n-quads at all\n');

      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      await expect(manager.createDurableStore('test-backend', config)).rejects.toThrow(
        /store snapshot/
      );
      expect(await fs.readFile(snapshotPath, 'utf8')).toBe('not n-quads at all\n');
    });
  });

  describe('error handling', () => {
    it('should handle missing store for statistics', () => {
      const stats = manager.getStoreStats('non-existent');
      expect(stats).toBeNull();
    });

    it('should handle missing ephemeral store destruction', () => {
      // Should not throw
      manager.destroyEphemeralStore('non-existent');
    });

    it('should handle serialization of non-existent store', async () => {
      await expect(
        manager.serializeDurableStore('non-existent')
      ).rejects.toThrow();
    });

    it('should auto-initialize when creating durable store', async () => {
      const uninitializedManager = new OxigraphStoreManager(tempDir);
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      // Should auto-initialize, not throw
      const store = await uninitializedManager.createDurableStore('test', config);
      expect(store).toBeDefined();
      await uninitializedManager.shutdown();
    });

    it('should throw error when serializing without initialization', async () => {
      const uninitializedManager = new OxigraphStoreManager();

      await expect(
        uninitializedManager.serializeDurableStore('test')
      ).rejects.toThrow('OxigraphStoreManager not initialized');
    });

    it('should allow ephemeral stores without initialization', () => {
      const uninitializedManager = new OxigraphStoreManager();

      // Should not throw - ephemeral stores work without initialization
      const store = uninitializedManager.createEphemeralStore('test');
      expect(store).toBeDefined();
      expect(store.size).toBe(0);
    });
  });

  describe('memory management', () => {
    it('should track memory usage estimation', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      const store = await manager.createDurableStore('test-backend', config);
      const turtle = '<http://example.org/subject> <http://example.org/predicate> "object" .';
      await manager.loadDataFromString(store, turtle, 'turtle');

      const stats = manager.getStoreStats('test-backend');
      expect(stats!.memoryUsage).toBeGreaterThan(0);
    });

    it('should get all store statistics', async () => {
      const config = {
        storeType: 'durable' as const,
        loadMethod: 'none' as const
      };

      await manager.createDurableStore('backend1', config);
      manager.createEphemeralStore('ephemeral1');

      const allStats = manager.getAllStoreStats();
      expect(allStats.size).toBe(2);
      expect(allStats.has('backend1')).toBe(true);
      expect(allStats.has('ephemeral1')).toBe(true);
    });
  });
});