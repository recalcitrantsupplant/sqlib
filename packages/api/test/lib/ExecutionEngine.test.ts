import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import { SparqlQueryParser } from '../../src/lib/parser.js';
import type { ExecutionGraph, ResolvedNode, ResolvedEdge, ArgumentSet } from '../../src/lib/orchestration/types.js';
import type { ISparqlExecutor } from '../../src/server/ISparqlExecutor.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.get,
  }),
}));

// Mock executor
const mockExecutor: ISparqlExecutor = {
  selectQueryParsed: vi.fn(),
  askQuery: vi.fn(),
  constructQueryParsed: vi.fn(),
  selectQueryStream: vi.fn(),
  constructQueryStream: vi.fn(),
  update: vi.fn(),
};

// Helper functions to create StartNode and EndNode for tests
function createStartNode(id: string = 'start'): ResolvedNode {
  return {
    id,
    queryString: undefined,
    queryType: undefined,
    backendId: undefined,
    raw: { '@type': 'StartNode', $id: id } as any,
    queryVersionId: undefined,
    queryVersion: undefined,
    inputTupleIds: [],
    outputTupleIds: [],
  };
}

function createEndNode(id: string = 'end', inputs: string[] = []): ResolvedNode {
  return {
    id,
    queryString: undefined,
    queryType: undefined,
    backendId: undefined,
    raw: { '@type': 'EndNode', $id: id, inputs } as any,
    queryVersionId: undefined,
    queryVersion: undefined,
    inputTupleIds: [],
    outputTupleIds: [],
  };
}

describe('ExecutionEngine', () => {
  let engine: ExecutionEngine;
  let mockExecutorFactory: ExecutorFactory;
  let mockParser: SparqlQueryParser;
  let cache: Map<string, any>;

  beforeEach(() => {
    mockExecutorFactory = {
      getExecutorForNode: vi.fn().mockReturnValue(mockExecutor)
    } as any as ExecutorFactory;

    mockParser = {
      detectInputs: vi.fn(),
      applyArguments: vi.fn()
    } as any as SparqlQueryParser;

    engine = new ExecutionEngine(mockExecutorFactory, mockParser);

    // Mock cache
    cache = new Map<string, any>();

    // Clear all mocks and restore default cache getter
    vi.clearAllMocks();
    hoisted.get.mockImplementation((id: string) => cache.get(id));
  });

  describe('Single node execution', () => {
    it('executes a single SELECT node', async () => {
      const mockResult = {
        head: { vars: ['entity'] },
        results: {
          bindings: [{ entity: { type: 'uri', value: 'http://example.org/entity1' } }]
        }
      };

      (mockExecutor.selectQueryParsed as any).mockResolvedValue({ result: mockResult, duration: 10 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any).mockReturnValue('SELECT ?entity WHERE { ?entity ?p ?o }');

      const startNode = createStartNode('start');
      const node: ResolvedNode = {
        id: 'node1',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: { '@type': 'QueryNode' } as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };
      const endNode = createEndNode('end', ['node1-output']);
      cache.set('node1-output', { '@type': 'QueryOutput' });

      const edge1: ResolvedEdge = {
        id: 'e1',
        raw: {} as any,
        sourceNodeId: 'start',
        targetNodeId: 'node1',
        dataFlowType: 'CONTROL_FLOW'
      };
      const edge2: ResolvedEdge = {
        id: 'e2',
        raw: {} as any,
        sourceNodeId: 'node1',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'node1-output',
        targetInputId: 'node1-output'
      };

      const graph: ExecutionGraph = {
        nodes: new Map([['start', startNode], ['node1', node], ['end', endNode]]),
        edges: [edge1, edge2],
        incomingEdges: new Map([
          ['node1', [edge1]],
          ['end', [edge2]]
        ]),
        outgoingEdges: new Map([
          ['start', [edge1]],
          ['node1', [edge2]]
        ]),
        startNodeIds: ['start'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: mockResult,
        resultNodeId: 'node1'
      });
      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledWith('SELECT ?entity WHERE { ?entity ?p ?o }');
    });

    it('executes a single ASK node', async () => {
      (mockExecutor.askQuery as any).mockResolvedValue({ result: true, duration: 10 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any).mockReturnValue('ASK WHERE { ?x ?p ?o }');

      const node: ResolvedNode = {
        id: 'node1',
        queryString: 'ASK WHERE { ?x ?p ?o }',
        queryType: QueryTypeIri.ask,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['node1-output']);
      cache.set('node1-output', { '@type': 'BooleanIO' });

      const edge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'node1',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'node1-output',
        targetInputId: 'node1-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([['node1', node], ['end', endNode]]),
        edges: [edge],
        incomingEdges: new Map([['end', [edge]]]),
        outgoingEdges: new Map([['node1', [edge]]]),
        startNodeIds: ['node1'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: true,
        resultNodeId: 'node1'
      });
      expect(mockExecutor.askQuery).toHaveBeenCalledWith('ASK WHERE { ?x ?p ?o }');
    });

    it('executes a single CONSTRUCT node', async () => {
      const mockResult = '<http://example.org/s> <http://example.org/p> <http://example.org/o> .';
      (mockExecutor.constructQueryParsed as any).mockResolvedValue({ result: mockResult, duration: 10 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any).mockReturnValue('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');

      const node: ResolvedNode = {
        id: 'node1',
        queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.construct,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['node1-output']);
      cache.set('node1-output', { '@type': 'RdfOutput' });

      const edge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'node1',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'node1-output',
        targetInputId: 'node1-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([['node1', node], ['end', endNode]]),
        edges: [edge],
        incomingEdges: new Map([['end', [edge]]]),
        outgoingEdges: new Map([['node1', [edge]]]),
        startNodeIds: ['node1'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: mockResult,
        resultNodeId: 'node1'
      });
      expect(mockExecutor.constructQueryParsed).toHaveBeenCalledWith(
        'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        { acceptHeader: undefined }
      );
    });

    it('executes a single UPDATE node', async () => {
      (mockExecutor.update as any).mockResolvedValue({ result: undefined, duration: 10 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any).mockReturnValue('INSERT DATA { <urn:s> <urn:p> <urn:o> }');

      const node: ResolvedNode = {
        id: 'node1',
        queryString: 'INSERT DATA { <urn:s> <urn:p> <urn:o> }',
        queryType: QueryTypeIri.update,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['node1-output']);
      cache.set('node1-output', { '@type': 'QueryOutputTuple' });

      const edge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'node1',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'node1-output',
        targetInputId: 'node1-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([['node1', node], ['end', endNode]]),
        edges: [edge],
        incomingEdges: new Map([['end', [edge]]]),
        outgoingEdges: new Map([['node1', [edge]]]),
        startNodeIds: ['node1'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: { success: true },
        resultNodeId: 'node1'
      });
      expect(mockExecutor.update).toHaveBeenCalledWith('INSERT DATA { <urn:s> <urn:p> <urn:o> }');
    });

    it('executes a DESCRIBE node as CONSTRUCT', async () => {
      const mockResult = '<http://example.org/s> <http://example.org/p> <http://example.org/o> .';
      (mockExecutor.constructQueryParsed as any).mockResolvedValue({ result: mockResult, duration: 10 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any).mockReturnValue('DESCRIBE <http://example.org/resource>');

      const node: ResolvedNode = {
        id: 'node1',
        queryString: 'DESCRIBE <http://example.org/resource>',
        queryType: QueryTypeIri.describe,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['node1-output']);
      cache.set('node1-output', { '@type': 'RdfOutput' });

      const edge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'node1',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'node1-output',
        targetInputId: 'node1-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([['node1', node], ['end', endNode]]),
        edges: [edge],
        incomingEdges: new Map([['end', [edge]]]),
        outgoingEdges: new Map([['node1', [edge]]]),
        startNodeIds: ['node1'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: mockResult,
        resultNodeId: 'node1'
      });
      expect(mockExecutor.constructQueryParsed).toHaveBeenCalledWith(
        'DESCRIBE <http://example.org/resource>',
        { acceptHeader: undefined }
      );
    });

    it('executes a DynamicQueryNode using QUERY_ID input', async () => {
      const dynamicQueryVersionId = 'urn:query:dynamic:v2';
      const sourceResult = {
        head: { vars: ['queryId'] },
        results: { bindings: [{ queryId: { type: 'uri', value: dynamicQueryVersionId } }] }
      };
      const dynamicResult = {
        head: { vars: ['value'] },
        results: { bindings: [] }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: sourceResult, duration: 5 })
        .mockResolvedValueOnce({ result: dynamicResult, duration: 5 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any).mockImplementation((query: string) => query);

      const outputTupleId = 'urn:tuple:qid';
      const memberId = 'urn:member:qid';
      const varId = 'urn:var:qid';
      cache.set(outputTupleId, { '@type': 'QueryOutputTuple', memberEntries: [memberId] });
      cache.set(memberId, { '@type': 'TupleMember', position: 0, variable: varId });
      cache.set(varId, { '@type': 'QueryOutputVariable', variableName: 'queryId' });
      cache.set(dynamicQueryVersionId, {
        '@type': 'QueryVersion',
        queryString: 'SELECT ?value WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select
      });
      cache.set('urn:io:qid-input', { '@type': 'QueryIdInput' });

      const startNode = createStartNode('start');
      const sourceNode: ResolvedNode = {
        id: 'source',
        queryString: 'SELECT ?queryId WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: { '@type': 'QueryNode' } as any,
        queryVersionId: 'qv-source',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [outputTupleId],
      };
      const dynamicNode: ResolvedNode = {
        id: 'dynamic',
        queryString: 'SELECT ?fallback WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: { '@type': 'DynamicQueryNode' } as any,
        queryVersionId: 'qv-fallback',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };
      const endNode = createEndNode('end', ['dynamic-output']);

      const edgeStart: ResolvedEdge = {
        id: 'edge-start',
        raw: {} as any,
        sourceNodeId: 'start',
        targetNodeId: 'source',
        dataFlowType: 'CONTROL_FLOW'
      };
      const edgeQueryId: ResolvedEdge = {
        id: 'edge-qid',
        raw: {} as any,
        sourceNodeId: 'source',
        targetNodeId: 'dynamic',
        dataFlowType: 'QUERY_ID',
        sourceOutputId: outputTupleId,
        targetInputId: 'urn:io:qid-input'
      };
      const edgeEnd: ResolvedEdge = {
        id: 'edge-end',
        raw: {} as any,
        sourceNodeId: 'dynamic',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'dynamic-output',
        targetInputId: 'dynamic-output'
      };

      const graph: ExecutionGraph = {
        nodes: new Map([['start', startNode], ['source', sourceNode], ['dynamic', dynamicNode], ['end', endNode]]),
        edges: [edgeStart, edgeQueryId, edgeEnd],
        incomingEdges: new Map([
          ['source', [edgeStart]],
          ['dynamic', [edgeQueryId]],
          ['end', [edgeEnd]]
        ]),
        outgoingEdges: new Map([
          ['start', [edgeStart]],
          ['source', [edgeQueryId]],
          ['dynamic', [edgeEnd]]
        ]),
        startNodeIds: ['start'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: dynamicResult,
        resultNodeId: 'dynamic'
      });
      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledWith('SELECT ?queryId WHERE { ?s ?p ?o }');
      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledWith('SELECT ?value WHERE { ?s ?p ?o }');
    });

    it('defaults to SELECT when query type is missing', async () => {
      const mockResult = {
        head: { vars: ['entity'] },
        results: { bindings: [] }
      };

      (mockExecutor.selectQueryParsed as any).mockResolvedValue({ result: mockResult, duration: 10 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any).mockReturnValue('SELECT ?entity WHERE { ?entity ?p ?o }');

      const node: ResolvedNode = {
        id: 'node1',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: null,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['node1-output']);
      cache.set('node1-output', { '@type': 'QueryOutput' });

      const edge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'node1',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'node1-output',
        targetInputId: 'node1-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([['node1', node], ['end', endNode]]),
        edges: [edge],
        incomingEdges: new Map([['end', [edge]]]),
        outgoingEdges: new Map([['node1', [edge]]]),
        startNodeIds: ['node1'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: mockResult,
        resultNodeId: 'node1'
      });
      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledWith('SELECT ?entity WHERE { ?entity ?p ?o }');
    });
  });

  describe('Ephemeral store materialization', () => {
    it('never materializes SELECT outputs even if flagged', async () => {
      const materializeSpy = vi.spyOn(engine as any, 'materializeRdfResult').mockResolvedValue(undefined);

      const mockResult = {
        head: { vars: ['entity'] },
        results: { bindings: [{ entity: { type: 'uri', value: 'http://example.org/entity' } }] }
      };

      (mockExecutor.selectQueryParsed as any).mockResolvedValue({ result: mockResult, duration: 5 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any).mockReturnValue('SELECT ?entity WHERE { ?entity ?p ?o }');

      const startNode = createStartNode('start');
      const endNode = createEndNode('end', ['node-output']);

      const node: ResolvedNode = {
        id: 'node',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: { '@type': 'QueryNode' } as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-select' },
        needsEphemeralMaterialization: true
      };

      const edgeStart: ResolvedEdge = {
        id: 'edge-start',
        raw: {} as any,
        sourceNodeId: 'start',
        targetNodeId: 'node',
        dataFlowType: 'CONTROL_FLOW'
      };
      const edgeEnd: ResolvedEdge = {
        id: 'edge-end',
        raw: {} as any,
        sourceNodeId: 'node',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'node-output',
        targetInputId: 'node-output'
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['start', startNode],
          ['node', node],
          ['end', endNode]
        ]),
        edges: [edgeStart, edgeEnd],
        incomingEdges: new Map([
          ['node', [edgeStart]],
          ['end', [edgeEnd]]
        ]),
        outgoingEdges: new Map([
          ['start', [edgeStart]],
          ['node', [edgeEnd]]
        ]),
        startNodeIds: ['start'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      try {
        const result = await engine.execute(graph);
        expect(result.result).toEqual(mockResult);
        expect(materializeSpy).not.toHaveBeenCalled();
      } finally {
        materializeSpy.mockRestore();
      }
    });

    it('does not materialize RDF outputs when the End node is the only consumer', async () => {
      const materializeSpy = vi.spyOn(engine as any, 'materializeRdfResult').mockResolvedValue(undefined);

      const mockResult = '<urn:s> <urn:p> "o" .';

      (mockExecutor.constructQueryParsed as any).mockResolvedValue({ result: mockResult, duration: 5 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any).mockReturnValue('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');

      const startNode = createStartNode('start');
      const endNode = createEndNode('end', ['node-output']);

      const node: ResolvedNode = {
        id: 'node',
        queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.construct,
        backendId: 'backend1',
        raw: { '@type': 'QueryNode' } as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-rdf-end' },
        needsEphemeralMaterialization: false
      };

      const edgeStart: ResolvedEdge = {
        id: 'edge-start',
        raw: {} as any,
        sourceNodeId: 'start',
        targetNodeId: 'node',
        dataFlowType: 'CONTROL_FLOW'
      };
      const edgeEnd: ResolvedEdge = {
        id: 'edge-end',
        raw: {} as any,
        sourceNodeId: 'node',
        targetNodeId: 'end',
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: 'node-output',
        targetInputId: 'node-output'
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['start', startNode],
          ['node', node],
          ['end', endNode]
        ]),
        edges: [edgeStart, edgeEnd],
        incomingEdges: new Map([
          ['node', [edgeStart]],
          ['end', [edgeEnd]]
        ]),
        outgoingEdges: new Map([
          ['start', [edgeStart]],
          ['node', [edgeEnd]]
        ]),
        startNodeIds: ['start'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      try {
        const result = await engine.execute(graph);
        expect(result.result).toEqual(mockResult);
        expect(materializeSpy).not.toHaveBeenCalled();
      } finally {
        materializeSpy.mockRestore();
      }
    });

    it('materializes RDF outputs when downstream nodes depend on them', async () => {
      const materializeSpy = vi.spyOn(engine as any, 'materializeRdfResult').mockResolvedValue(undefined);

      const mockResult = '<urn:s> <urn:p> "o" .';

      (mockExecutor.constructQueryParsed as any).mockResolvedValue({ result: mockResult, duration: 5 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any).mockReturnValue('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');

      const startNode = createStartNode('start');
      const endNode = createEndNode('end', ['node-output']);

      const node: ResolvedNode = {
        id: 'node',
        queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.construct,
        backendId: 'backend1',
        raw: { '@type': 'QueryNode' } as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-materialize' },
        needsEphemeralMaterialization: true
      };

      const edgeStart: ResolvedEdge = {
        id: 'edge-start',
        raw: {} as any,
        sourceNodeId: 'start',
        targetNodeId: 'node',
        dataFlowType: 'CONTROL_FLOW'
      };
      const edgeEnd: ResolvedEdge = {
        id: 'edge-end',
        raw: {} as any,
        sourceNodeId: 'node',
        targetNodeId: 'end',
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: 'node-output',
        targetInputId: 'node-output'
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['start', startNode],
          ['node', node],
          ['end', endNode]
        ]),
        edges: [edgeStart, edgeEnd],
        incomingEdges: new Map([
          ['node', [edgeStart]],
          ['end', [edgeEnd]]
        ]),
        outgoingEdges: new Map([
          ['start', [edgeStart]],
          ['node', [edgeEnd]]
        ]),
        startNodeIds: ['start'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      try {
        const result = await engine.execute(graph);
        expect(result.result).toEqual(mockResult);
        expect(materializeSpy).toHaveBeenCalledTimes(1);
        expect(materializeSpy).toHaveBeenCalledWith('store-materialize', mockResult, 'nquads');
      } finally {
        materializeSpy.mockRestore();
      }
    });
  });

  describe('Two-node execution with variable bindings', () => {
    it('executes two nodes with variable binding propagation', async () => {
      // Source node result
      const sourceResult = {
        head: { vars: ['entity'] },
        results: {
          bindings: [
            { entity: { type: 'uri', value: 'http://example.org/entity1' } },
            { entity: { type: 'uri', value: 'http://example.org/entity2' } }
          ]
        }
      };

      // Target node result
      const targetResult = {
        head: { vars: ['entity', 'label'] },
        results: {
          bindings: [
            {
              entity: { type: 'uri', value: 'http://example.org/entity1' },
              label: { type: 'literal', value: 'Entity One' }
            }
          ]
        }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: sourceResult, duration: 10 })
        .mockResolvedValueOnce({ result: targetResult, duration: 10 });

      (mockParser.detectInputs as any)
        .mockReturnValueOnce({ valuesInputs: [] }) // Source node
        .mockReturnValueOnce({ valuesInputs: [['entity']] }); // Target node

      (mockParser.applyArguments as any)
        .mockReturnValueOnce('SELECT ?entity WHERE { ?entity ?p ?o }') // Source
        .mockReturnValueOnce('SELECT ?entity ?label WHERE { VALUES (?entity) { (<http://example.org/entity1>) (<http://example.org/entity2>) } ?entity rdfs:label ?label }'); // Target with applied args

      // Mock cache for tuples
      const outTupleId = 'tuple:out';
      const inTupleId = 'tuple:in';
      const qoutId = 'qout:entity';
      const qinId = 'qin:entity';
      const tm1Id = 'tm:1';
      const tm2Id = 'tm:2';

      cache.set(outTupleId, { memberEntries: [tm1Id] });
      cache.set(inTupleId, { memberEntries: [tm2Id] });
      cache.set(tm1Id, { position: 0, variable: qoutId });
      cache.set(tm2Id, { position: 0, variable: qinId });
      cache.set(qoutId, { variableName: 'entity' });
      cache.set(qinId, { variableName: 'entity' });

      const sourceNode: ResolvedNode = {
        id: 'source',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const targetNode: ResolvedNode = {
        id: 'target',
        queryString: 'SELECT ?entity ?label WHERE { VALUES (?entity) { (UNDEF) } ?entity rdfs:label ?label }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['target-output']);
      cache.set('target-output', { '@type': 'QueryOutput' });

      const edge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'source',
        targetNodeId: 'target',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTupleId,
        targetInputId: inTupleId,
        raw: {} as any,
      };

      const finalEdge: ResolvedEdge = {
        id: 'edge2',
        sourceNodeId: 'target',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'target-output',
        targetInputId: 'target-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['source', sourceNode],
          ['target', targetNode],
          ['end', endNode]
        ]),
        edges: [edge, finalEdge],
        incomingEdges: new Map([['target', [edge]], ['end', [finalEdge]]]),
        outgoingEdges: new Map([['source', [edge]], ['target', [finalEdge]]]),
        startNodeIds: ['source'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: targetResult,
        resultNodeId: 'target'
      });

      // Verify execution order and argument application
      expect(mockExecutor.selectQueryParsed).toHaveBeenNthCalledWith(1, 'SELECT ?entity WHERE { ?entity ?p ?o }');
      expect(mockParser.applyArguments).toHaveBeenNthCalledWith(2, 
        'SELECT ?entity ?label WHERE { VALUES (?entity) { (UNDEF) } ?entity rdfs:label ?label }', 
        [{
          head: { vars: ['entity'] },
          arguments: {
            bindings: [
              { entity: { type: 'uri', value: 'http://example.org/entity1' } },
              { entity: { type: 'uri', value: 'http://example.org/entity2' } }
            ]
          }
        }]
      );
    });

    it('handles empty source results', async () => {
      const sourceResult = {
        head: { vars: ['entity'] },
        results: { bindings: [] }
      };

      const targetResult = {
        head: { vars: ['entity', 'label'] },
        results: { bindings: [] }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: sourceResult, duration: 10 })
        .mockResolvedValueOnce({ result: targetResult, duration: 10 });

      (mockParser.detectInputs as any)
        .mockReturnValueOnce({ valuesInputs: [] })
        .mockReturnValueOnce({ valuesInputs: [['entity']] });

      (mockParser.applyArguments as any)
        .mockReturnValueOnce('SELECT ?entity WHERE { ?entity ?p ?o }')
        .mockReturnValueOnce('SELECT ?entity ?label WHERE { VALUES (?entity) { } ?entity rdfs:label ?label }');

      // Setup cache
      const outTupleId = 'tuple:out';
      const inTupleId = 'tuple:in';
      const qoutId = 'qout:entity';
      const qinId = 'qin:entity';
      const tm1Id = 'tm:1';
      const tm2Id = 'tm:2';

      cache.set(outTupleId, { memberEntries: [tm1Id] });
      cache.set(inTupleId, { memberEntries: [tm2Id] });
      cache.set(tm1Id, { position: 0, variable: qoutId });
      cache.set(tm2Id, { position: 0, variable: qinId });
      cache.set(qoutId, { variableName: 'entity' });
      cache.set(qinId, { variableName: 'entity' });

      const sourceNode: ResolvedNode = {
        id: 'source',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const targetNode: ResolvedNode = {
        id: 'target',
        queryString: 'SELECT ?entity ?label WHERE { VALUES (?entity) { (UNDEF) } ?entity rdfs:label ?label }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['target-output']);
      cache.set('target-output', { '@type': 'QueryOutput' });

      const edge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'source',
        targetNodeId: 'target',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTupleId,
        targetInputId: inTupleId,
        raw: {} as any,
      };

      const finalEdge: ResolvedEdge = {
        id: 'edge2',
        sourceNodeId: 'target',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'target-output',
        targetInputId: 'target-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['source', sourceNode],
          ['target', targetNode],
          ['end', endNode]
        ]),
        edges: [edge, finalEdge],
        incomingEdges: new Map([['target', [edge]], ['end', [finalEdge]]]),
        outgoingEdges: new Map([['source', [edge]], ['target', [finalEdge]]]),
        startNodeIds: ['source'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: targetResult,
        resultNodeId: 'target'
      });

      // Verify empty argument set is passed
      expect(mockParser.applyArguments).toHaveBeenNthCalledWith(2, 
        'SELECT ?entity ?label WHERE { VALUES (?entity) { (UNDEF) } ?entity rdfs:label ?label }', 
        [{
          head: { vars: ['entity'] },
          arguments: { bindings: [] }
        }]
      );
    });

    it('handles sparse results with missing variables', async () => {
      const sourceResult = {
        head: { vars: ['entity', 'optional'] },
        results: {
          bindings: [
            { entity: { type: 'uri', value: 'http://example.org/entity1' } },
            {
              entity: { type: 'uri', value: 'http://example.org/entity2' },
              optional: { type: 'literal', value: 'Some value' }
            }
          ]
        }
      };

      const targetResult = {
        head: { vars: ['entity', 'label'] },
        results: { bindings: [] }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: sourceResult, duration: 10 })
        .mockResolvedValueOnce({ result: targetResult, duration: 10 });

      (mockParser.detectInputs as any)
        .mockReturnValueOnce({ valuesInputs: [] })
        .mockReturnValueOnce({ valuesInputs: [['entity']] });

      (mockParser.applyArguments as any)
        .mockReturnValueOnce('SELECT ?entity ?optional WHERE { ?entity ?p ?o }')
        .mockReturnValueOnce('SELECT ?entity ?label WHERE { VALUES (?entity) { (<http://example.org/entity1>) (<http://example.org/entity2>) } ?entity rdfs:label ?label }');

      // Setup cache for single-variable tuple
      const outTupleId = 'tuple:out';
      const inTupleId = 'tuple:in';
      const qoutId = 'qout:entity';
      const qinId = 'qin:entity';
      const tm1Id = 'tm:1';
      const tm2Id = 'tm:2';

      cache.set(outTupleId, { memberEntries: [tm1Id] });
      cache.set(inTupleId, { memberEntries: [tm2Id] });
      cache.set(tm1Id, { position: 0, variable: qoutId });
      cache.set(tm2Id, { position: 0, variable: qinId });
      cache.set(qoutId, { variableName: 'entity' });
      cache.set(qinId, { variableName: 'entity' });

      const sourceNode: ResolvedNode = {
        id: 'source',
        queryString: 'SELECT ?entity ?optional WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const targetNode: ResolvedNode = {
        id: 'target',
        queryString: 'SELECT ?entity ?label WHERE { VALUES (?entity) { (UNDEF) } ?entity rdfs:label ?label }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['target-output']);
      cache.set('target-output', { '@type': 'QueryOutput' });

      const edge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'source',
        targetNodeId: 'target',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTupleId,
        targetInputId: inTupleId,
        raw: {} as any,
      };

      const finalEdge: ResolvedEdge = {
        id: 'edge2',
        sourceNodeId: 'target',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'target-output',
        targetInputId: 'target-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['source', sourceNode],
          ['target', targetNode],
          ['end', endNode]
        ]),
        edges: [edge, finalEdge],
        incomingEdges: new Map([['target', [edge]], ['end', [finalEdge]]]),
        outgoingEdges: new Map([['source', [edge]], ['target', [finalEdge]]]),
        startNodeIds: ['source'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: targetResult,
        resultNodeId: 'target'
      });

      // Should only map the 'entity' variable (position 0)
      expect(mockParser.applyArguments).toHaveBeenNthCalledWith(2, 
        'SELECT ?entity ?label WHERE { VALUES (?entity) { (UNDEF) } ?entity rdfs:label ?label }', 
        [{
          head: { vars: ['entity'] },
          arguments: {
            bindings: [
              { entity: { type: 'uri', value: 'http://example.org/entity1' } },
              { entity: { type: 'uri', value: 'http://example.org/entity2' } }
            ]
          }
        }]
      );
    });
  });

  describe('Complex execution scenarios', () => {
    it('executes three nodes in topological order', async () => {
      const result1 = {
        head: { vars: ['entity'] },
        results: {
          bindings: [{ entity: { type: 'uri', value: 'http://example.org/entity1' } }]
        }
      };

      const result2 = {
        head: { vars: ['entity', 'type'] },
        results: {
          bindings: [{ 
            entity: { type: 'uri', value: 'http://example.org/entity1' },
            type: { type: 'uri', value: 'http://example.org/Class1' }
          }]
        }
      };

      const result3 = {
        head: { vars: ['entity', 'label'] },
        results: {
          bindings: [{ 
            entity: { type: 'uri', value: 'http://example.org/entity1' },
            label: { type: 'literal', value: 'Entity One' }
          }]
        }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: result1, duration: 10 })
        .mockResolvedValueOnce({ result: result2, duration: 10 })
        .mockResolvedValueOnce({ result: result3, duration: 10 });

      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any)
        .mockReturnValueOnce('SELECT ?entity WHERE { ?entity ?p ?o }')
        .mockReturnValueOnce('SELECT ?entity ?type WHERE { ?entity a ?type }')
        .mockReturnValueOnce('SELECT ?entity ?label WHERE { ?entity rdfs:label ?label }');

      const node1: ResolvedNode = {
        id: 'node1',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const node2: ResolvedNode = {
        id: 'node2',
        queryString: 'SELECT ?entity ?type WHERE { ?entity a ?type }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const node3: ResolvedNode = {
        id: 'node3',
        queryString: 'SELECT ?entity ?label WHERE { ?entity rdfs:label ?label }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['node3-output']);
      cache.set('node3-output', { '@type': 'QueryOutput' });

      const finalEdge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'node3',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'node3-output',
        targetInputId: 'node3-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['node1', node1],
          ['node2', node2],
          ['node3', node3],
          ['end', endNode]
        ]),
        edges: [finalEdge], // No edges - independent execution
        incomingEdges: new Map([['end', [finalEdge]]]),
        outgoingEdges: new Map([['node3', [finalEdge]]]),
        startNodeIds: ['node1', 'node2', 'node3'],
        endNodeIds: ['end'], // end is the end
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: result3,
        resultNodeId: 'node3'
      });

      // Should execute all three nodes
      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledTimes(3);
    });

    it('seeds every StartNode output tuple, not just the first', async () => {
      // Each StartNode output tuple is an independent external parameter. Seeding one
      // blob per node lets the second edge read variables that are not in it, which
      // silently degrades to an unconstrained query.
      const registerTuple = (tupleId: string, varName: string) => {
        cache.set(tupleId, { '@type': 'QueryOutputTuple', memberEntries: [`${tupleId}-m`] });
        cache.set(`${tupleId}-m`, { '@type': 'TupleMember', variable: `${tupleId}-v`, position: 0 });
        cache.set(`${tupleId}-v`, { '@type': 'QueryOutputVariable', variableName: varName });
      };
      const registerInputTuple = (tupleId: string, varName: string) => {
        cache.set(tupleId, { '@type': 'QueryInputTuple', memberEntries: [`${tupleId}-m`] });
        cache.set(`${tupleId}-m`, { '@type': 'TupleMember', variable: `${tupleId}-v`, position: 0 });
        cache.set(`${tupleId}-v`, { '@type': 'QueryInputVariable', variableName: varName });
      };
      registerTuple('start-out-city', 'city');
      registerTuple('start-out-state', 'state');
      registerInputTuple('node1-in-city', 'city');
      registerInputTuple('node1-in-state', 'state');

      (mockExecutor.selectQueryParsed as any).mockResolvedValue({
        result: { head: { vars: [] }, results: { bindings: [] } }, duration: 10,
      });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [['city'], ['state']] });
      (mockParser.applyArguments as any).mockReturnValue('SELECT * WHERE { ?s ?p ?o }');

      const startNode = createStartNode('start');
      const node: ResolvedNode = {
        id: 'node1',
        queryString: 'SELECT * WHERE { VALUES (?city) { (UNDEF) } VALUES (?state) { (UNDEF) } ?city ?p ?state }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: { '@type': 'QueryNode' } as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: ['node1-in-city', 'node1-in-state'],
        outputTupleIds: [],
      };
      const endNode = createEndNode('end', ['node1-output']);
      cache.set('node1-output', { '@type': 'QueryOutput' });

      const cityEdge: ResolvedEdge = {
        id: 'e-city', raw: {} as any, sourceNodeId: 'start', targetNodeId: 'node1',
        dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: 'start-out-city', targetInputId: 'node1-in-city',
      };
      const stateEdge: ResolvedEdge = {
        id: 'e-state', raw: {} as any, sourceNodeId: 'start', targetNodeId: 'node1',
        dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: 'start-out-state', targetInputId: 'node1-in-state',
      };
      const finalEdge: ResolvedEdge = {
        id: 'e-end', raw: {} as any, sourceNodeId: 'node1', targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW', sourceOutputId: 'node1-output', targetInputId: 'node1-output',
      };

      const graph: ExecutionGraph = {
        nodes: new Map([['start', startNode], ['node1', node], ['end', endNode]]),
        edges: [cityEdge, stateEdge, finalEdge],
        incomingEdges: new Map([['node1', [cityEdge, stateEdge]], ['end', [finalEdge]]]),
        outgoingEdges: new Map([['start', [cityEdge, stateEdge]], ['node1', [finalEdge]]]),
        startNodeIds: ['start'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const initialArgs: ArgumentSet[] = [
        { head: { vars: ['city'] }, arguments: { bindings: [{ city: { type: 'literal', value: 'Sydney' } }] } },
        { head: { vars: ['state'] }, arguments: { bindings: [{ state: { type: 'literal', value: 'NSW' } }] } },
      ];

      await engine.execute(graph, initialArgs);

      // Both parameters reach the query as bound rows.
      expect(mockParser.applyArguments).toHaveBeenCalledWith(node.queryString, [
        { head: { vars: ['city'] }, arguments: { bindings: [{ city: { type: 'literal', value: 'Sydney' } }] } },
        { head: { vars: ['state'] }, arguments: { bindings: [{ state: { type: 'literal', value: 'NSW' } }] } },
      ]);
    });

    it('uses initial arguments when no edge provides values', async () => {
      const mockResult = {
        head: { vars: ['entity', 'label'] },
        results: { bindings: [] }
      };

      (mockExecutor.selectQueryParsed as any).mockResolvedValue({ result: mockResult, duration: 10 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [['entity']] });
      const node: ResolvedNode = {
        id: 'node1',
        queryString: 'SELECT ?entity ?label WHERE { VALUES (?entity) { (UNDEF) } ?entity rdfs:label ?label }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['node1-output']);
      cache.set('node1-output', { '@type': 'QueryOutput' });

      const finalEdge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'node1',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'node1-output',
        targetInputId: 'node1-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([['node1', node], ['end', endNode]]),
        edges: [finalEdge],
        incomingEdges: new Map([['end', [finalEdge]]]),
        outgoingEdges: new Map([['node1', [finalEdge]]]),
        startNodeIds: ['node1'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const initialArgs: ArgumentSet[] = [{
        head: { vars: ['entity'] },
        arguments: {
          bindings: [{ entity: { type: 'uri', value: 'http://example.org/initial' } }]
        }
      }];

      const result = await engine.execute(graph, initialArgs);

      expect(result).toEqual({
        result: mockResult,
        resultNodeId: 'node1'
      });

      expect(mockParser.applyArguments).toHaveBeenCalledWith(
        'SELECT ?entity ?label WHERE { VALUES (?entity) { (UNDEF) } ?entity rdfs:label ?label }',
        [initialArgs[0]]
      );
    });

    it('rejects an argument set whose vars are right but ordered wrong', async () => {
      // The signature filter is order-insensitive while the match is positional, so
      // a wrong-order set used to fall through to the unconstrained path silently.
      (mockExecutor.selectQueryParsed as any).mockResolvedValue({
        result: { head: { vars: [] }, results: { bindings: [] } }, duration: 10,
      });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [['city', 'state']] });

      const node: ResolvedNode = {
        id: 'node1',
        queryString: 'SELECT * WHERE { VALUES (?city ?state) { (UNDEF UNDEF) } ?city ?p ?state }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['node1-output']);
      cache.set('node1-output', { '@type': 'QueryOutput' });

      const finalEdge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'node1',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'node1-output',
        targetInputId: 'node1-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([['node1', node], ['end', endNode]]),
        edges: [finalEdge],
        incomingEdges: new Map([['end', [finalEdge]]]),
        outgoingEdges: new Map([['node1', [finalEdge]]]),
        startNodeIds: ['node1'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const initialArgs: ArgumentSet[] = [{
        head: { vars: ['state', 'city'] }, // query declares (city, state)
        arguments: { bindings: [{
          state: { type: 'literal', value: 'NSW' },
          city: { type: 'literal', value: 'Sydney' },
        }] },
      }];

      // Reported as a node failure, so the error body can name the offending node.
      await expect(engine.execute(graph, initialArgs)).rejects.toMatchObject({
        name: 'ExecutionNodeError',
        nodeId: 'node1',
        message: expect.stringContaining(
          'Argument variable order mismatch for VALUES input [city, state]; received [state, city].'
        ),
      });
      expect(mockParser.applyArguments).not.toHaveBeenCalled();
    });

    it('falls back to empty UNDEF row when no matching arguments found', async () => {
      const mockResult = {
        head: { vars: ['entity', 'label'] },
        results: { bindings: [] }
      };

      (mockExecutor.selectQueryParsed as any).mockResolvedValue({ result: mockResult, duration: 10 });
      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [['entity']] });
      (mockParser.applyArguments as any).mockReturnValue('SELECT ?entity ?label WHERE { VALUES (?entity) { } ?entity rdfs:label ?label }');

      const node: ResolvedNode = {
        id: 'node1',
        queryString: 'SELECT ?entity ?label WHERE { VALUES (?entity) { (UNDEF) } ?entity rdfs:label ?label }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['node1-output']);
      cache.set('node1-output', { '@type': 'QueryOutput' });

      const finalEdge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'node1',
        targetNodeId: 'end',
        dataFlowType: 'CONTROL_FLOW',
        sourceOutputId: 'node1-output',
        targetInputId: 'node1-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([['node1', node], ['end', endNode]]),
        edges: [finalEdge],
        incomingEdges: new Map([['end', [finalEdge]]]),
        outgoingEdges: new Map([['node1', [finalEdge]]]),
        startNodeIds: ['node1'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: mockResult,
        resultNodeId: 'node1'
      });

      // A missing external input is intentionally unconstrained, never an
      // accidentally retained UNDEF wildcard.
      expect(mockParser.applyArguments).toHaveBeenCalledWith(
        'SELECT ?entity ?label WHERE { VALUES (?entity) { (UNDEF) } ?entity rdfs:label ?label }',
        [{
          head: { vars: ['entity'] },
          arguments: { bindings: [] },
          whenEmpty: 'unconstrained'
        }]
      );
    });
  });

  describe('Edge cases and error handling', () => {
    it('throws error for unsupported SPARQL value type', async () => {
      const sourceResult = {
        head: { vars: ['entity'] },
        results: {
          bindings: [{ entity: { type: 'bnode', value: '_:b1' } }] // Unsupported type
        }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: sourceResult, duration: 10 });

      (mockParser.detectInputs as any)
        .mockReturnValueOnce({ valuesInputs: [] });

      (mockParser.applyArguments as any)
        .mockReturnValueOnce('SELECT ?entity WHERE { ?entity ?p ?o }');

      // Setup cache
      const outTupleId = 'tuple:out';
      const inTupleId = 'tuple:in';
      const qoutId = 'qout:entity';
      const qinId = 'qin:entity';
      const tm1Id = 'tm:1';
      const tm2Id = 'tm:2';

      cache.set(outTupleId, { memberEntries: [tm1Id] });
      cache.set(inTupleId, { memberEntries: [tm2Id] });
      cache.set(tm1Id, { position: 0, variable: qoutId });
      cache.set(tm2Id, { position: 0, variable: qinId });
      cache.set(qoutId, { variableName: 'entity' });
      cache.set(qinId, { variableName: 'entity' });

      const sourceNode: ResolvedNode = {
        id: 'source',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const targetNode: ResolvedNode = {
        id: 'target',
        queryString: 'SELECT ?entity ?label WHERE { VALUES (?entity) { (UNDEF) } ?entity rdfs:label ?label }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const edge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'source',
        targetNodeId: 'target',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTupleId,
        targetInputId: inTupleId,
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['source', sourceNode],
          ['target', targetNode],
        ]),
        edges: [edge],
        incomingEdges: new Map([['target', [edge]]]),
        outgoingEdges: new Map([['source', [edge]]]),
        startNodeIds: ['source'],
        endNodeIds: ['target'],
        groupVersion: {} as any,
      };

      await expect(engine.execute(graph)).rejects.toThrow('Unsupported SPARQL value type in chaining: bnode');
    });

    it('handles missing cache entries gracefully', async () => {
      const sourceResult = {
        head: { vars: ['entity'] },
        results: {
          bindings: [{ entity: { type: 'uri', value: 'http://example.org/entity1' } }]
        }
      };

      const targetResult = {
        head: { vars: ['entity'] },
        results: { bindings: [] }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: sourceResult, duration: 10 })
        .mockResolvedValueOnce({ result: targetResult, duration: 10 });

      (mockParser.detectInputs as any)
        .mockReturnValueOnce({ valuesInputs: [] })
        .mockReturnValueOnce({ valuesInputs: [] });

      (mockParser.applyArguments as any)
        .mockReturnValueOnce('SELECT ?entity WHERE { ?entity ?p ?o }')
        .mockReturnValueOnce('SELECT ?entity WHERE { ?entity ?p ?o }');

      // Don't set up cache - should handle missing entries

      const sourceNode: ResolvedNode = {
        id: 'source',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const targetNode: ResolvedNode = {
        id: 'target',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: { inputs: ['missing-tuple'] } as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const edge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'source',
        targetNodeId: 'target',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: 'missing-tuple',
        targetInputId: 'missing-tuple',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['source', sourceNode],
          ['target', targetNode]
        ]),
        edges: [edge],
        incomingEdges: new Map([['target', [edge]]]),
        outgoingEdges: new Map([['source', [edge]]]),
        startNodeIds: ['source'],
        endNodeIds: ['target'],
        groupVersion: {} as any,
      };

      // Should not throw, should handle missing cache entries gracefully
      const result = await engine.execute(graph);

      // EndNode collects results from its predecessors, so result comes from 'source' node
      expect(result).toEqual({
        result: sourceResult,
        resultNodeId: 'source'
      });
    });

    it('skips non-VARIABLE_BINDINGS edges', async () => {
      const sourceResult = {
        head: { vars: ['entity'] },
        results: { bindings: [{ entity: { type: 'uri', value: 'http://example.org/entity1' } }] }
      };

      const targetResult = {
        head: { vars: ['entity'] },
        results: { bindings: [] }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: sourceResult, duration: 10 })
        .mockResolvedValueOnce({ result: targetResult, duration: 10 });

      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any)
        .mockReturnValueOnce('SELECT ?entity WHERE { ?entity ?p ?o }')
        .mockReturnValueOnce('SELECT ?entity WHERE { ?entity ?p ?o }');

      // Set up cache entries for the output tuples
      cache.set('source-output', { '@type': 'QueryOutput', '@id': 'source-output' });
      cache.set('target-output', { '@type': 'QueryOutput', '@id': 'target-output' });

      const sourceNode: ResolvedNode = {
        id: 'source',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: ['source-output'],
      };

      const targetNode: ResolvedNode = {
        id: 'target',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: ['target-output'],
      };

      const endNode = createEndNode('end', ['target-output']);

      const rdfEdge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'source',
        targetNodeId: 'target',
        dataFlowType: 'RDF_GRAPH', // Not VARIABLE_BINDINGS - should be skipped for argument passing
        sourceOutputId: 'source-output',
        targetInputId: 'target-input',
        raw: {} as any,
      };

      const endEdge: ResolvedEdge = {
        id: 'edge2',
        sourceNodeId: 'target',
        targetNodeId: 'end',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: 'target-output',
        targetInputId: 'target-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['source', sourceNode],
          ['target', targetNode],
          ['end', endNode]
        ]),
        edges: [rdfEdge, endEdge],
        incomingEdges: new Map([
          ['target', [rdfEdge]],
          ['end', [endEdge]]
        ]),
        outgoingEdges: new Map([
          ['source', [rdfEdge]],
          ['target', [endEdge]]
        ]),
        startNodeIds: ['source'],
        endNodeIds: ['end'],
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      // Both source and target should execute (RDF edge doesn't prevent execution)
      // Result comes from target node via the EndNode
      expect(result).toEqual({
        result: targetResult,
        resultNodeId: 'target'
      });

      // Both execution nodes should run (RDF edge is skipped for argument passing but doesn't prevent execution)
      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledTimes(2);
    });
  });

  describe('Result selection', () => {
    it('returns result from specified end node', async () => {
      const result1 = {
        head: { vars: ['entity'] },
        results: { bindings: [{ entity: { type: 'uri', value: 'http://example.org/entity1' } }] }
      };

      const result2 = {
        head: { vars: ['label'] },
        results: { bindings: [{ label: { type: 'literal', value: 'Label' } }] }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: result1, duration: 10 })
        .mockResolvedValueOnce({ result: result2, duration: 10 });

      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any)
        .mockReturnValueOnce('SELECT ?entity WHERE { ?entity ?p ?o }')
        .mockReturnValueOnce('SELECT ?label WHERE { ?x rdfs:label ?label }');

      // Set up cache entry for node1 output
      cache.set('node1-output', { '@type': 'QueryOutput', '@id': 'node1-output' });

      const node1: ResolvedNode = {
        id: 'node1',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: ['node1-output'],
      };

      const node2: ResolvedNode = {
        id: 'node2',
        queryString: 'SELECT ?label WHERE { ?x rdfs:label ?label }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const endNode = createEndNode('end', ['node1-output']);

      const endEdge: ResolvedEdge = {
        id: 'edge1',
        sourceNodeId: 'node1',
        targetNodeId: 'end',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: 'node1-output',
        targetInputId: 'node1-output',
        raw: {} as any,
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['node1', node1],
          ['node2', node2],
          ['end', endNode]
        ]),
        edges: [endEdge],
        incomingEdges: new Map([['end', [endEdge]]]),
        outgoingEdges: new Map([['node1', [endEdge]]]),
        startNodeIds: ['node1', 'node2'],
        endNodeIds: ['end'], // end is the designated end node
        groupVersion: {} as any,
      };

      const result = await engine.execute(graph);

      expect(result).toEqual({
        result: result1, // Should return result from node1 (via EndNode), not node2
        resultNodeId: 'node1'
      });
    });

    it('throws an error if no end nodes are specified', async () => {
      const result1 = {
        head: { vars: ['entity'] },
        results: { bindings: [] }
      };

      const result2 = {
        head: { vars: ['label'] },
        results: { bindings: [] }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: result1, duration: 10 })
        .mockResolvedValueOnce({ result: result2, duration: 10 });

      (mockParser.detectInputs as any).mockReturnValue({ valuesInputs: [] });
      (mockParser.applyArguments as any)
        .mockReturnValueOnce('SELECT ?entity WHERE { ?entity ?p ?o }')
        .mockReturnValueOnce('SELECT ?label WHERE { ?x rdfs:label ?label }');

      const node1: ResolvedNode = {
        id: 'node1',
        queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const node2: ResolvedNode = {
        id: 'node2',
        queryString: 'SELECT ?label WHERE { ?x rdfs:label ?label }',
        queryType: QueryTypeIri.select,
        backendId: 'backend1',
        raw: {} as any,
        queryVersionId: 'qv1',
        queryVersion: {} as any,
        inputTupleIds: [],
        outputTupleIds: [],
      };

      const graph: ExecutionGraph = {
        nodes: new Map([
          ['node1', node1],
          ['node2', node2]
        ]),
        edges: [],
        incomingEdges: new Map(),
        outgoingEdges: new Map(),
        startNodeIds: ['node1', 'node2'],
        endNodeIds: [], // No end nodes specified
        groupVersion: {} as any,
      };

      await expect(engine.execute(graph)).rejects.toThrow('Query group execution graph must have an EndNode');
    });
  });
});
