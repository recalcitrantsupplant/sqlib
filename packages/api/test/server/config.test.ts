import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';

describe('server/config', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Save original environment variables
    originalEnv = { ...process.env };
    // Clear relevant env vars to start with clean state
    delete process.env.INTERNAL_BACKEND_TYPE;
    delete process.env.INTERNAL_OXIGRAPH_DB_PATH;
    delete process.env.LIBRARY_STORAGE_SPARQL_ENDPOINT;
    delete process.env.LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT;
    delete process.env.LIBRARY_STORAGE_SPARQL_USERNAME;
    delete process.env.LIBRARY_STORAGE_SPARQL_PASSWORD;
    delete process.env.ENABLE_TIMING_LOGS;
    delete process.env.LIBRARY_STORAGE_DIR;
    delete process.env.INTERNAL_OXIGRAPH_LOAD_METHOD;
    delete process.env.INTERNAL_OXIGRAPH_BOOTSTRAP_SOURCE;
    delete process.env.INTERNAL_OXIGRAPH_STORE_ID;

    // Clear module cache to force re-evaluation of config
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original environment variables
    process.env = originalEnv;
    vi.resetModules();
  });

  describe('default configuration', () => {
    it('should use http backend with default values when no env vars set', async () => {
      const { config } = await import('../../src/server/config.js');

      expect(config.enableTimingLogs).toBe(true);
      expect(config.internalBackend).toEqual({
        type: 'http',
        baseUrl: 'http://localhost:3030/sqlib/',
        queryUrl: 'http://localhost:3030/sqlib/',
        updateUrl: 'http://localhost:3030/sqlib/',
        username: undefined,
        password: undefined,
      });
    });

    it('should enable timing logs by default', async () => {
      const { config } = await import('../../src/server/config.js');

      expect(config.enableTimingLogs).toBe(true);
    });
  });

  describe('timing logs configuration', () => {
    it('should enable timing logs when ENABLE_TIMING_LOGS is true', async () => {
      process.env.ENABLE_TIMING_LOGS = 'true';

      const { config } = await import('../../src/server/config.js');

      expect(config.enableTimingLogs).toBe(true);
    });

    it('should still enable timing logs when ENABLE_TIMING_LOGS is false (default override)', async () => {
      process.env.ENABLE_TIMING_LOGS = 'false';

      const { config } = await import('../../src/server/config.js');

      // Note: The current implementation has `|| true` which overrides false
      expect(config.enableTimingLogs).toBe(true);
    });

    it('should enable timing logs for any other value', async () => {
      process.env.ENABLE_TIMING_LOGS = 'anything';

      const { config } = await import('../../src/server/config.js');

      expect(config.enableTimingLogs).toBe(true);
    });
  });

  describe('HTTP backend configuration', () => {
    it('should use custom SPARQL endpoint when provided', async () => {
      process.env.LIBRARY_STORAGE_SPARQL_ENDPOINT = 'http://example.com:8080/fuseki/dataset';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend).toEqual({
        type: 'http',
        baseUrl: 'http://example.com:8080/fuseki/dataset',
        queryUrl: 'http://example.com:8080/fuseki/dataset',
        updateUrl: 'http://example.com:8080/fuseki/dataset',
        username: undefined,
        password: undefined,
      });
    });

    it('should not add /sparql suffix if endpoint already ends with /sparql', async () => {
      process.env.LIBRARY_STORAGE_SPARQL_ENDPOINT = 'http://example.com/fuseki/dataset/sparql';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend.type).toBe('http');
      const httpConfig = config.internalBackend as any;
      expect(httpConfig.queryUrl).toBe('http://example.com/fuseki/dataset/sparql');
    });

    it('should use custom update endpoint when provided', async () => {
      process.env.LIBRARY_STORAGE_SPARQL_ENDPOINT = 'http://example.com/fuseki/dataset';
      process.env.LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT = 'http://example.com/custom';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend.type).toBe('http');
      const httpConfig = config.internalBackend as any;
      expect(httpConfig.updateUrl).toBe('http://example.com/custom');
    });

    it('should configure basic auth when username and password provided', async () => {
      process.env.LIBRARY_STORAGE_SPARQL_ENDPOINT = 'http://example.com/fuseki/dataset';
      process.env.LIBRARY_STORAGE_SPARQL_USERNAME = 'admin';
      process.env.LIBRARY_STORAGE_SPARQL_PASSWORD = 'secret123';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend.type).toBe('http');
      const httpConfig = config.internalBackend as any;
      expect(httpConfig.username).toBe('admin');
      expect(httpConfig.password).toBe('secret123');
    });

    it('should handle partial auth configuration (username only)', async () => {
      process.env.LIBRARY_STORAGE_SPARQL_USERNAME = 'admin';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend.type).toBe('http');
      const httpConfig = config.internalBackend as any;
      expect(httpConfig.username).toBe('admin');
      expect(httpConfig.password).toBeUndefined();
    });

    it('should handle partial auth configuration (password only)', async () => {
      process.env.LIBRARY_STORAGE_SPARQL_PASSWORD = 'secret123';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend.type).toBe('http');
      const httpConfig = config.internalBackend as any;
      expect(httpConfig.username).toBeUndefined();
      expect(httpConfig.password).toBe('secret123');
    });
  });

  describe('Oxigraph backend configuration', () => {
    it('should configure oxigraph-memory backend when type is set', async () => {
      process.env.INTERNAL_BACKEND_TYPE = 'oxigraph-memory';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend).toEqual({
        type: 'oxigraph-memory',
        dbPath: undefined,
      });
    });

    it('should configure oxigraph-memory backend with custom db path', async () => {
      process.env.INTERNAL_BACKEND_TYPE = 'oxigraph-memory';
      process.env.INTERNAL_OXIGRAPH_DB_PATH = '/custom/path/to/db';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend).toEqual({
        type: 'oxigraph-memory',
        dbPath: '/custom/path/to/db',
      });
    });

    it('should ignore oxigraph db path when not using oxigraph backend', async () => {
      process.env.INTERNAL_BACKEND_TYPE = 'http';
      process.env.INTERNAL_OXIGRAPH_DB_PATH = '/ignored/path';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend.type).toBe('http');
      expect((config.internalBackend as any).dbPath).toBeUndefined();
    });

    it('should configure oxigraph-persistent backend with defaults', async () => {
      // Note: oxigraph-persistent is a "durable" store (in-memory with .nq serialization)
      // NOT a true disk-backed RocksDB store. The persistPath is deprecated and ignored.
      process.env.INTERNAL_BACKEND_TYPE = 'oxigraph-persistent';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend).toEqual({
        type: 'oxigraph-persistent',
        storeId: 'library-store',
        // persistPath is deprecated - oxigraph JS doesn't support RocksDB
        persistPath: path.resolve('./storage/library-store/rocksdb'),
        loadMethod: 'none',
        sourceConfig: undefined,
        storageDir: path.resolve('./storage/library-store'),
        checkpointIntervalMs: 60000,
      });
    });

    it('should honor custom persistent settings and bootstrap source', async () => {
      // Note: oxigraph-persistent is a "durable" store (in-memory with .nq serialization)
      // NOT a true disk-backed RocksDB store. The persistPath is deprecated and ignored.
      process.env.INTERNAL_BACKEND_TYPE = 'oxigraph-persistent';
      process.env.LIBRARY_STORAGE_DIR = '/data/library';
      process.env.INTERNAL_OXIGRAPH_DB_PATH = './relative/path/db'; // Deprecated, ignored
      process.env.INTERNAL_OXIGRAPH_STORE_ID = 'custom-store';
      process.env.INTERNAL_OXIGRAPH_LOAD_METHOD = 'REMOTE-SPARQL';
      process.env.INTERNAL_OXIGRAPH_BOOTSTRAP_SOURCE = JSON.stringify({
        remoteEndpoint: 'https://example.org/sparql',
        importQuery: 'CONSTRUCT WHERE { ?s ?p ?o }'
      });

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend).toEqual({
        type: 'oxigraph-persistent',
        storeId: 'custom-store',
        // persistPath is deprecated - oxigraph JS doesn't support RocksDB
        persistPath: path.resolve('./relative/path/db'),
        loadMethod: 'remote-sparql',
        sourceConfig: {
          remoteEndpoint: 'https://example.org/sparql',
          importQuery: 'CONSTRUCT WHERE { ?s ?p ?o }'
        },
        storageDir: path.resolve('/data/library'),
        checkpointIntervalMs: 60000,
      });
    });
  });

  describe('backend type handling', () => {
    it('should default to http for unknown backend types', async () => {
      process.env.INTERNAL_BACKEND_TYPE = 'unknown-type';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend.type).toBe('http');
    });

    it('should default to http for empty backend type', async () => {
      process.env.INTERNAL_BACKEND_TYPE = '';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend.type).toBe('http');
    });

    it('should be case sensitive for backend type', async () => {
      process.env.INTERNAL_BACKEND_TYPE = 'OXIGRAPH-MEMORY';

      const { config } = await import('../../src/server/config.js');

      // Should default to http since case doesn't match
      expect(config.internalBackend.type).toBe('http');
    });
  });

  describe('edge cases and combinations', () => {
    it('should handle complex HTTP endpoint URLs', async () => {
      process.env.LIBRARY_STORAGE_SPARQL_ENDPOINT = 'https://secure.example.com:9999/complex/path/to/fuseki/dataset';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend.type).toBe('http');
      const httpConfig = config.internalBackend as any;
      expect(httpConfig.baseUrl).toBe('https://secure.example.com:9999/complex/path/to/fuseki/dataset');
      expect(httpConfig.queryUrl).toBe('https://secure.example.com:9999/complex/path/to/fuseki/dataset');
      expect(httpConfig.updateUrl).toBe('https://secure.example.com:9999/complex/path/to/fuseki/dataset');
    });

    it('should handle endpoint URLs with trailing slashes', async () => {
      process.env.LIBRARY_STORAGE_SPARQL_ENDPOINT = 'http://example.com/fuseki/dataset/';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend.type).toBe('http');
      const httpConfig = config.internalBackend as any;
      expect(httpConfig.queryUrl).toBe('http://example.com/fuseki/dataset/');
      expect(httpConfig.updateUrl).toBe('http://example.com/fuseki/dataset/');
    });

    it('should handle all environment variables together', async () => {
      process.env.ENABLE_TIMING_LOGS = 'true';
      process.env.INTERNAL_BACKEND_TYPE = 'http';
      process.env.LIBRARY_STORAGE_SPARQL_ENDPOINT = 'http://test.example.com/fuseki/test';
      process.env.LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT = 'http://test.example.com/fuseki/test';
      process.env.LIBRARY_STORAGE_SPARQL_USERNAME = 'testuser';
      process.env.LIBRARY_STORAGE_SPARQL_PASSWORD = 'testpass';

      const { config } = await import('../../src/server/config.js');

      expect(config).toEqual({
        cachePreloadEnabled: true,
        enableTimingLogs: true,
        cacheWriteThroughEnabled: true,
        internalBackend: {
          type: 'http',
          baseUrl: 'http://test.example.com/fuseki/test',
          queryUrl: 'http://test.example.com/fuseki/test',
          updateUrl: 'http://test.example.com/fuseki/test',
          username: 'testuser',
          password: 'testpass',
        },
      });
    });

    it('should handle empty string environment variables', async () => {
      process.env.LIBRARY_STORAGE_SPARQL_USERNAME = '';
      process.env.LIBRARY_STORAGE_SPARQL_PASSWORD = '';
      process.env.INTERNAL_OXIGRAPH_DB_PATH = '';

      const { config } = await import('../../src/server/config.js');

      expect(config.internalBackend.type).toBe('http');
      const httpConfig = config.internalBackend as any;
      expect(httpConfig.username).toBe('');
      expect(httpConfig.password).toBe('');
    });
  });

  describe('configuration immutability', () => {
    it('should return the same config object on multiple imports', async () => {
      const { config: config1 } = await import('../../src/server/config.js');
      const { config: config2 } = await import('../../src/server/config.js');

      expect(config1).toBe(config2);
    });

    it('should not change when environment variables change after import', async () => {
      const { config } = await import('../../src/server/config.js');
      const originalBackendType = config.internalBackend.type;

      // Change env var after import
      process.env.INTERNAL_BACKEND_TYPE = 'oxigraph-memory';

      // Config should not change
      expect(config.internalBackend.type).toBe(originalBackendType);
    });
  });
});
