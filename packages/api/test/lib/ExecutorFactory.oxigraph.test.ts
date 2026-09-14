/**
 * Tests for ExecutorFactory oxigraph backend handling.
 *
 * NOTE: Oxigraph JS only supports in-memory stores. "Persistent" stores are
 * actually "durable" stores (in-memory, serialized to .nq on shutdown).
 * This is NOT true disk-backed persistence like RocksDB.
 * The legacy "persistent" naming is kept for backward compatibility.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import type { ResolvedNode } from '../../src/lib/orchestration/types.js';
import { BackendTypeIri, type LdkitBackend } from '../../src/persistence/schemas/BackendSchema.js';
import { LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';

const hoisted = vi.hoisted(() => ({
  mockConfig: {
    internalBackend: {
      type: 'http',
      baseUrl: 'http://internal',
      queryUrl: 'http://internal/query',
      updateUrl: 'http://internal/update',
      username: 'user',
      password: 'pass',
    },
  },
  mockGet: vi.fn(),
}));

vi.mock('../../src/server/config.js', () => ({
  config: hoisted.mockConfig,
}));

// Mock the dependencies
vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.mockGet,
  }),
}));

vi.mock('../../src/lib/OxigraphStoreManager.js', () => ({
  oxigraphStoreManager: {
    getPersistentStore: vi.fn(),
    createPersistentStore: vi.fn(),
    createDurableStore: vi.fn(),
    getEphemeralStore: vi.fn(),
    createEphemeralStore: vi.fn(),
    isInitialized: vi.fn(() => true),
    initialize: vi.fn(),
  }
}));

vi.mock('../../src/server/OxigraphSparqlExecutor.js', () => ({
  OxigraphSparqlExecutor: vi.fn().mockImplementation(function (store) {
    return {
      store,
      selectQueryParsed: vi.fn(),
      constructQueryParsed: vi.fn(),
      askQuery: vi.fn(),
      update: vi.fn()
    };
  })
}));

vi.mock('../../src/server/HttpSparqlExecutor.js', () => ({
  HttpSparqlExecutor: vi.fn().mockImplementation(function (config) {
    return {
      config,
      selectQueryParsed: vi.fn(),
      constructQueryParsed: vi.fn(),
      askQuery: vi.fn(),
      update: vi.fn()
    };
  })
}));

describe('ExecutorFactory - Oxigraph Integration', () => {
  let factory: ExecutorFactory;
  let mockOxigraphStore: any;

  beforeEach(() => {
    factory = new ExecutorFactory();
    mockOxigraphStore = { size: 0, query: vi.fn(), update: vi.fn() };
    vi.clearAllMocks();
    hoisted.mockConfig.internalBackend = {
      type: 'http',
      baseUrl: 'http://internal',
      queryUrl: 'http://internal/query',
      updateUrl: 'http://internal/update',
      username: 'user',
      password: 'pass',
    };
  });

  const buildLibraryNode = (): ResolvedNode => ({
    id: 'node-lib',
    raw: {},
    backendId: LIBRARY_STORAGE_BACKEND_ID,
    queryVersionId: 'query-v1',
    queryVersion: {} as any,
    queryString: 'SELECT * WHERE { ?s ?p ?o }',
    queryType: QueryTypeIri.select,
    inputTupleIds: [],
    outputTupleIds: []
  });

  describe('library storage backend', () => {
    it('should create HTTP executor when internal backend is HTTP', async () => {
      hoisted.mockConfig.internalBackend = {
        type: 'http',
        baseUrl: 'http://internal',
        queryUrl: 'http://internal/query',
        updateUrl: 'http://internal/update',
        username: 'system',
        password: 'secret'
      };

      const executor = await factory.getExecutorForNode(buildLibraryNode());
      expect(executor).toBeDefined();
      expect((executor as any).config).toMatchObject({
        queryUrl: 'http://internal/query',
        updateUrl: 'http://internal/update',
        username: 'system',
        password: 'secret'
      });
    });

    it('should create persistent oxigraph executor when internal backend is persistent', async () => {
      hoisted.mockConfig.internalBackend = {
        type: 'oxigraph-persistent',
        storeId: 'library-store',
        persistPath: '/var/lib/rocks',
        loadMethod: 'none',
        storageDir: '/var/lib/library',
        sourceConfig: undefined
      };

      (oxigraphStoreManager.getPersistentStore as any).mockReturnValueOnce(null);
      (oxigraphStoreManager.isInitialized as any).mockReturnValueOnce(false);
      (oxigraphStoreManager.createPersistentStore as any).mockResolvedValueOnce(mockOxigraphStore);

      const executor = await factory.getExecutorForNode(buildLibraryNode());
      expect(oxigraphStoreManager.initialize).toHaveBeenCalledWith('/var/lib/library');
      expect(oxigraphStoreManager.createPersistentStore).toHaveBeenCalledWith('library-store', {
        storeType: 'persistent',
        loadMethod: 'none',
        sourceConfig: undefined,
        persistPath: '/var/lib/rocks'
      });
      expect((executor as any).store).toBe(mockOxigraphStore);
    });

    /*
     * The assertion that matters is the negative one: an `oxigraph-memory`
     * library store must not go near the durable path, because that path
     * restores a `.nq` left by an earlier run and writes one on shutdown.
     */
    it('should create an ephemeral, never-serialized executor for internal memory backend', async () => {
      hoisted.mockConfig.internalBackend = {
        type: 'oxigraph-memory',
        dbPath: '/tmp/oxigraph'
      };

      (oxigraphStoreManager.getEphemeralStore as any).mockReturnValueOnce(null);
      (oxigraphStoreManager.createEphemeralStore as any).mockReturnValueOnce(mockOxigraphStore);

      const executor = await factory.getExecutorForNode(buildLibraryNode());
      expect(oxigraphStoreManager.createEphemeralStore).toHaveBeenCalledWith(`${LIBRARY_STORAGE_BACKEND_ID}::memory`);
      expect(oxigraphStoreManager.createPersistentStore).not.toHaveBeenCalled();
      expect(oxigraphStoreManager.createDurableStore).not.toHaveBeenCalled();
      expect(oxigraphStoreManager.initialize).not.toHaveBeenCalled();
      expect((executor as any).store).toBe(mockOxigraphStore);
    });
  });

  describe('HTTP backends', () => {
    it('should create HTTP executor for HTTP backend', async () => {
      const mockBackend: LdkitBackend = {
        $id: 'backend-http',
        '@type': 'Backend',
        name: 'Test HTTP Backend',
        backendType: BackendTypeIri.http,
        endpoint: 'http://localhost:3030/test/sparql'
      };

      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'backend-http',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: []
      };

      (hoisted.mockGet as any).mockReturnValue(mockBackend);

      const executor = await factory.getExecutorForNode(mockNode);
      expect(executor).toBeDefined();
      expect(hoisted.mockGet).toHaveBeenCalledWith('backend-http');
    });
  });

  describe('in-process oxigraph backends', () => {
    it('should reuse existing store for oxigraphEphemeral backend', async () => {
      const mockBackend: LdkitBackend = {
        $id: 'backend-oxigraph',
        '@type': 'Backend',
        name: 'Test Oxigraph Backend',
        backendType: BackendTypeIri.oxigraphEphemeral,
        endpoint: 'memory://test-store'
      };

      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'backend-oxigraph',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: []
      };

      (hoisted.mockGet as any).mockReturnValue(mockBackend);
      (oxigraphStoreManager.getEphemeralStore as any).mockReturnValue(mockOxigraphStore);

      const executor = await factory.getExecutorForNode(mockNode);
      expect(executor).toBeDefined();
      expect(oxigraphStoreManager.getEphemeralStore).toHaveBeenCalledWith('backend-oxigraph');
      expect(oxigraphStoreManager.createEphemeralStore).not.toHaveBeenCalled();
    });

    it('should create new store when none exists for oxigraphEphemeral backend', async () => {
      const mockBackend: LdkitBackend = {
        $id: 'backend-oxigraph',
        '@type': 'Backend',
        name: 'Test Oxigraph Backend',
        backendType: BackendTypeIri.oxigraphEphemeral,
        endpoint: 'memory://test-store'
      };

      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'backend-oxigraph',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: []
      };

      (hoisted.mockGet as any).mockReturnValue(mockBackend);
      (oxigraphStoreManager.getEphemeralStore as any).mockReturnValue(null);
      (oxigraphStoreManager.createEphemeralStore as any).mockReturnValue(mockOxigraphStore);

      const executor = await factory.getExecutorForNode(mockNode);
      expect(executor).toBeDefined();
      expect(oxigraphStoreManager.createEphemeralStore).toHaveBeenCalledWith('backend-oxigraph');
    });
  });

  describe('ephemeral oxigraph backends', () => {
    it('should create ephemeral executor for new store', async () => {
      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'dummy-backend', // Not used for ephemeral
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: [],
        backendConfig: {
          type: 'ephemeral-oxigraph',
          storeId: 'temp-store-123'
        }
      };

      (oxigraphStoreManager.getEphemeralStore as any).mockReturnValue(null);
      (oxigraphStoreManager.createEphemeralStore as any).mockReturnValue(mockOxigraphStore);

      const executor = await factory.getExecutorForNode(mockNode);
      expect(executor).toBeDefined();
      expect(oxigraphStoreManager.createEphemeralStore).toHaveBeenCalledWith('temp-store-123');
    });

    it('should reuse existing ephemeral store', async () => {
      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'dummy-backend',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: [],
        backendConfig: {
          type: 'ephemeral-oxigraph',
          storeId: 'temp-store-123'
        }
      };

      (oxigraphStoreManager.getEphemeralStore as any).mockReturnValue(mockOxigraphStore);

      const executor = await factory.getExecutorForNode(mockNode);
      expect(executor).toBeDefined();
      expect(oxigraphStoreManager.getEphemeralStore).toHaveBeenCalledWith('temp-store-123');
      expect(oxigraphStoreManager.createEphemeralStore).not.toHaveBeenCalled();
    });

    it('should throw error for ephemeral node missing storeId', async () => {
      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'dummy-backend',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: [],
        backendConfig: {
          type: 'ephemeral-oxigraph'
        } as any // Missing storeId
      };

      await expect(factory.getExecutorForNode(mockNode)).rejects.toThrow(
        'Ephemeral oxigraph node node-1 missing storeId'
      );
    });
  });

  describe('caching', () => {
    it('should cache executors for oxigraph backends', async () => {
      const mockBackend: LdkitBackend = {
        $id: 'backend-oxigraph',
        '@type': 'Backend',
        name: 'Test Oxigraph Backend',
        backendType: BackendTypeIri.oxigraphEphemeral,
        endpoint: 'memory://test-store'
      };

      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'backend-oxigraph',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: []
      };

      (hoisted.mockGet as any).mockReturnValue(mockBackend);
      (oxigraphStoreManager.getEphemeralStore as any).mockReturnValue(mockOxigraphStore);

      const executor1 = await factory.getExecutorForNode(mockNode);
      const executor2 = await factory.getExecutorForNode(mockNode);

      expect(executor1).toBe(executor2);
      expect(oxigraphStoreManager.getEphemeralStore).toHaveBeenCalledTimes(1);
    });

    it('should not cache executors for ephemeral backends', async () => {
      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'dummy-backend',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: [],
        backendConfig: {
          type: 'ephemeral-oxigraph',
          storeId: 'temp-store-123'
        }
      };

      (oxigraphStoreManager.getEphemeralStore as any).mockReturnValue(mockOxigraphStore);

      const executor1 = await factory.getExecutorForNode(mockNode);
      const executor2 = await factory.getExecutorForNode(mockNode);

      // Should return same executor but should still check store manager
      expect(oxigraphStoreManager.getEphemeralStore).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should throw error for missing backend', async () => {
      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'non-existent-backend',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: []
      };

      (hoisted.mockGet as any).mockReturnValue(null);

      await expect(factory.getExecutorForNode(mockNode)).rejects.toThrow(
        'Backend not found for node node-1: non-existent-backend'
      );
    });

    it('should throw error for unsupported backend type', async () => {
      const mockBackend: LdkitBackend = {
        $id: 'backend-unknown',
        '@type': 'Backend',
        name: 'Unknown Backend',
        backendType: 'unknown-type',
        endpoint: 'unknown://endpoint'
      } as any;

      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'backend-unknown',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: []
      };

      (hoisted.mockGet as any).mockReturnValue(mockBackend);

      await expect(factory.getExecutorForNode(mockNode)).rejects.toThrow(
        'Unsupported backend type for backend-unknown: unknown-type'
      );
    });
  });

  describe('synchronous fallback', () => {
    it('should work with sync method for HTTP backends', () => {
      const mockBackend: LdkitBackend = {
        $id: 'backend-http',
        '@type': 'Backend',
        name: 'Test HTTP Backend',
        backendType: BackendTypeIri.http,
        endpoint: 'http://localhost:3030/test/sparql'
      };

      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'backend-http',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: []
      };

      (hoisted.mockGet as any).mockReturnValue(mockBackend);

      const executor = factory.getExecutorForNodeSync(mockNode);
      expect(executor).toBeDefined();
    });

    it('should work with sync method for existing oxigraph stores', () => {
      const mockBackend: LdkitBackend = {
        $id: 'backend-oxigraph',
        '@type': 'Backend',
        name: 'Test Oxigraph Backend',
        backendType: BackendTypeIri.oxigraphEphemeral,
        endpoint: 'memory://test-store'
      };

      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'backend-oxigraph',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: []
      };

      (hoisted.mockGet as any).mockReturnValue(mockBackend);
      (oxigraphStoreManager.getEphemeralStore as any).mockReturnValue(mockOxigraphStore);

      const executor = factory.getExecutorForNodeSync(mockNode);
      expect(executor).toBeDefined();
    });

    it('should create oxigraph store synchronously when missing', () => {
      const mockBackend: LdkitBackend = {
        $id: 'backend-oxigraph',
        '@type': 'Backend',
        name: 'Test Oxigraph Backend',
        backendType: BackendTypeIri.oxigraphEphemeral,
        endpoint: 'memory://test-store'
      };

      const mockNode: ResolvedNode = {
        id: 'node-1',
        raw: {},
        backendId: 'backend-oxigraph',
        queryVersionId: 'query-v1',
        queryVersion: {} as any,
        queryString: 'SELECT * WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [],
        outputTupleIds: []
      };

      (hoisted.mockGet as any).mockReturnValue(mockBackend);
      (oxigraphStoreManager.getEphemeralStore as any).mockReturnValue(null);
      (oxigraphStoreManager.createEphemeralStore as any).mockReturnValue(mockOxigraphStore);

      const executor = factory.getExecutorForNodeSync(mockNode);
      expect(executor).toBeDefined();
      expect(oxigraphStoreManager.createEphemeralStore).toHaveBeenCalledWith('backend-oxigraph');
    });
  });
});
