import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  cacheCoordinator: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    resolveExisting: vi.fn(),
  },
  RdfOutputs: {
    findByIri: vi.fn(),
  },
  StartNodes: {
    findByIri: vi.fn(),
  },
  EndNodes: {
    findByIri: vi.fn(),
  },
  QueryNodes: {
    findByIri: vi.fn(),
  },
  DynamicQueryNodes: {
    findByIri: vi.fn(),
  },
  QueryEdges: {
    findByIri: vi.fn(),
  },
}));

let createGroupVersionFlat: typeof import('../../src/lib/GroupVersionWriter.js').createGroupVersionFlat;
let cacheCoordinator: ReturnType<typeof import('../../src/lib/CacheCoordinatorProvider.js').getCacheCoordinator>;

describe('GroupVersionWriter', () => {
  beforeEach(async () => {
    vi.resetModules();

    hoisted.cacheCoordinator.list.mockReset();
    hoisted.cacheCoordinator.create.mockReset();
    hoisted.cacheCoordinator.update.mockReset();
    hoisted.cacheCoordinator.get.mockReset();
    hoisted.cacheCoordinator.resolveExisting.mockReset();

    vi.doMock('../../src/lib/CacheCoordinatorProvider.js', () => ({
      getCacheCoordinator: () => hoisted.cacheCoordinator,
    }));
    vi.doMock('../../src/persistence/utils/RdfOutputUtils.js', () => ({
      RdfOutputs: hoisted.RdfOutputs,
    }));
    vi.doMock('../../src/persistence/utils/StartNodeUtils.js', () => ({
      StartNodes: hoisted.StartNodes,
    }));
    vi.doMock('../../src/persistence/utils/EndNodeUtils.js', () => ({
      EndNodes: hoisted.EndNodes,
    }));
    vi.doMock('../../src/persistence/utils/QueryNodeUtils.js', () => ({
      QueryNodes: hoisted.QueryNodes,
    }));
    vi.doMock('../../src/persistence/utils/DynamicQueryNodeUtils.js', () => ({
      DynamicQueryNodes: hoisted.DynamicQueryNodes,
    }));
    vi.doMock('../../src/persistence/utils/QueryEdgeUtils.js', () => ({
      QueryEdges: hoisted.QueryEdges,
    }));

    ({ createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js'));
    ({ getCacheCoordinator: cacheCoordinator } = await import('../../src/lib/CacheCoordinatorProvider.js'));

    hoisted.cacheCoordinator.list.mockReturnValue([]);
    hoisted.cacheCoordinator.create.mockResolvedValue({ $id: 'test-id' });
    hoisted.cacheCoordinator.update.mockResolvedValue({ $id: 'test-id', '@type': 'QueryGroupVersion' });
    hoisted.cacheCoordinator.get.mockReturnValue(null);
    // The writer refuses references it cannot resolve. These tests are about
    // what gets written, not about reference checking, so the store answers
    // for whatever a payload names, typed from the id.
    hoisted.cacheCoordinator.resolveExisting.mockImplementation(async (id: string) => {
      const type =
        id.includes('query-version') ? 'QueryVersion'
        : id.includes('ruleset-version') ? 'RuleSetVersion'
        : id.includes('backend') ? 'Backend'
        : id.includes('input') ? 'QueryInputTuple'
        : 'QueryOutputTuple';
      return { type, entity: { $id: id, '@type': type } };
    });
  });

  describe('createGroupVersionFlat', () => {
    it('should create a simple QueryGroupVersion with nodes and edges', async () => {
      const groupId = 'urn:test:group:1';
      const queryVersionId1 = 'urn:test:query-version:1';
      const queryVersionId2 = 'urn:test:query-version:2';
      const backendId = 'urn:test:backend:1';

      const body = {
        queryGroupVersion: {},
        endNode: {
          id: 'urn:ui-temp:end-1',
          mediaType: 'application/n-triples'
        },
        executionNodes: [
          {
            id: 'urn:ui-temp:node-1',
            nodeType: 'QueryNode',
            queryId: queryVersionId1,
            backendId: backendId,
            inputs: [],
            outputs: ['output-tuple-1']
          },
          {
            id: 'urn:ui-temp:node-2',
            nodeType: 'QueryNode',
            queryId: queryVersionId2,
            backendId: backendId,
            inputs: ['input-tuple-1'],
            outputs: []
          }
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-1',
            sourceNodeId: 'urn:__START__',
            targetNodeId: 'urn:ui-temp:node-1',
            dataFlowType: 'CONTROL_FLOW'
          },
          {
            id: 'urn:ui-temp:edge-2',
            sourceNodeId: 'urn:ui-temp:node-1',
            targetNodeId: 'urn:ui-temp:node-2',
            dataFlowType: 'VARIABLE_BINDINGS',
            sourceOutputId: 'output-tuple-1',
            targetInputId: 'input-tuple-1'
          },
          {
            id: 'urn:ui-temp:edge-3',
            sourceNodeId: 'urn:ui-temp:node-2',
            targetNodeId: 'urn:__END__',
            dataFlowType: 'CONTROL_FLOW'
          }
        ]
      };

      const result = await createGroupVersionFlat(groupId, body);

      // Verify result structure
      expect(result).toHaveProperty('created');
      expect(result).toHaveProperty('iriMap');
      expect(result.iriMap).toHaveProperty('urn:__START__');
      expect(result.iriMap).toHaveProperty('urn:__END__');
      expect(result.iriMap).toHaveProperty('urn:ui-temp:node-1');
      expect(result.iriMap).toHaveProperty('urn:ui-temp:node-2');

      // Verify cache manager was called to create entities
      expect(hoisted.cacheCoordinator.create).toHaveBeenCalledWith(
        'QueryGroupVersion',
        expect.objectContaining({ '@type': 'QueryGroupVersion' }),
      );

      // Note: ControlFlowIO is no longer created (Option B design)
      // CONTROL_FLOW edges don't use I/O references

      // Verify nodes were created via cache manager
      expect(hoisted.cacheCoordinator.create).toHaveBeenCalledWith(
        'StartNode',
        expect.objectContaining({ '@type': 'StartNode' }),
      );

      expect(hoisted.cacheCoordinator.create).toHaveBeenCalledWith(
        'EndNode',
        expect.objectContaining({ '@type': 'EndNode' }),
      );

      expect(hoisted.cacheCoordinator.create).toHaveBeenCalledWith(
        'QueryNode',
        expect.objectContaining({ '@type': 'QueryNode' }),
      );

      // Verify edges were created via cache manager
      expect(hoisted.cacheCoordinator.create).toHaveBeenCalledWith(
        'QueryEdge',
        expect.objectContaining({ '@type': 'QueryEdge' }),
      );

      // Note: ControlFlowIO is no longer created (Option B design)
      // EndNode inputs will be empty when only CONTROL_FLOW edges connect to it

      // Verify final update was called
      expect(hoisted.cacheCoordinator.update).toHaveBeenCalled();
    });

    it('should handle minimal node configuration', async () => {
      const groupId = 'urn:test:group:minimal';
      const body = {
        queryGroupVersion: {},
        startNode: { id: 'urn:ui-temp:start' },
        endNode: { id: 'urn:ui-temp:end' },
        executionNodes: [],
        edges: []
      };

      const result = await createGroupVersionFlat(groupId, body);

      expect(result).toHaveProperty('created');
      expect(result).toHaveProperty('iriMap');

      // Should still create the basic structure
      expect(hoisted.cacheCoordinator.create).toHaveBeenCalledWith(
        'QueryGroupVersion',
        expect.objectContaining({ '@type': 'QueryGroupVersion' }),
      );
    });

    it('should persist EndNode mediaType when provided', async () => {
      const groupId = 'urn:test:group:media-type';
      const body = {
        queryGroupVersion: {},
        startNode: { id: 'urn:ui-temp:start' },
        endNode: { id: 'urn:ui-temp:end', mediaType: 'text/turtle' },
        executionNodes: [],
        edges: []
      };

      await createGroupVersionFlat(groupId, body);

      expect(hoisted.cacheCoordinator.create).toHaveBeenCalledWith(
        'EndNode',
        expect.objectContaining({ '@type': 'EndNode', mediaType: 'text/turtle' }),
      );
    });

    it('should properly resolve backend configuration', async () => {
      const groupId = 'urn:test:group:backend-resolution';
      const queryVersionId = 'urn:test:query-version:with-backend';
      const backendId = 'urn:test:backend:default';

      // The default backend hangs off the parent Query, not the QueryVersion,
      // so both have to be in the store for the lookup to have anything to
      // follow. This used to set one mock for every id, which meant the
      // `get(undefined)` for the absent isPartOf happened to return it.
      const parentQueryId = 'urn:test:query:with-backend';
      const store: Record<string, any> = {
        [queryVersionId]: {
          $id: queryVersionId,
          '@type': 'QueryVersion',
          isPartOf: parentQueryId,
        },
        [parentQueryId]: {
          $id: parentQueryId,
          '@type': 'Query',
          defaultBackend: backendId,
        },
      };
      (hoisted.cacheCoordinator.get as any).mockImplementation((id: string) => store[id] ?? null);

      const body = {
        queryGroupVersion: {},
        startNode: { id: 'urn:ui-temp:start' },
        endNode: { id: 'urn:ui-temp:end' },
        executionNodes: [
          {
            id: 'urn:ui-temp:node-with-backend',
            nodeType: 'QueryNode',
            queryId: queryVersionId
            // No explicit backendId - should resolve from QueryVersion
          }
        ],
        edges: []
      };

      const result = await createGroupVersionFlat(groupId, body);

      expect(result).toHaveProperty('created');

      // Verify QueryNode was created with resolved backend
      expect(hoisted.cacheCoordinator.create).toHaveBeenCalledWith(
        'QueryNode',
        expect.objectContaining({
          '@type': 'QueryNode',
          backendId: backendId
        }),
      );
    });

    it('persists rule-set-only graphs without requiring backend IDs', async () => {
      const groupId = 'urn:test:group:ruleset-only';
      const ruleSetVersionId = 'urn:test:ruleset-version:1';
      const rdfInputId = 'urn:test:triples:input';
      const rdfOutputId = 'urn:test:triples:output';

      const body = {
        queryGroupVersion: {},
        rdfOutputs: [
          { id: rdfInputId, name: 'Seed graph', ioType: 'input' },
          { id: rdfOutputId, name: 'Inference graph', ioType: 'output' },
        ],
        executionNodes: [
          {
            id: 'urn:ui-temp:ruleset-node',
            nodeType: 'RuleSetNode',
            ruleSetVersionId,
            inputs: [rdfInputId],
            outputs: [rdfOutputId],
          },
        ],
        edges: [
          {
            id: 'urn:ui-temp:edge-start',
            sourceNodeId: 'urn:__START__',
            targetNodeId: 'urn:ui-temp:ruleset-node',
            dataFlowType: 'CONTROL_FLOW',
          },
          {
            id: 'urn:ui-temp:edge-rdf-in',
            sourceNodeId: 'urn:__START__',
            targetNodeId: 'urn:ui-temp:ruleset-node',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: rdfInputId,
            targetInputId: rdfInputId,
          },
          {
            id: 'urn:ui-temp:edge-rdf-out',
            sourceNodeId: 'urn:ui-temp:ruleset-node',
            targetNodeId: 'urn:__END__',
            dataFlowType: 'RDF_GRAPH',
            sourceOutputId: rdfOutputId,
            targetInputId: rdfOutputId,
          },
        ],
      };

      await expect(createGroupVersionFlat(groupId, body)).resolves.toHaveProperty('created');

      expect(hoisted.cacheCoordinator.create).toHaveBeenCalledWith(
        'RuleSetNode',
        expect.objectContaining({
          '@type': 'RuleSetNode',
          ruleSetVersion: ruleSetVersionId,
          inputs: [rdfInputId],
          outputs: [rdfOutputId],
        }),
      );
    });
  });
});
