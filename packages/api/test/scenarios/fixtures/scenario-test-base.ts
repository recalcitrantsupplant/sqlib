import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { MemoryCacheManager } from '../../../src/lib/MemoryCacheManager.js';
import { createEntityRepositories } from '../../../src/lib/EntityRepositories.js';
import { OxigraphStoreManager } from '../../../src/lib/OxigraphStoreManager.js';
import backendRoutes from '../../../src/routes/backends.js';
import libraryRoutes from '../../../src/routes/libraries.js';
import queryRoutes from '../../../src/routes/queries.js';
import queryGroupRoutes from '../../../src/routes/query-groups.js';
import executeRoutes from '../../../src/routes/execute.js';
import detectionRoutes from '../../../src/routes/detection.js';
import sparqlRoutes from '../../../src/routes/sparql.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { serializerOpts, setupValidator } from '../../../src/lib/validator-setup.js';
import type { LdkitBackend } from '../../../src/persistence/schemas/BackendSchema.js';
import type { LdkitLibrary } from '../../../src/persistence/schemas/LibrarySchema.js';
import type { LdkitQueryGroup } from '../../../src/persistence/schemas/QueryGroupSchema.js';

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
vi.mock('../../../src/persistence/adapterRegistry', async () => {
  const { lensBackedAdapter } = await import('../../persistence/lensBackedAdapter.js');
  return { getPersistenceAdapter: () => lensBackedAdapter, setPersistenceAdapter: () => {} };
});

vi.mock('../../../src/persistence/utils/entityRepository.js', () => ({
  loadAllSystemEntities: vi.fn(),
  createRepositoryLens: vi.fn(),
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
}));

vi.mock('../../../src/persistence/utils/BackendUtils.js', () => ({
  Backends: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../../src/persistence/utils/LibraryUtils.js', () => ({
  Libraries: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../../src/persistence/utils/QueryGroupUtils.js', () => ({
  QueryGroups: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../../src/persistence/utils/QueryGroupVersionUtils.js', () => ({
  QueryGroupVersions: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../../src/persistence/utils/QueryUtils.js', () => ({
  Queries: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../../src/persistence/utils/QueryVersionUtils.js', () => ({
  QueryVersions: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../../src/persistence/utils/LimitParameterUtils.js', () => ({
  LimitParameters: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
  loadLimitParametersByIds: vi.fn().mockResolvedValue([]),
  findLimitParameterById: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/persistence/utils/QueryOutputUtils.js', () => ({
  QueryOutputs: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
  loadQueryOutputsByIds: vi.fn().mockResolvedValue([]),
  findQueryOutputById: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/persistence/utils/QueryInputUtils.js', () => ({
  QueryInputs: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
  loadQueryInputsByIds: vi.fn().mockResolvedValue([]),
  findQueryInputById: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/persistence/utils/QueryNodeUtils.js', () => ({
  QueryNodes: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../../src/persistence/utils/QueryEdgeUtils.js', () => ({
  QueryEdges: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../../src/persistence/utils/QueryOutputTupleUtils.js', () => ({
  QueryOutputTuples: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
  loadQueryOutputTuplesByIds: vi.fn().mockResolvedValue([]),
  findQueryOutputTupleById: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/persistence/utils/QueryInputTupleUtils.js', () => ({
  QueryInputTuples: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
  loadQueryInputTuplesByIds: vi.fn().mockResolvedValue([]),
  findQueryInputTupleById: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/persistence/utils/TupleMemberUtils.js', () => ({
  TupleMembers: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    find: vi.fn(),
  },
  loadTupleMembersByIds: vi.fn().mockResolvedValue([]),
  findTupleMemberById: vi.fn().mockResolvedValue(null),
}));

// Mock crypto for consistent ID generation in tests
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-123'),
}));

vi.mock('../../../src/lib/CacheCoordinatorProvider.js', () => {
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
vi.mock('../../../src/persistence/utils/id-adapter.js', () => ({
  toRestApi: vi.fn((entity: any) => {
    const { $id, ...rest } = entity;
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

import { loadAllSystemEntities } from '../../../src/persistence/utils/entityRepository.js';
import { Backends } from '../../../src/persistence/utils/BackendUtils.js';
import { Libraries } from '../../../src/persistence/utils/LibraryUtils.js';
import { QueryGroups } from '../../../src/persistence/utils/QueryGroupUtils.js';
import { QueryGroupVersions } from '../../../src/persistence/utils/QueryGroupVersionUtils.js';
const mockLoadAllSystemEntities = loadAllSystemEntities as any;
const mockBackends = Backends as any;
const mockLibraries = Libraries as any;
const mockQueryGroups = QueryGroups as any;
const mockQueryGroupVersions = QueryGroupVersions as any;

export interface ScenarioTestContext {
  app: FastifyInstance;
  cacheManager: MemoryCacheManager;
  storeManager: OxigraphStoreManager;
  tempDir: string;
  backendId: string;
  libraryId: string;
}

export class ScenarioTestBase {
  static async createTestContext(scenarioName: string): Promise<ScenarioTestContext> {
    // Create temp directory for this test scenario
    const tempDir = path.join(os.tmpdir(), `scenario-test-${scenarioName}-${Date.now()}`);

    // Initialize Oxigraph store manager
    const storeManager = new OxigraphStoreManager(tempDir);
    await storeManager.initialize();

    // Clear all mocks
    vi.clearAllMocks();
    hoisted.list.mockClear();
    hoisted.get.mockClear();
    hoisted.create.mockClear();
    hoisted.update.mockClear();
    hoisted.delete.mockClear();
    hoisted.getAll.mockClear();

    // Create a real MemoryCacheManager instance
    const cacheManager = new MemoryCacheManager();

    // Setup default mock responses for LDKit operations
    mockLoadAllSystemEntities.mockResolvedValue(new Map());
    mockBackends.insert.mockResolvedValue(undefined);
    mockLibraries.insert.mockResolvedValue(undefined);
    mockQueryGroups.insert.mockResolvedValue(undefined);
    mockQueryGroupVersions.insert.mockResolvedValue(undefined);

    // Load the cache so it's ready for use
    await cacheManager.loadAll();

    hoisted.cacheManager = cacheManager;

    // Build the Fastify app
    const app = await ScenarioTestBase.buildTestApp();

    // Generate predictable IDs for this scenario
    const backendId = `urn:scenario:backend:${scenarioName}`;
    const libraryId = `urn:scenario:library:${scenarioName}`;

    return {
      app,
      cacheManager,
      storeManager,
      tempDir,
      backendId,
      libraryId,
    };
  }

  static async cleanupTestContext(context: ScenarioTestContext): Promise<void> {
    if (context.app) {
      await context.app.close();
    }

    if (context.storeManager) {
      await context.storeManager.shutdown();
    }

    try {
      await fs.rm(context.tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }

    hoisted.cacheManager = null;
  }

  static async buildTestApp(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false, serializerOpts });

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
    await app.register(libraryRoutes, { prefix: '/libraries' });
    await app.register(queryRoutes, { prefix: '/queries' });
    await app.register(queryGroupRoutes, { prefix: '/query-groups' });
    await app.register(executeRoutes, { prefix: '/execute' });
    await app.register(detectionRoutes);
    await app.register(sparqlRoutes, { prefix: '/sparql' });

    await app.ready();
    return app;
  }

  static async loadTurtleDataIntoBackend(
    context: ScenarioTestContext,
    dataFileName: string
  ): Promise<void> {
    const dataPath = path.join(__dirname, '../data', dataFileName);
    const turtleContent = await fs.readFile(dataPath, 'utf-8');

    // Create an in-process Oxigraph store and load the data
    const store = context.storeManager.createEphemeralStore(context.backendId);
    await context.storeManager.loadDataFromString(store, turtleContent, 'turtle');

    console.log(`Loaded ${store.size} triples from ${dataFileName} into backend ${context.backendId}`);
  }

  static async createOxigraphBackend(context: ScenarioTestContext, name: string): Promise<any> {
    const backendPayload = {
      id: context.backendId,
      name: name,
      description: `Oxigraph backend for ${name} scenario`,
      backendType: 'oxigraphEphemeral',
      oxigraphConfig: JSON.stringify({
        storeType: 'durable', // In-memory, serialized to .nq on shutdown
        loadMethod: 'none'
      })
    };


    const response = await context.app.inject({
      method: 'POST',
      url: '/backends',
      payload: backendPayload,
    });

    if (response.statusCode !== 201) {
      throw new Error(`Failed to create backend: ${response.body}`);
    }

    return response.json();
  }

  static async createLibrary(context: ScenarioTestContext, name: string): Promise<any> {
    const libraryPayload = {
      id: context.libraryId,
      name: name,
      description: `Library for ${name} scenario`,
      defaultBackend: context.backendId
    };

    const response = await context.app.inject({
      method: 'POST',
      url: '/libraries',
      payload: libraryPayload,
    });

    if (response.statusCode !== 201) {
      throw new Error(`Failed to create library: ${response.body}`);
    }

    return response.json();
  }

  static async createQueryGroup(context: ScenarioTestContext, name: string): Promise<any> {
    const groupPayload = {
      name: name,
      description: `Query group for ${name} scenario`,
      isPartOf: context.libraryId
    };

    const response = await context.app.inject({
      method: 'POST',
      url: '/query-groups',
      payload: groupPayload,
    });

    if (response.statusCode !== 201) {
      throw new Error(`Failed to create query group: ${response.body}`);
    }

    return response.json();
  }

  static async readQueryFile(fileName: string): Promise<string> {
    const queryPath = path.join(__dirname, '../data', fileName);
    return await fs.readFile(queryPath, 'utf-8');
  }

  static async executeQueryGroup(
    context: ScenarioTestContext,
    queryGroupId: string,
    initialArgs?: any[]
  ): Promise<any> {
    const executePayload: any = {
      targetId: queryGroupId,
      backendId: context.backendId
    };

    if (initialArgs) {
      executePayload.arguments = initialArgs;
    }

    const response = await context.app.inject({
      method: 'POST',
      url: '/execute/',
      payload: executePayload,
    });

    if (response.statusCode !== 200) {
      throw new Error(`Query group execution failed: ${response.body}`);
    }

    return response.json();
  }

  static createPredictableId(prefix: string, suffix: string): string {
    return `urn:scenario:${prefix}:${suffix}`;
  }
}
