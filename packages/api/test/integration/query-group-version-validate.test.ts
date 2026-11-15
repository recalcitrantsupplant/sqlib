import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import Fastify, { FastifyInstance } from 'fastify';
import queryGroupRoutes from '../../src/routes/query-groups.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { getCacheCoordinator } from '../../src/lib/CacheCoordinatorProvider.js';
import type { EntityType } from '../../src/lib/EntityRegistry.js';
import type { PersistedEntity } from '../../src/persistence/EntityTypes.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

/** Writes through the real coordinator, so the store and the cache agree. */
const cacheManager = {
  create: (entity: PersistedEntity, type: EntityType) => getCacheCoordinator().create(type, entity as never),
  update: (id: string, updates: Record<string, unknown>, type: EntityType) =>
    getCacheCoordinator().update(type, id, updates as never),
};

/**
 * Give a version its graph. A version is frozen from creation, so this
 * recreates it with the graph rather than editing it in place — the shape a
 * real save has, where nodes are written first and the version last.
 */
async function setVersionGraph(versionId: string, graph: Record<string, unknown>): Promise<void> {
  const coordinator = getCacheCoordinator();
  const existing = coordinator.get(versionId) as Record<string, unknown>;
  await coordinator.delete('QueryGroupVersion', versionId);
  await coordinator.create('QueryGroupVersion', { ...existing, ...graph, $id: versionId } as never);
}

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

  let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

  beforeEach(async () => {
    // A query group with one version, and that version's start and end nodes
    store = await installFakePersistenceAdapter([
      { type: 'QueryGroup', entity: { $id: testGroupId, '@type': 'QueryGroup', name: 'Test Group' } },
      {
        type: 'QueryGroupVersion',
        entity: {
          $id: testGroupVersionId,
          '@type': 'QueryGroupVersion',
          isPartOf: testGroupId,
          version: 1,
          startNode: 'start-node-id',
          endNode: 'end-node-id',
        },
      },
      { type: 'StartNode', entity: { $id: 'start-node-id', '@type': 'StartNode' } },
      { type: 'EndNode', entity: { $id: 'end-node-id', '@type': 'EndNode' } },
    ]);

    app = await buildTestApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    store.restore();
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
    await setVersionGraph(testGroupVersionId, {
      executionNodes: [nodeId],
      edges: [edgeStartId, edgeEndId]
    });

    const response = await app.inject({
      method: 'GET',
      url: `/query-groups/${testGroupId}/versions/1/validate`,
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
    await setVersionGraph(testGroupVersionId, {
      executionNodes: [nodeId],
      edges: ['urn:sqlib:edge:ephemeral-start', 'urn:sqlib:edge:ephemeral-end'],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/query-groups/${testGroupId}/versions/1/validate`,
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
    await setVersionGraph(testGroupVersionId, {
      executionNodes: [nodeId],
      edges: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/query-groups/${testGroupId}/versions/1/validate`,
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
    await setVersionGraph(testGroupVersionId, {
      edges: ['urn:sqlib:edge:broken'],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/query-groups/${testGroupId}/versions/1/validate`,
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

  /**
   * A version saved before the writer checked Start node ports can carry one
   * typed as a QueryOutputTuple. It still runs, so it is not an error, but the
   * canvas reports it and a new version with it is refused. The route names
   * the edge with a warning, so the two say the same thing.
   */
  it('warns about a Start node port saved as a result tuple', async () => {
    const backendId = 'urn:sqlib:backend:legacy-start';
    const queryVersionId = 'urn:sqlib:query-version:legacy-start';
    const inputVarId = 'urn:sqlib:input:legacy-start';
    const inputMemberId = 'urn:sqlib:tuple-member:legacy-start-in';
    const inputTupleId = 'urn:sqlib:input-tuple:legacy-start';
    const startVarId = 'urn:sqlib:output:legacy-start-param';
    const startMemberId = 'urn:sqlib:tuple-member:legacy-start-param';
    const startPortId = 'urn:sqlib:output-tuple:legacy-start-param';
    const outputVarId = 'urn:sqlib:output:legacy-start';
    const outputMemberId = 'urn:sqlib:tuple-member:legacy-start-out';
    const outputTupleId = 'urn:sqlib:output-tuple:legacy-start';
    const nodeId = 'urn:sqlib:node:legacy-start';
    const edgeStartId = 'urn:sqlib:edge:legacy-start';
    const edgeEndId = 'urn:sqlib:edge:legacy-end';

    await cacheManager.create({ $id: backendId, '@type': 'Backend' }, 'Backend');
    await cacheManager.create({
      $id: queryVersionId,
      '@type': 'QueryVersion',
      queryString: 'SELECT ?s WHERE { VALUES (?s) { (UNDEF) } ?s ?p ?o }',
      queryType: QueryTypeIri.select,
    }, 'QueryVersion');
    await cacheManager.create({ $id: inputVarId, '@type': 'QueryInputVariable', variableName: 's' }, 'QueryInputVariable');
    await cacheManager.create({ $id: inputMemberId, '@type': 'TupleMember', position: 0, variable: inputVarId }, 'TupleMember');
    await cacheManager.create({ $id: inputTupleId, '@type': 'QueryInputTuple', memberEntries: [inputMemberId] }, 'QueryInputTuple');
    await cacheManager.create({ $id: startVarId, '@type': 'QueryOutputVariable', variableName: 's' }, 'QueryOutputVariable');
    await cacheManager.create({ $id: startMemberId, '@type': 'TupleMember', position: 0, variable: startVarId }, 'TupleMember');
    await cacheManager.create({ $id: startPortId, '@type': 'QueryOutputTuple', memberEntries: [startMemberId] }, 'QueryOutputTuple');
    await cacheManager.create({ $id: outputVarId, '@type': 'QueryOutputVariable', variableName: 's' }, 'QueryOutputVariable');
    await cacheManager.create({ $id: outputMemberId, '@type': 'TupleMember', position: 0, variable: outputVarId }, 'TupleMember');
    await cacheManager.create({ $id: outputTupleId, '@type': 'QueryOutputTuple', memberEntries: [outputMemberId] }, 'QueryOutputTuple');
    await cacheManager.update('start-node-id', { outputs: [startPortId] }, 'StartNode');
    await cacheManager.update('end-node-id', { inputs: [outputTupleId] }, 'EndNode');
    await cacheManager.create({
      $id: nodeId,
      '@type': 'QueryNode',
      backendId,
      queryId: queryVersionId,
      inputs: [inputTupleId],
      outputs: [outputTupleId],
    }, 'QueryNode');
    await cacheManager.create({
      $id: edgeStartId,
      '@type': 'QueryEdge',
      sourceNodeId: 'start-node-id',
      targetNodeId: nodeId,
      dataFlowType: 'VARIABLE_BINDINGS',
      sourceOutputId: startPortId,
      targetInputId: inputTupleId,
    }, 'QueryEdge');
    await cacheManager.create({
      $id: edgeEndId,
      '@type': 'QueryEdge',
      sourceNodeId: nodeId,
      targetNodeId: 'end-node-id',
      dataFlowType: 'VARIABLE_BINDINGS',
      sourceOutputId: outputTupleId,
      targetInputId: outputTupleId,
    }, 'QueryEdge');
    await setVersionGraph(testGroupVersionId, {
      executionNodes: [nodeId],
      edges: [edgeStartId, edgeEndId],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/query-groups/${testGroupId}/versions/1/validate`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.valid).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.issues).toEqual([
      expect.objectContaining({
        level: 'warning',
        code: 'EDGE_START_PORT_LEGACY_TYPE',
        entityType: 'edge',
        entityId: edgeStartId,
      }),
    ]);
    expect(body.warnings[0]).toContain('needs a QueryInputTuple');
  });
});
