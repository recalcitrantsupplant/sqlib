import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import Fastify, { FastifyInstance } from 'fastify';
import { MemoryCacheManager } from '../../src/lib/MemoryCacheManager.js';
import { createEntityRepositories } from '../../src/lib/EntityRepositories.js';
import queryRoutes from '../../src/routes/queries.js';
import backendRoutes from '../../src/routes/backends.js';
import executeRoutes from '../../src/routes/execute.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { SparqlQueryParser } from '../../src/lib/parser.js';
import type { LdkitBackend } from '../../src/persistence/schemas/BackendSchema.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import type { LdkitLibrary } from '../../src/persistence/schemas/LibrarySchema.js';
import type { LdkitQuery } from '../../src/persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../../src/persistence/schemas/QueryVersionSchema.js';

const HTTP_TYPE = BackendTypeIri.http;

const hoisted = vi.hoisted(() => ({
  cacheManager: null as MemoryCacheManager | null,
  list: vi.fn((type: string) => hoisted.cacheManager?.getByType(type as any) ?? []),
  get: vi.fn((id: string) => hoisted.cacheManager?.get(id) ?? null),
  create: vi.fn((type: string, entity: any) => hoisted.cacheManager!.create(entity, type as any)),
  update: vi.fn((type: string, id: string, updates: any) => hoisted.cacheManager!.update(id, updates, type as any)),
  delete: vi.fn((type: string, id: string) => hoisted.cacheManager!.delete(id, type as any)),
  getAll: vi.fn(() => (hoisted.cacheManager as any)?.cache ? Array.from((hoisted.cacheManager as any).cache.values()) : []),
}));

// Mock all the LDKit utilities that the MemoryCacheManager uses
// The stubbed `loadAllSystemEntities` below only takes effect if the coordinator
// actually goes through it, so the adapter has to be pointed at a double built
// from these stubs. Without this the real boot load runs and reads every type
// from whatever backend is configured.
vi.mock('../../src/persistence/adapterRegistry', async () => {
  const { lensBackedAdapter } = await import('../persistence/lensBackedAdapter.js');
  return { getPersistenceAdapter: () => lensBackedAdapter, setPersistenceAdapter: () => {} };
});

vi.mock('../../src/persistence/utils/entityRepository.js', () => {
  const buildStubLens = () => ({
    insert: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue([]),
    findByIri: vi.fn().mockResolvedValue(null),
  });

  const createRepositoryLens = vi.fn().mockImplementation(buildStubLens);

  return {
    loadAllSystemEntities: vi.fn(),
    createRepositoryLens,
    deleteEntity: vi.fn(),
    getEntity: vi.fn(),
    loadAllEntities: vi.fn(),
    extractSimpleValue: vi.fn(),
    extractSimpleArray: vi.fn(),
    convertSchemaToLdkit: vi.fn(),
    toJsonLd: vi.fn(),
    toJsonLdArray: vi.fn(),
    fromJsonLd: vi.fn(),
    normalizeIriArray: vi.fn(),
    expandIriArrayToIdRefs: vi.fn(),
  };
});

vi.mock('../../src/persistence/utils/BackendUtils.js', () => ({
  Backends: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/QueryUtils.js', () => ({
  Queries: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/QueryVersionUtils.js', () => ({
  QueryVersions: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../src/persistence/utils/LimitParameterUtils.js', () => ({
  LimitParameters: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
  loadLimitParametersByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/persistence/utils/QueryOutputVariableUtils.js', () => ({
  QueryOutputVariables: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
  loadQueryOutputVariablesByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/persistence/utils/LibraryUtils.js', () => ({
  Libraries: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

// Mock crypto for consistent ID generation in tests
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'testuuid123'),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => {
  const coordinator = {
    list: hoisted.list,
    get: hoisted.get,
    create: hoisted.create,
    update: hoisted.update,
    delete: hoisted.delete,
    getAll: hoisted.getAll,
    addEphemeral: vi.fn(),
    removeEphemeral: vi.fn(),
    isReady: vi.fn(() => true),
    getStats: vi.fn(() => ({})),
  };

  return {
    getCacheCoordinator: () => coordinator,
    getEntityRepositories: () => createEntityRepositories(coordinator as any),
  };
});

// Mock the id-adapter
vi.mock('../../src/persistence/utils/id-adapter.js', () => ({
  toRestApi: vi.fn((entity: any) => {
    const { $id, '@id': _atId, '@type': _atType, ...rest } = entity;
    delete rest['@type']; // Ensure @type is removed
    return { id: $id, ...rest };
  }),
  toLdkit: vi.fn((entity: any) => {
    if (entity.id && !entity.$id) {
      const { id, ...rest } = entity;
      return { $id: id, ...rest };
    }
    return entity;
  }),
}));

// Mock HttpSparqlExecutor for actual backend testing
vi.mock('../../src/server/HttpSparqlExecutor.js', () => ({
  HttpSparqlExecutor: vi.fn(),
}));

// Import the mocked dependencies
import { loadAllSystemEntities, createRepositoryLens } from '../../src/persistence/utils/entityRepository.js';
import { Backends } from '../../src/persistence/utils/BackendUtils.js';
import { Libraries } from '../../src/persistence/utils/LibraryUtils.js';
import { Queries } from '../../src/persistence/utils/QueryUtils.js';
import { QueryVersions } from '../../src/persistence/utils/QueryVersionUtils.js';
import { LimitParameters } from '../../src/persistence/utils/LimitParameterUtils.js';
import { QueryOutputVariables } from '../../src/persistence/utils/QueryOutputVariableUtils.js';
import { HttpSparqlExecutor } from '../../src/server/HttpSparqlExecutor.js';
import { setupValidator } from '../../src/lib/validator-setup.js';

const mockLoadAllSystemEntities = loadAllSystemEntities as any;
const mockCreateRepositoryLens = createRepositoryLens as any;
const mockBackends = Backends as any;
const mockLibraries = Libraries as any;
const mockQueries = Queries as any;
const mockQueryVersions = QueryVersions as any;
const mockLimitParameters = LimitParameters as any;
const mockQueryOutputVariables = QueryOutputVariables as any;
const MockHttpSparqlExecutor = HttpSparqlExecutor as any;

// Helper to build Fastify app
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Setup validator BEFORE adding schemas
  setupValidator(app);

  // Add schemas
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) {
      app.addSchema(schema);
    }
  }

  // Register routes
  await app.register(backendRoutes, { prefix: '/backends' });
  await app.register(queryRoutes, { prefix: '/queries' });
  await app.register(executeRoutes, { prefix: '/execute' });

  await app.ready();
  return app;
}

describe('End-to-End Query Creation and Execution Flow', () => {
  let app: FastifyInstance;
  let cacheManager: MemoryCacheManager;
  let parser: SparqlQueryParser;
  let createdEntityIds: Set<string>; // Track dynamically created entities

  // Test data
  const testBackendId = 'urn:sqlib:backend:fuseki-testing123';
  const testLibraryId = 'urn:sqlib:library:e2e-test';
  const testQueryId = 'urn:sqlib:query:e2e-test';
  const testQueryVersionId = 'urn:sqlib:query-version:test-uuid-123';
  

  const testQueryString = `
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    
    SELECT * WHERE {
      VALUES ?p { UNDEF }
      ?s ?p ?o .
    }
    LIMIT 0001
  `;

  beforeAll(async () => {
    parser = new SparqlQueryParser();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    hoisted.list.mockClear();
    hoisted.get.mockClear();
    hoisted.create.mockClear();
    hoisted.update.mockClear();
    hoisted.delete.mockClear();
    hoisted.getAll.mockClear();

    // Create a real MemoryCacheManager instance for each test
    cacheManager = new MemoryCacheManager();
    hoisted.cacheManager = cacheManager;
    createdEntityIds = new Set(); // Reset tracking set
    process.env.SQLIB_BACKEND_FUSEKI_TESTING123_USERNAME = 'admin';
    process.env.SQLIB_BACKEND_FUSEKI_TESTING123_PASSWORD = 'password123';

    // Setup default mock responses for LDKit operations
    mockLoadAllSystemEntities.mockResolvedValue(new Map());
    mockCreateRepositoryLens.mockImplementation(() => ({
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockResolvedValue([]),
      findByIri: vi.fn().mockResolvedValue(null),
    }));
    mockBackends.insert.mockResolvedValue(undefined);
    mockLibraries.insert.mockResolvedValue(undefined);
    mockLibraries.insert.mockResolvedValue(undefined);
    mockQueries.insert.mockResolvedValue(undefined);
    mockQueryVersions.insert.mockResolvedValue(undefined);
    mockLimitParameters.insert.mockResolvedValue(undefined);
    mockQueryOutputVariables.insert.mockResolvedValue(undefined);
    
  // Load the cache so it's ready for use
    await cacheManager.loadAll();
    
    // Build the Fastify app
    app = await buildTestApp();
  });

  afterEach(async () => {
    // Clean up all entities from cache
    try {
      // Collect all entity IDs from cache
      const cache = (cacheManager as any).cache;
      const allEntityIds = Array.from(cache.keys());

      // Group entities by type for proper deletion order
      const entitiesByType: { [key: string]: string[] } = {
        QueryVersion: [],
        LimitParameter: [],
        QueryOutputVariable: [],
        Query: [],
        Library: [],
        Backend: [],
        Other: []
      };

      for (const entityId of allEntityIds) {
        const entity = cache.get(entityId);
        if (entity && entity['@type']) {
          const type = entity['@type'] as string;
          if (entitiesByType[type]) {
            entitiesByType[type].push(entityId as string);
          } else {
            entitiesByType.Other.push(entityId as string);
          }
        }
      }

      // Delete in dependency order: QueryVersion → Query → Library → Backend
      const deletionOrder = [
        'QueryVersion',
        'LimitParameter',
        'QueryOutputVariable',
        'Query',
        'Library',
        'Backend',
        'Other'
      ];

      for (const type of deletionOrder) {
        for (const entityId of entitiesByType[type]) {
          try {
            await cacheManager.delete(entityId, type);
          } catch (err) {
            // Ignore deletion errors for individual entities
          }
        }
      }
    } catch (err) {
      console.error('Error during test cleanup:', err);
    }

    if (app) {
      await app.close();
    }
    hoisted.cacheManager = null;
    delete process.env.SQLIB_BACKEND_FUSEKI_TESTING123_USERNAME;
    delete process.env.SQLIB_BACKEND_FUSEKI_TESTING123_PASSWORD;
  });

  describe('Complete E2E Flow: Query Creation → Execution', () => {
    it('should create query with VALUES UNDEF, limit parameter, execute against mock Fuseki', async () => {
      // Step 0: Ensure a library exists for the query to belong to
      const libraryPayload: LdkitLibrary = {
        $id: testLibraryId,
        '@type': 'Library',
        name: 'E2E Test Library',
      };

      await cacheManager.create(libraryPayload, 'Library');

      // Step 1: Create a backend (Fuseki testing123)
      const backendPayload = {
        id: testBackendId,
        name: 'Fuseki Testing123',
        description: 'Fuseki instance for testing',
        backendType: 'http',
        endpoint: 'http://localhost:3030/testing123/sparql',
        authEnvKey: 'FUSEKI_TESTING123'
      };

      const backendResponse = await app.inject({
        method: 'POST',
        url: '/backends',
        payload: backendPayload,
      });

      expect(backendResponse.statusCode).toBe(201);
      const createdBackend = backendResponse.json();
      expect(createdBackend.id).toBe(testBackendId);

      // Verify backend is in cache
      const cachedBackend = cacheManager.get(testBackendId) as LdkitBackend;
      expect(cachedBackend).toBeTruthy();
      expect(cachedBackend.backendType).toBe(HTTP_TYPE);

      // Step 2: Create a stable Query
      const queryPayload = {
        name: 'E2E Test Query with VALUES UNDEF',
        description: 'Test query using VALUES UNDEF for ?p parameter with SPO pattern',
        isPartOf: testLibraryId,
      };

      const queryResponse = await app.inject({
        method: 'POST',
        url: '/queries',
        payload: queryPayload,
      });

      if (queryResponse.statusCode !== 201) {
        console.error('Query creation failed', queryResponse.statusCode, queryResponse.body);
      }
      expect(queryResponse.statusCode).toBe(201);
      const createdQuery = queryResponse.json();
      const actualQueryId = createdQuery.id; // Use the generated ID
      expect(actualQueryId).toMatch(/^urn:sqlib:query:/); // Validate it's a proper query ID

      // Step 3: Build complex payload using utility patterns from the design doc
      // This follows the "Backend Processing Flow" pattern with temporary URNs
      const queryVersionPayload = {
        queryVersion: {
          queryString: testQueryString,
          comment: 'Version with VALUES UNDEF and limit parameter',
          queryType: QueryTypeIri.select,
        },
        limitParameters: [
          {
            id: 'urn:ui-temp:limit-param-1',
            name: '1',
            value: 10,
            defaultValue: 10
          }
        ],
        outputs: [
          {
            id: 'urn:ui-temp:output-s',
            variableName: 's',
            description: 'Subject variable'
          },
          {
            id: 'urn:ui-temp:output-p',
            variableName: 'p',
            description: 'Predicate variable (from VALUES UNDEF)'
          },
          {
            id: 'urn:ui-temp:output-o',
            variableName: 'o',
            description: 'Object variable'
          }
        ]
      };

      // Step 4: Create QueryVersion using the flat payload pattern
      const queryVersionResponse = await app.inject({
        method: 'POST',
        url: `/queries/${encodeURIComponent(actualQueryId)}/v`,
        payload: queryVersionPayload,
      });

      if (queryVersionResponse.statusCode !== 201) {
        console.error('QueryVersion creation failed', queryVersionResponse.statusCode, queryVersionResponse.body);
      }
      expect(queryVersionResponse.statusCode).toBe(201);
      const createdVersion = queryVersionResponse.json();
      expect(createdVersion.queryVersion.isPartOf).toBe(actualQueryId);
      expect(createdVersion.queryVersion.version).toBe(1);
      expect(createdVersion.queryVersion.queryString).toBe(testQueryString);

      // Verify IRI mapping returned for temporary URNs
      expect(createdVersion.iriMap).toBeDefined();
      expect(createdVersion.iriMap['urn:ui-temp:limit-param-1']).toBeTruthy();
      expect(createdVersion.iriMap['urn:ui-temp:output-s']).toBeTruthy();
      expect(createdVersion.iriMap['urn:ui-temp:output-p']).toBeTruthy();
      expect(createdVersion.iriMap['urn:ui-temp:output-o']).toBeTruthy();

      // Step 5: Verify query parsing and parameter detection works
      const parsed = parser.parseQuery(testQueryString);
      expect(parsed).toBeTruthy();
      
      const detectedOutputs = parser.detectQueryOutputs(testQueryString);
      expect(detectedOutputs).toContain('s');
      expect(detectedOutputs).toContain('p');
      expect(detectedOutputs).toContain('o');

      const detectedParams = parser.detectInputs(testQueryString);
      expect(detectedParams.limitParameters).toContain('1');

      // Step 6: Verify currentVersion was set on parent Query
      const updatedQuery = cacheManager.get(actualQueryId) as LdkitQuery;
      expect(updatedQuery.currentVersion).toBeTruthy();

      // Step 7: Setup mock executor for query execution test
      const mockSelectResults = {
        head: { vars: ['s', 'p', 'o'] },
        results: { 
          bindings: [
            {
              s: { type: 'uri', value: 'http://example.org/subject1' },
              p: { type: 'uri', value: 'http://example.org/predicate1' },
              o: { type: 'literal', value: 'Object 1' }
            },
            {
              s: { type: 'uri', value: 'http://example.org/subject2' },
              p: { type: 'uri', value: 'http://example.org/predicate2' },
              o: { type: 'literal', value: 'Object 2' }
            }
          ]
        }
      };

      const mockExecutor = {
        selectQueryParsed: vi.fn().mockResolvedValue({
          result: mockSelectResults,
          duration: 0,
          contentType: 'application/sparql-results+json',
        }),
        constructQueryParsed: vi.fn(),
        update: vi.fn(),
      };
      MockHttpSparqlExecutor.mockImplementation(function () {
        return mockExecutor;
      });

      // Step 8: Execute the query with limit parameter substitution
      const executePayload = {
        targetId: actualQueryId, // Using stable Query (should resolve to currentVersion)
        backendId: testBackendId,
        limits: [
          { name: '1', value: 5 } // Replace LIMIT 0001 with LIMIT 5
        ]
      };

      const executeResponse = await app.inject({
        method: 'POST',
        url: '/execute/',
        payload: executePayload,
      });

      console.log('Execute Response Status:', executeResponse.statusCode);
      console.log('Execute Response Body:', executeResponse.body);
      console.log('Execute Response Payload:', executeResponse.payload);
      
      expect(executeResponse.statusCode).toBe(200);
      const executionResults = executeResponse.json();
      expect(executionResults.head.vars).toEqual(['s', 'p', 'o']);
      expect(executionResults.results.bindings).toHaveLength(2);

      // Verify the executor was called with the modified query (LIMIT 0001 → LIMIT 5)
      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 5'),
        { acceptHeader: 'application/sparql-results+json' }
      );

      // Verify HttpSparqlExecutor was instantiated with correct config
      expect(MockHttpSparqlExecutor).toHaveBeenCalledWith(expect.objectContaining({
        queryUrl: 'http://localhost:3030/testing123/sparql',
        updateUrl: 'http://localhost:3030/testing123/sparql',
        username: 'admin',
        password: 'password123',
      }));

      // Step 9: Test with VALUES UNDEF argument substitution
      const argumentsPayload = {
        targetId: actualQueryId,
        backendId: testBackendId,
        arguments: [
          {
            head: { vars: ['p'] },
            arguments: {
              bindings: [
                { p: { type: 'uri', value: 'http://www.w3.org/2000/01/rdf-schema#label' } }
              ],
            },
          }
        ],
        limits: [
          { name: '1', value: 3 } // Also test limit substitution
        ]
      };

      const argumentExecuteResponse = await app.inject({
        method: 'POST',
        url: '/execute/',
        payload: argumentsPayload,
      });

      expect(argumentExecuteResponse.statusCode).toBe(200);

      // Verify the query was modified to replace VALUES ?p { UNDEF } with actual value
      const argumentCalls = mockExecutor.selectQueryParsed.mock.calls;
      const lastCall = argumentCalls[argumentCalls.length - 1];
      const modifiedQuery = lastCall[0];
      console.log('Modified query', modifiedQuery);
      
      expect(modifiedQuery).toMatch(/rdfs:label|<http:\/\/www\.w3\.org\/2000\/01\/rdf-schema#label>/);
      expect(modifiedQuery).toContain('LIMIT 3');
      expect(modifiedQuery).not.toContain('UNDEF');
      expect(modifiedQuery).not.toContain('0001');
    });

    it('should handle query version execution directly (bypassing stable Query)', async () => {
      // Setup backend first
      const backend: LdkitBackend = {
        $id: testBackendId,
        '@type': 'Backend',
        name: 'Direct Execution Backend',
        backendType: BackendTypeIri.http,
        endpoint: 'http://localhost:3030/testing123/query'
      };
      (cacheManager as any).cache.set(testBackendId, backend);

      // Create a QueryVersion directly in cache (simulating existing data)
      const queryVersion: LdkitQueryVersion = {
        $id: testQueryVersionId,
        '@type': 'QueryVersion',
        isPartOf: testQueryId,
        version: 1,
        queryString: 'SELECT ?s ?p ?o WHERE { VALUES ?p { UNDEF } ?s ?p ?o } LIMIT 0001',
        queryType: QueryTypeIri.select,
      };
      (cacheManager as any).cache.set(testQueryVersionId, queryVersion);

      // Mock executor
      const mockExecutor = {
        selectQueryParsed: vi.fn().mockResolvedValue({
          result: {
            head: { vars: ['s', 'p', 'o'] },
            results: { bindings: [] }
          },
          duration: 0,
          contentType: 'application/sparql-results+json',
        }),
        constructQueryParsed: vi.fn(),
        update: vi.fn(),
      };
      MockHttpSparqlExecutor.mockImplementation(function () {
        return mockExecutor;
      });

      // Execute directly against QueryVersion
      const executeResponse = await app.inject({
        method: 'POST',
        url: '/execute/',
        payload: {
          targetId: testQueryVersionId, // Direct QueryVersion execution
          backendId: testBackendId,
          limits: [ { name: '1', value: 20 } ]
        }
      });

      expect(executeResponse.statusCode).toBe(200);
      expect(executeResponse.headers['x-resolved-target']).toBe(testQueryVersionId);

      // Verify executor was called with limit substitution
      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 20'),
        { acceptHeader: 'application/sparql-results+json' }
      );
    });

    it('should handle backend resolution precedence correctly', async () => {
      // This tests the backend resolution flow: UI → Query.defaultBackend → Library.defaultBackend
      
      // Create backend
      const specificBackend: LdkitBackend = {
        $id: 'urn:sqlib:backend:specific',
        '@type': 'Backend',
        name: 'Specific Backend',
        backendType: BackendTypeIri.http,
        endpoint: 'http://specific.example.com/sparql'
      };
      (cacheManager as any).cache.set(specificBackend.$id, specificBackend);

      // Create QueryVersion without default backend
      const queryVersion: LdkitQueryVersion = {
        $id: testQueryVersionId,
        '@type': 'QueryVersion',
        isPartOf: testQueryId,
        version: 1,
        queryString: 'SELECT ?s WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
      };
      (cacheManager as any).cache.set(testQueryVersionId, queryVersion);

      // Mock both executors
      const specificExecutor = {
        selectQueryParsed: vi.fn().mockResolvedValue({
          result: { head: { vars: ['s'] }, results: { bindings: [] } },
          duration: 0,
          contentType: 'application/sparql-results+json',
        }),
        constructQueryParsed: vi.fn(),
        update: vi.fn(),
      };
      const defaultExecutor = {
        selectQueryParsed: vi.fn().mockResolvedValue({
          result: { head: { vars: ['s'] }, results: { bindings: [] } },
          duration: 0,
          contentType: 'application/sparql-results+json',
        }),
        constructQueryParsed: vi.fn(),
        update: vi.fn(),
      };

      // Test 1: UI-specified backend should take precedence
      MockHttpSparqlExecutor.mockImplementation(function (config: any) {
        if (config.queryUrl.includes('specific')) return specificExecutor;
        return defaultExecutor;
      });

      const uiSpecificResponse = await app.inject({
        method: 'POST',
        url: '/execute/',
        payload: {
          targetId: testQueryVersionId,
          backendId: specificBackend.$id // UI specifies different backend
        }
      });

      expect(uiSpecificResponse.statusCode).toBe(200);
      expect(specificExecutor.selectQueryParsed).toHaveBeenCalled();
      expect(defaultExecutor.selectQueryParsed).not.toHaveBeenCalled();

      // Reset mocks
      specificExecutor.selectQueryParsed.mockClear();
      defaultExecutor.selectQueryParsed.mockClear();
      MockHttpSparqlExecutor.mockClear();
      MockHttpSparqlExecutor.mockImplementation(function () {
        return defaultExecutor;
      });

      // Test 2: QueryVersion.defaultBackend should be used when no UI override
      const defaultBackend: LdkitBackend = {
        $id: testBackendId,
        '@type': 'Backend',
        name: 'Default Backend',
        backendType: BackendTypeIri.http,
        endpoint: 'http://default.example.com/sparql'
      };
      (cacheManager as any).cache.set(testBackendId, defaultBackend);

      const defaultResponse = await app.inject({
        method: 'POST',
        url: '/execute/',
        payload: {
          targetId: testQueryVersionId,
          backendId: testBackendId // Use QueryVersion's default
        }
      });

      expect(defaultResponse.statusCode).toBe(200);
      expect(defaultExecutor.selectQueryParsed).toHaveBeenCalled();
    });
  });
});
