
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import Fastify, { FastifyInstance } from 'fastify';
import { MemoryCacheManager } from '../../src/lib/MemoryCacheManager.js';
import queryGroupRoutes from '../../src/routes/query-groups.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { setupValidator } from '../../src/lib/validator-setup.js';

let cacheManager: MemoryCacheManager | null = null;

const hoisted = vi.hoisted(() => ({
  list: vi.fn((type: string) => cacheManager?.getByType(type as any) ?? []),
  get: vi.fn((id: string) => cacheManager?.get(id) ?? null),
  create: vi.fn((type: string, entity: any) => cacheManager!.create(entity, type as any)),
  update: vi.fn((type: string, id: string, updates: any) => cacheManager!.update(id, updates, type as any)),
  delete: vi.fn((type: string, id: string) => cacheManager!.delete(id, type as any)),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    list: hoisted.list,
    get: hoisted.get,
    create: hoisted.create,
    update: hoisted.update,
    delete: hoisted.delete,
  }),
}));

// This suite's subject is cache logic; storage is a stub. It runs against a
// double built from those stubs (see lensBackedAdapter), so what is asserted is
// what the cache did, not what the persistence layer did.
vi.mock('../../src/persistence/adapterRegistry', async () => {
  const { lensBackedAdapter } = await import('../persistence/lensBackedAdapter.js');
  return { getPersistenceAdapter: () => lensBackedAdapter, setPersistenceAdapter: () => {} };
});

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

describe('Query Group Version Validation', () => {
  let app: FastifyInstance;
  const testGroupId = 'urn:sqlib:group:test-group';
  const testGroupVersionId = 'urn:sqlib:group-version:test-group-v1';

  beforeEach(async () => {
    vi.clearAllMocks();
    hoisted.list.mockClear();
    hoisted.get.mockClear();
    hoisted.create.mockClear();
    hoisted.update.mockClear();
    hoisted.delete.mockClear();
    cacheManager = new MemoryCacheManager();
    await cacheManager.loadAll();

    // Pre-populate cache with a query group and version
    await cacheManager.create({ $id: testGroupId, '@type': 'QueryGroup', name: 'Test Group' }, 'QueryGroup');
    await cacheManager.create({ $id: testGroupVersionId, '@type': 'QueryGroupVersion', isPartOf: testGroupId, version: 1, startNode: 'start-node-id', endNode: 'end-node-id' }, 'QueryGroupVersion');
    await cacheManager.create({ $id: 'start-node-id', '@type': 'StartNode' }, 'StartNode');
    await cacheManager.create({ $id: 'end-node-id', '@type': 'EndNode' }, 'EndNode');

    app = await buildTestApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should validate a query group version', async () => {
    const backendId = 'urn:sqlib:backend:validation';
    const queryVersionId = 'urn:sqlib:query-version:validation';
    const outputVarId = 'urn:sqlib:output:validation';
    const tupleMemberId = 'urn:sqlib:tuple-member:validation';
    const outputTupleId = 'urn:sqlib:output-tuple:validation';
    const nodeId = 'urn:sqlib:node:validation';
    const edgeStartId = 'urn:sqlib:edge:validation-start';
    const edgeEndId = 'urn:sqlib:edge:validation-end';

    await cacheManager.create({ $id: backendId, '@type': 'Backend' }, 'Backend');
    await cacheManager.create({
      $id: queryVersionId,
      '@type': 'QueryVersion',
      queryString: 'SELECT ?s WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.select
    }, 'QueryVersion');
    await cacheManager.create({ $id: outputVarId, '@type': 'QueryOutputVariable', variableName: 's' }, 'QueryOutputVariable');
    await cacheManager.create({ $id: tupleMemberId, '@type': 'TupleMember', position: 0, variable: outputVarId }, 'TupleMember');
    await cacheManager.create({ $id: outputTupleId, '@type': 'QueryOutputTuple', memberEntries: [tupleMemberId] }, 'QueryOutputTuple');
    await cacheManager.update('end-node-id', { inputs: [outputTupleId] }, 'EndNode');
    await cacheManager.create({
      $id: nodeId,
      '@type': 'QueryNode',
      backendId,
      queryId: queryVersionId,
      outputs: [outputTupleId]
    }, 'QueryNode');
    await cacheManager.create({
      $id: edgeStartId,
      '@type': 'QueryEdge',
      sourceNodeId: 'start-node-id',
      targetNodeId: nodeId,
      dataFlowType: 'CONTROL_FLOW'
    }, 'QueryEdge');
    await cacheManager.create({
      $id: edgeEndId,
      '@type': 'QueryEdge',
      sourceNodeId: nodeId,
      targetNodeId: 'end-node-id',
      dataFlowType: 'VARIABLE_BINDINGS',
      sourceOutputId: outputTupleId,
      targetInputId: outputTupleId
    }, 'QueryEdge');
    await cacheManager.update(testGroupVersionId, {
      executionNodes: [nodeId],
      edges: [edgeStartId, edgeEndId]
    }, 'QueryGroupVersion');

    const response = await app.inject({
      method: 'GET',
      url: `/query-groups/${testGroupId}/v/1/validate`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.valid).toBe(true);
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues).toHaveLength(0);
  });

  /**
   * A node whose backend is an ephemeral store names no `backendId` at all —
   * since #297 naming one alongside the config is rejected by the writer. The
   * validate route used to demand `backendId` from every non-RuleSetNode, so
   * the seeded ephemeral SHACL validation group reported two
   * NODE_BACKEND_UNRESOLVABLE errors for a group that runs fine.
   */
  it('accepts a node whose backend is an ephemeral backendConfig', async () => {
    const queryVersionId = 'urn:sqlib:query-version:ephemeral';
    const outputVarId = 'urn:sqlib:output:ephemeral';
    const tupleMemberId = 'urn:sqlib:tuple-member:ephemeral';
    const outputTupleId = 'urn:sqlib:output-tuple:ephemeral';
    const nodeId = 'urn:sqlib:node:ephemeral';

    await cacheManager.create({
      $id: queryVersionId,
      '@type': 'QueryVersion',
      queryString: 'SELECT ?s WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.select,
    }, 'QueryVersion');
    await cacheManager.create({ $id: outputVarId, '@type': 'QueryOutputVariable', variableName: 's' }, 'QueryOutputVariable');
    await cacheManager.create({ $id: tupleMemberId, '@type': 'TupleMember', position: 0, variable: outputVarId }, 'TupleMember');
    await cacheManager.create({ $id: outputTupleId, '@type': 'QueryOutputTuple', memberEntries: [tupleMemberId] }, 'QueryOutputTuple');
    await cacheManager.update('end-node-id', { inputs: [outputTupleId] }, 'EndNode');
    await cacheManager.create({
      $id: nodeId,
      '@type': 'QueryNode',
      queryId: queryVersionId,
      backendConfig: { type: 'ephemeral-oxigraph', storeId: 'urn:sqlib:store:ephemeral' },
      outputs: [outputTupleId],
    }, 'QueryNode');
    await cacheManager.create({
      $id: 'urn:sqlib:edge:ephemeral-start',
      '@type': 'QueryEdge',
      sourceNodeId: 'start-node-id',
      targetNodeId: nodeId,
      dataFlowType: 'CONTROL_FLOW',
    }, 'QueryEdge');
    await cacheManager.create({
      $id: 'urn:sqlib:edge:ephemeral-end',
      '@type': 'QueryEdge',
      sourceNodeId: nodeId,
      targetNodeId: 'end-node-id',
      dataFlowType: 'VARIABLE_BINDINGS',
      sourceOutputId: outputTupleId,
      targetInputId: outputTupleId,
    }, 'QueryEdge');
    await cacheManager.update(testGroupVersionId, {
      executionNodes: [nodeId],
      edges: ['urn:sqlib:edge:ephemeral-start', 'urn:sqlib:edge:ephemeral-end'],
    }, 'QueryGroupVersion');

    const response = await app.inject({
      method: 'GET',
      url: `/query-groups/${testGroupId}/v/1/validate`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.issues).toHaveLength(0);
    expect(body.valid).toBe(true);
  });

  /**
   * The other half of the writer's rule (#297): a node reads one backend or the
   * other, never both, so a version that names both is reported rather than
   * silently having its `backendId` ignored by `ExecutorFactory`.
   */
  it('reports a node that names both a backendId and an ephemeral backendConfig', async () => {
    const backendId = 'urn:sqlib:backend:conflict';
    const queryVersionId = 'urn:sqlib:query-version:conflict';
    const nodeId = 'urn:sqlib:node:conflict';

    await cacheManager.create({ $id: backendId, '@type': 'Backend' }, 'Backend');
    await cacheManager.create({
      $id: queryVersionId,
      '@type': 'QueryVersion',
      queryString: 'SELECT ?s WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.select,
    }, 'QueryVersion');
    await cacheManager.create({
      $id: nodeId,
      '@type': 'QueryNode',
      queryId: queryVersionId,
      backendId,
      backendConfig: { type: 'ephemeral-oxigraph', storeId: 'urn:sqlib:store:conflict' },
    }, 'QueryNode');
    await cacheManager.update(testGroupVersionId, {
      executionNodes: [nodeId],
      edges: [],
    }, 'QueryGroupVersion');

    const response = await app.inject({
      method: 'GET',
      url: `/query-groups/${testGroupId}/v/1/validate`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.valid).toBe(false);
    expect(body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          code: 'NODE_BACKEND_CONFLICT',
          entityId: nodeId,
        }),
      ]),
    );
  });

  it('should report detailed validation issues when graph is invalid', async () => {
    await cacheManager.create({
      $id: 'urn:sqlib:edge:broken',
      '@type': 'QueryEdge',
      sourceNodeId: 'urn:sqlib:node:missing-source',
      targetNodeId: 'urn:sqlib:node:missing-target',
      dataFlowType: 'CONTROL_FLOW',
    }, 'QueryEdge');
    await cacheManager.update(testGroupVersionId, {
      edges: ['urn:sqlib:edge:broken'],
    }, 'QueryGroupVersion');

    const response = await app.inject({
      method: 'GET',
      url: `/query-groups/${testGroupId}/v/1/validate`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.valid).toBe(false);
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Edge urn:sqlib:edge:broken references missing source node'),
      ]),
    );
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          code: 'EDGE_SOURCE_MISSING',
          entityId: 'urn:sqlib:edge:broken',
        }),
      ]),
    );
  });
});
