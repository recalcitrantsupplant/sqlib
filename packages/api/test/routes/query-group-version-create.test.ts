import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import queryGroupRoutes from '../../src/routes/query-groups.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  coordinatorGet: vi.fn(),
  createGroupVersionFlat: vi.fn(),
  expandGroupVersionDetailed: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.coordinatorGet,
  }),
}));

vi.mock('../../src/lib/GroupVersionWriter.js', () => ({
  createGroupVersionFlat: hoisted.createGroupVersionFlat,
}));

vi.mock('../../src/lib/GraphResolver.js', () => ({
  expandGroupVersionDetailed: hoisted.expandGroupVersionDetailed,
}));

describe('Query Group Version POST route', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema as any);
      }
    }
    await app.register(queryGroupRoutes, { prefix: '/query-groups' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.coordinatorGet.mockImplementation((id: string) => (
      id === 'urn:group:test' ? { $id: id, '@type': 'QueryGroup' } : null
    ));
  });

  it('returns a schema-compliant payload when creating a query group version', async () => {
    const groupId = 'urn:group:test';
    const versionId = 'urn:version:1';
    const executionNodeIds = ['urn:node:select', 'urn:node:construct'];
    const edgeIds = ['urn:edge:start-select', 'urn:edge:select-construct', 'urn:edge:construct-end'];

    hoisted.createGroupVersionFlat.mockResolvedValue({
      created: {
        $id: versionId,
        '@type': 'QueryGroupVersion',
        version: 1,
        startNode: 'urn:start:1',
        endNode: 'urn:end:1',
        executionNodes: executionNodeIds,
        edges: edgeIds,
        canvasData: JSON.stringify({ zoom: 1 }),
        isPartOf: groupId,
      },
      iriMap: {
        'urn:__START__': 'urn:start:1',
        'urn:__END__': 'urn:end:1',
        'urn:ui-temp:start-node-1': 'urn:start:1',
        'urn:ui-temp:end-node-1': 'urn:end:1',
        'urn:ui-temp:select-node': executionNodeIds[0],
        'urn:ui-temp:construct-node': executionNodeIds[1],
      },
    });

    hoisted.expandGroupVersionDetailed.mockResolvedValue({
      queryGroupVersion: {
        id: versionId,
        version: 1,
        startNode: 'urn:start:1',
        endNode: 'urn:end:1',
        executionNodes: executionNodeIds,
        edges: edgeIds,
        isPartOf: groupId,
        comment: 'select → construct',
      },
      executionNodes: [
        {
          id: executionNodeIds[0],
          nodeType: 'QueryNode',
          queryId: 'urn:query:select',
          backendId: 'urn:backend:1',
          isPartOf: versionId,
          inputs: [],
          outputs: ['urn:tuple:select'],
        },
        {
          id: executionNodeIds[1],
          nodeType: 'QueryNode',
          queryId: 'urn:query:construct',
          backendId: 'urn:backend:1',
          isPartOf: versionId,
          inputs: ['urn:tuple:pair'],
          outputs: ['urn:io:construct'],
        },
      ],
      edges: edgeIds.map(id => ({ id, dataFlowType: 'CONTROL_FLOW', isPartOf: versionId })),
      tupleMembers: [],
      inputTuples: [],
      outputs: [],
      outputTuples: [],
      inputs: [],
      rdfOutputs: [],
    });

    const response = await app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(groupId)}/v`,
      payload: {
        queryGroupVersion: {},
        startNode: { id: 'urn:ui-temp:start-node-1' },
        endNode: { id: 'urn:ui-temp:end-node-1' },
        executionNodes: [
          {
            id: 'urn:ui-temp:select-node',
            nodeType: 'QueryNode',
            queryId: 'urn:query:select',
            backendId: 'urn:backend:1',
            outputs: ['urn:tuple:select'],
          },
          {
            id: 'urn:ui-temp:construct-node',
            nodeType: 'QueryNode',
            queryId: 'urn:query:construct',
            backendId: 'urn:backend:1',
            inputs: ['urn:tuple:pair'],
            outputs: ['urn:io:construct'],
          },
        ],
        edges: [
          { id: 'urn:ui-temp:edge-start-select', sourceNodeId: 'urn:ui-temp:start-node-1', targetNodeId: 'urn:ui-temp:select-node', dataFlowType: 'CONTROL_FLOW' },
          { id: 'urn:ui-temp:edge-select-construct', sourceNodeId: 'urn:ui-temp:select-node', targetNodeId: 'urn:ui-temp:construct-node', dataFlowType: 'VARIABLE_BINDINGS' },
          { id: 'urn:ui-temp:edge-construct-end', sourceNodeId: 'urn:ui-temp:construct-node', targetNodeId: 'urn:ui-temp:end-node-1', dataFlowType: 'CONTROL_FLOW' },
        ],
      },
    });

    const body = response.json();
    expect(response.statusCode).toBe(201);
    expect(body.queryGroupVersion).toEqual({
      id: versionId,
      version: 1,
      startNode: 'urn:start:1',
      endNode: 'urn:end:1',
      executionNodes: executionNodeIds,
      edges: edgeIds,
      comment: 'select → construct',
      isPartOf: groupId,
    });
    expect(body.executionNodes).toEqual([
      expect.objectContaining({
        id: executionNodeIds[0],
        nodeType: 'QueryNode',
        queryId: 'urn:query:select',
        backendId: 'urn:backend:1',
      }),
      expect.objectContaining({
        id: executionNodeIds[1],
        nodeType: 'QueryNode',
        queryId: 'urn:query:construct',
        backendId: 'urn:backend:1',
      }),
    ]);
    expect(body.edges).toEqual(edgeIds.map(id => expect.objectContaining({ id, dataFlowType: 'CONTROL_FLOW' })));
    expect(body).toHaveProperty('tupleMembers');
    expect(body).toHaveProperty('inputTuples');
    expect(body).toHaveProperty('outputs');
    expect(body).toHaveProperty('outputTuples');
    expect(body).toHaveProperty('inputs');
    expect(body).toHaveProperty('rdfOutputs');
    expect(body.iriMap).toMatchObject({
      'urn:__START__': 'urn:start:1',
      'urn:__END__': 'urn:end:1',
      'urn:ui-temp:start-node-1': 'urn:start:1',
      'urn:ui-temp:end-node-1': 'urn:end:1',
      'urn:ui-temp:select-node': executionNodeIds[0],
      'urn:ui-temp:construct-node': executionNodeIds[1],
    });

    // The third argument is the auth scope: without it the writer cannot check
    // the query and rule set versions this body's nodes will run, and does not.
    expect(hoisted.createGroupVersionFlat).toHaveBeenCalledWith(
      groupId,
      expect.objectContaining({ startNode: expect.any(Object), endNode: expect.any(Object) }),
      { request: expect.anything() }
    );
    expect(hoisted.expandGroupVersionDetailed).toHaveBeenCalledWith(expect.objectContaining({ $id: versionId }));
  });
});
