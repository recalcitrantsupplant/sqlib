
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { MemoryCacheManager } from '../../src/lib/MemoryCacheManager.js';
import queryGroupRoutes from '../../src/routes/query-groups.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';

let cacheManager: MemoryCacheManager | null = null;

const hoisted = vi.hoisted(() => ({
  list: vi.fn((type: string) => cacheManager?.getByType(type as any) ?? []),
  get: vi.fn((id: string) => cacheManager?.get(id) ?? null),
  create: vi.fn((type: string, entity: any) => cacheManager!.create(entity, type as any)),
  update: vi.fn((type: string, id: string, updates: any) => cacheManager!.update(id, updates, type as any)),
  delete: vi.fn((type: string, id: string) => cacheManager!.delete(id, type as any)),
  // Reference checks read through the same in-memory cache the rest of this
  // harness uses, so a payload naming something the test seeded resolves.
  resolveExisting: vi.fn(async (id: string) => {
    const entity = cacheManager?.get(id) as { '@type'?: string } | null;
    return entity ? { type: entity['@type'], entity } : null;
  }),
}));

// The stubbed `loadAllSystemEntities` below only takes effect if the coordinator
// actually goes through it, so the adapter has to be pointed at a double built
// from these stubs. Without this the real boot load runs and reads every type
// from whatever backend is configured.
vi.mock('../../src/persistence/adapterRegistry', async () => {
  const { lensBackedAdapter } = await import('../persistence/lensBackedAdapter.js');
  return { getPersistenceAdapter: () => lensBackedAdapter, setPersistenceAdapter: () => {} };
});

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    list: hoisted.list,
    get: hoisted.get,
    create: hoisted.create,
    update: hoisted.update,
    delete: hoisted.delete,
    resolveExisting: hoisted.resolveExisting,
  }),
}));

// Mock dependencies
vi.mock('../../src/persistence/utils/entityRepository.js', () => ({
  loadAllSystemEntities: vi.fn().mockResolvedValue(new Map()),
  createRepositoryLens: vi.fn(() => ({
    insert: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue([]),
    findByIri: vi.fn().mockResolvedValue(null),
    insertData: vi.fn().mockResolvedValue(undefined),
    deleteData: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/persistence/utils/id-adapter.js', () => ({
  toRestApi: vi.fn((entity) => ({ id: entity.$id, ...entity })),
  toLdkit: vi.fn((entity) => entity),
}));

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) {
      app.addSchema(schema);
    }
  }
  await app.register(queryGroupRoutes, { prefix: '/query-groups' });
  await app.ready();
  return app;
}

describe('Flat Query Group Building Flow', () => {
  let app: FastifyInstance;
  const testGroupId = 'urn:sqlib:group:test-group-flat';
  const existingQueryId = 'urn:sqlib:query:existing-query';
  // A node's queryId names a QueryVersion, not a Query (QueryNodeSchema.ts:50,
  // and it is the version the harness and the canvas both send). This fixture
  // used to point at the Query, which went unnoticed while nothing checked.
  const existingQueryVersionId = 'urn:sqlib:query-version:existing-query-v1';
  const testBackendId = 'urn:sqlib:backend:test-backend';

  beforeEach(async () => {
    vi.clearAllMocks();
    hoisted.list.mockClear();
    hoisted.get.mockClear();
    hoisted.create.mockClear();
    hoisted.update.mockClear();
    hoisted.delete.mockClear();
    cacheManager = new MemoryCacheManager();
    await cacheManager.loadAll();

    // Pre-populate cache with a query group, a query, and a backend
    await cacheManager.create({ $id: testGroupId, '@type': 'QueryGroup', name: 'Test Group Flat' }, 'QueryGroup');
    await cacheManager.create({ $id: existingQueryId, '@type': 'Query', name: 'Existing Query' }, 'Query');
    await cacheManager.create({
      $id: existingQueryVersionId,
      '@type': 'QueryVersion',
      isPartOf: existingQueryId,
      version: 1,
    }, 'QueryVersion');
    await cacheManager.create({ $id: testBackendId, '@type': 'Backend', name: 'Test Backend', backendType: BackendTypeIri.http, endpoint: 'http://example.com/sparql' }, 'Backend');

    app = await buildTestApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should create a complex query group version from a single flat payload', async () => {
    const payload = {
      queryGroupVersion: { comment: 'Flat created version' },
      executionNodes: [
        { id: 'urn:ui-temp:node-1', queryId: existingQueryVersionId, backendId: testBackendId },
      ],
      outputs: [
        { id: 'urn:ui-temp:var-1', variableName: 'myVar' },
      ],
      tupleMembers: [
        { id: 'urn:ui-temp:member-1', position: 0, variable: 'urn:ui-temp:var-1' }
      ],
      outputTuples: [
        { id: 'urn:ui-temp:tuple-1', name: 'My Output Tuple', memberEntries: ['urn:ui-temp:member-1'] },
      ],
      edges: [
        { id: 'urn:ui-temp:edge-1', sourceNodeId: 'urn:__START__', targetNodeId: 'urn:ui-temp:node-1' },
        { id: 'urn:ui-temp:edge-2', sourceNodeId: 'urn:ui-temp:node-1', targetNodeId: 'urn:__END__', targetInputId: 'urn:ui-temp:tuple-1' },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: `/query-groups/${testGroupId}/v`,
      payload,
    });

    if (response.statusCode !== 201) {
      console.error(response.json());
    }

    expect(response.statusCode).toBe(201);
    const body = response.json();

    // Check iriMap
    expect(body.iriMap).toBeDefined();
    expect(body.iriMap['urn:ui-temp:node-1']).toBeDefined();
    expect(body.iriMap['urn:ui-temp:tuple-1']).toBeDefined();
    expect(body.iriMap['urn:ui-temp:var-1']).toBeDefined();
    expect(body.iriMap['urn:ui-temp:edge-1']).toBeDefined();
    expect(body.iriMap['urn:ui-temp:edge-2']).toBeDefined();
    expect(body.iriMap['urn:__START__']).toBeDefined();
    expect(body.iriMap['urn:__END__']).toBeDefined();

    // Check that the response contains the expected data
    expect(body.queryGroupVersion).toBeDefined();
    expect(body.executionNodes).toBeDefined();
    expect(body.executionNodes).toHaveLength(1);
    expect(body.edges).toBeDefined();
    expect(body.edges).toHaveLength(2);

    // Verify that permanent IRIs were created for all temporary IDs
    expect(body.iriMap['urn:ui-temp:node-1']).toMatch(/^urn:sqlib:node:/);
    expect(body.iriMap['urn:ui-temp:tuple-1']).toMatch(/^urn:sqlib:output-tuple:/);
    expect(body.iriMap['urn:ui-temp:var-1']).toMatch(/^urn:sqlib:output:/);
    expect(body.iriMap['urn:ui-temp:edge-1']).toMatch(/^urn:sqlib:edge:/);
    expect(body.iriMap['urn:ui-temp:edge-2']).toMatch(/^urn:sqlib:edge:/);
    expect(body.iriMap['urn:__START__']).toMatch(/^urn:sqlib:start-node:/);
    expect(body.iriMap['urn:__END__']).toMatch(/^urn:sqlib:end-node:/);
  });
});
