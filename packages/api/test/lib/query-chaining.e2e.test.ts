import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { GraphBuilder } from '../../src/lib/orchestration/GraphBuilder.js';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import type { ISparqlExecutor } from '../../src/server/ISparqlExecutor.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  getAll: vi.fn(),
}));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: hoisted.get,
    list: hoisted.list,
    getAll: hoisted.getAll,
  }),
});

// Mock executor for end-to-end tests
const mockExecutor: ISparqlExecutor = {
  selectQueryParsed: vi.fn(),
  askQuery: vi.fn(),
  constructQueryParsed: vi.fn(),
  selectQueryStream: vi.fn(),
  constructQueryStream: vi.fn(),
  update: vi.fn(),
};

describe('Query Chaining End-to-End', () => {
  let graphBuilder: GraphBuilder;
  let executionEngine: ExecutionEngine;
  let cache: Map<string, any>;

  beforeEach(() => {
    graphBuilder = new GraphBuilder();

    // Mock executor factory
    const mockExecutorFactory = {
      getExecutorForNode: vi.fn().mockReturnValue(mockExecutor)
    } as any;

    executionEngine = new ExecutionEngine(mockExecutorFactory);

    // Mock cache
    cache = new Map<string, any>();

    // Clear all mocks
    vi.clearAllMocks();
    hoisted.get.mockImplementation((id: string) => cache.get(id) ?? null);
    hoisted.list.mockImplementation((type: string) =>
      Array.from(cache.values()).filter((entity: any) => entity['@type'] === type)
    );
    hoisted.getAll.mockImplementation(() => Array.from(cache.values()));
  });

  describe('Two-node query chain', () => {
    it('executes a complete entity -> details query chain', async () => {
      // Setup mock results
      const entitiesResult = {
        head: { vars: ['entity'] },
        results: {
          bindings: [
            { entity: { type: 'uri', value: 'http://example.org/Person1' } },
            { entity: { type: 'uri', value: 'http://example.org/Person2' } }
          ]
        }
      };

      const detailsResult = {
        head: { vars: ['entity', 'name'] },
        results: {
          bindings: [
            {
              entity: { type: 'uri', value: 'http://example.org/Person1' },
              name: { type: 'literal', value: 'John Doe' }
            },
            {
              entity: { type: 'uri', value: 'http://example.org/Person2' },
              name: { type: 'literal', value: 'Jane Smith' }
            }
          ]
        }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: entitiesResult, duration: 0 })
        .mockResolvedValueOnce({ result: detailsResult, duration: 0 });

      // Set up cache entities for the query graph
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      // Output tuple for entities query
      const qout1 = 'urn:qout:entity';
      const tm1 = 'urn:tm:1';
      const outTuple = 'urn:tuple:out';
      cache.set(qout1, { $id: qout1, '@type': 'QueryOutputVariable', variableName: 'entity' });
      cache.set(tm1, { $id: tm1, '@type': 'TupleMember', position: 0, variable: qout1 });
      cache.set(outTuple, { $id: outTuple, '@type': 'QueryOutputTuple', memberEntries: [tm1] });

      // Input tuple for details query
      const qin1 = 'urn:qin:entity';
      const tm2 = 'urn:tm:2';
      const inTuple = 'urn:tuple:in';
      cache.set(qin1, { $id: qin1, '@type': 'QueryInputVariable', variableName: 'entity' });
      cache.set(tm2, { $id: tm2, '@type': 'TupleMember', position: 0, variable: qin1 });
      cache.set(inTuple, { $id: inTuple, '@type': 'QueryInputTuple', memberEntries: [tm2] });

      // Output tuple from n2
      const qout2 = 'urn:qout:entity2';
      const qout3 = 'urn:qout:name';
      const tm3 = 'urn:tm:3';
      const tm4 = 'urn:tm:4';
      const outTuple2 = 'urn:tuple:out2';
      cache.set(qout2, { $id: qout2, '@type': 'QueryOutputVariable', variableName: 'entity' });
      cache.set(qout3, { $id: qout3, '@type': 'QueryOutputVariable', variableName: 'name' });
      cache.set(tm3, { $id: tm3, '@type': 'TupleMember', position: 0, variable: qout2 });
      cache.set(tm4, { $id: tm4, '@type': 'TupleMember', position: 1, variable: qout3 });
      cache.set(outTuple2, { $id: outTuple2, '@type': 'QueryOutputTuple', memberEntries: [tm3, tm4] });

      // EndNode input tuple
      const qin2 = 'urn:qin:entity2';
      const qin3 = 'urn:qin:name2';
      const tm5 = 'urn:tm:5';
      const tm6 = 'urn:tm:6';
      // EndNode uses pass-through semantics - no separate endInputTuple needed
      cache.set(qin2, { $id: qin2, '@type': 'QueryInputVariable', variableName: 'entity' });
      cache.set(qin3, { $id: qin3, '@type': 'QueryInputVariable', variableName: 'name' });
      cache.set(tm5, { $id: tm5, '@type': 'TupleMember', position: 0, variable: qin2 });
      cache.set(tm6, { $id: tm6, '@type': 'TupleMember', position: 1, variable: qin3 });

      // Query versions
      const qv1 = 'urn:qv:entities';
      const qv2 = 'urn:qv:details';
      cache.set(qv1, {
        $id: qv1,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?entity WHERE { ?entity a <http://xmlns.com/foaf/0.1/Person> }',
        queryType: QueryTypeIri.select
      });
      cache.set(qv2, {
        $id: qv2,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?entity ?name WHERE { VALUES (?entity) { (UNDEF) } ?entity <http://xmlns.com/foaf/0.1/name> ?name }',
        queryType: QueryTypeIri.select
      });

      // Nodes
      const n1 = 'urn:node:entities';
      const n2 = 'urn:node:details';
      const endNode = 'urn:node:end';
      cache.set(n1, {
        $id: n1,
        '@type': 'QueryNode',
        backendId,
        queryId: qv1,
        outputs: [outTuple]
      });
      cache.set(n2, {
        $id: n2,
        '@type': 'QueryNode',
        backendId,
        queryId: qv2,
        inputs: [inTuple],
        outputs: [outTuple2]
      });
      cache.set(endNode, {
        $id: endNode,
        '@type': 'EndNode',
        inputs: [outTuple2]
      });

      // Edges
      const e1 = 'urn:edge:1';
      const e2 = 'urn:edge:2';
      cache.set(e1, {
        $id: e1,
        '@type': 'QueryEdge',
        sourceNodeId: n1,
        targetNodeId: n2,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple,
        targetInputId: inTuple
      });
      cache.set(e2, {
        $id: e2,
        '@type': 'QueryEdge',
        sourceNodeId: n2,
        targetNodeId: endNode,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple2,
        targetInputId: outTuple2
      });

      // Query group version
      const gv = 'urn:qgv:person-details';
      cache.set(gv, {
        $id: gv,
        '@type': 'QueryGroupVersion',
        executionNodes: [n1, n2],
        endNode,
        edges: [e1, e2]
      });

      // Build and execute the graph
      const graph = graphBuilder.buildFromGroupVersionId(gv);
      const result = await executionEngine.execute(graph);

      // Verify the result
      expect(result).toEqual({
        result: detailsResult,
        resultNodeId: n2
      });

      // Verify execution calls
      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledTimes(2);

      // First call should be the entities query
      const firstCall = (mockExecutor.selectQueryParsed as any).mock.calls[0][0];
      expect(firstCall).toContain('?entity');
      expect(firstCall).toContain('http://xmlns.com/foaf/0.1/Person');

      // Second call should be the details query with applied VALUES
      const secondCall = (mockExecutor.selectQueryParsed as any).mock.calls[1][0];
      expect(secondCall).toContain('VALUES');
      expect(secondCall).toContain('<http://example.org/Person1>');
      expect(secondCall).toContain('<http://example.org/Person2>');
    });

    it('handles empty results in chained queries', async () => {
      // Setup mock results - entities query returns no results
      const entitiesResult = {
        head: { vars: ['entity'] },
        results: { bindings: [] }
      };

      const detailsResult = {
        head: { vars: ['entity', 'name'] },
        results: { bindings: [] }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: entitiesResult, duration: 0 })
        .mockResolvedValueOnce({ result: detailsResult, duration: 0 });

      // Set up minimal cache for the test
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const qout1 = 'urn:qout:entity';
      const tm1 = 'urn:tm:1';
      const outTuple = 'urn:tuple:out';
      cache.set(qout1, { $id: qout1, '@type': 'QueryOutputVariable', variableName: 'entity' });
      cache.set(tm1, { $id: tm1, '@type': 'TupleMember', position: 0, variable: qout1 });
      cache.set(outTuple, { $id: outTuple, '@type': 'QueryOutputTuple', memberEntries: [tm1] });

      const qin1 = 'urn:qin:entity';
      const tm2 = 'urn:tm:2';
      const inTuple = 'urn:tuple:in';
      cache.set(qin1, { $id: qin1, '@type': 'QueryInputVariable', variableName: 'entity' });
      cache.set(tm2, { $id: tm2, '@type': 'TupleMember', position: 0, variable: qin1 });
      cache.set(inTuple, { $id: inTuple, '@type': 'QueryInputTuple', memberEntries: [tm2] });

      // Output tuple from n2
      const qout2 = 'urn:qout:entity2';
      const qout3 = 'urn:qout:name';
      const tm3 = 'urn:tm:3';
      const tm4 = 'urn:tm:4';
      const outTuple2 = 'urn:tuple:out2';
      cache.set(qout2, { $id: qout2, '@type': 'QueryOutputVariable', variableName: 'entity' });
      cache.set(qout3, { $id: qout3, '@type': 'QueryOutputVariable', variableName: 'name' });
      cache.set(tm3, { $id: tm3, '@type': 'TupleMember', position: 0, variable: qout2 });
      cache.set(tm4, { $id: tm4, '@type': 'TupleMember', position: 1, variable: qout3 });
      cache.set(outTuple2, { $id: outTuple2, '@type': 'QueryOutputTuple', memberEntries: [tm3, tm4] });

      // EndNode input tuple
      const qin2 = 'urn:qin:entity2';
      const qin3 = 'urn:qin:name2';
      const tm5 = 'urn:tm:5';
      const tm6 = 'urn:tm:6';
      // EndNode uses pass-through semantics - no separate endInputTuple needed
      cache.set(qin2, { $id: qin2, '@type': 'QueryInputVariable', variableName: 'entity' });
      cache.set(qin3, { $id: qin3, '@type': 'QueryInputVariable', variableName: 'name' });
      cache.set(tm5, { $id: tm5, '@type': 'TupleMember', position: 0, variable: qin2 });
      cache.set(tm6, { $id: tm6, '@type': 'TupleMember', position: 1, variable: qin3 });

      const qv1 = 'urn:qv:entities';
      const qv2 = 'urn:qv:details';
      cache.set(qv1, {
        $id: qv1,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?entity WHERE { ?entity a <http://xmlns.com/foaf/0.1/Person> }',
        queryType: QueryTypeIri.select
      });
      cache.set(qv2, {
        $id: qv2,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?entity ?name WHERE { VALUES (?entity) { (UNDEF) } ?entity <http://xmlns.com/foaf/0.1/name> ?name }',
        queryType: QueryTypeIri.select
      });

      const n1 = 'urn:node:entities';
      const n2 = 'urn:node:details';
      const endNode = 'urn:node:end';
      cache.set(n1, {
        $id: n1,
        '@type': 'QueryNode',
        backendId,
        queryId: qv1,
        outputs: [outTuple]
      });
      cache.set(n2, {
        $id: n2,
        '@type': 'QueryNode',
        backendId,
        queryId: qv2,
        inputs: [inTuple],
        outputs: [outTuple2]
      });
      cache.set(endNode, {
        $id: endNode,
        '@type': 'EndNode',
        inputs: [outTuple2]
      });

      const e1 = 'urn:edge:1';
      const e2 = 'urn:edge:2';
      cache.set(e1, {
        $id: e1,
        '@type': 'QueryEdge',
        sourceNodeId: n1,
        targetNodeId: n2,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple,
        targetInputId: inTuple
      });
      cache.set(e2, {
        $id: e2,
        '@type': 'QueryEdge',
        sourceNodeId: n2,
        targetNodeId: endNode,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple2,
        targetInputId: outTuple2
      });

      const gv = 'urn:qgv:empty-chain';
      cache.set(gv, {
        $id: gv,
        '@type': 'QueryGroupVersion',
        executionNodes: [n1, n2],
        endNode,
        edges: [e1, e2]
      });

      const graph = graphBuilder.buildFromGroupVersionId(gv);
      const result = await executionEngine.execute(graph);

      expect(result).toEqual({
        result: detailsResult,
        resultNodeId: n2
      });

      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledTimes(2);

      // Second call should still happen but with empty VALUES clause
      const secondCall = (mockExecutor.selectQueryParsed as any).mock.calls[1][0];
      expect(secondCall).toContain('VALUES');
    });
  });

  describe('Three-node query chain', () => {
    it('executes a complex multi-step query chain', async () => {
      // Step 1: Get person entities
      const personsResult = {
        head: { vars: ['person'] },
        results: {
          bindings: [{ person: { type: 'uri', value: 'http://example.org/Person1' } }]
        }
      };

      // Step 2: Get organizations for persons
      const orgsResult = {
        head: { vars: ['person', 'org'] },
        results: {
          bindings: [{
            person: { type: 'uri', value: 'http://example.org/Person1' },
            org: { type: 'uri', value: 'http://example.org/Org1' }
          }]
        }
      };

      // Step 3: Get organization details
      const orgDetailsResult = {
        head: { vars: ['org', 'name'] },
        results: {
          bindings: [{
            org: { type: 'uri', value: 'http://example.org/Org1' },
            name: { type: 'literal', value: 'ACME Corp' }
          }]
        }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: personsResult, duration: 0 })
        .mockResolvedValueOnce({ result: orgsResult, duration: 0 })
        .mockResolvedValueOnce({ result: orgDetailsResult, duration: 0 });

      // Set up cache for three-node chain
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      // First chain: person -> org
      const qout1 = 'urn:qout:person';
      const tm1 = 'urn:tm:1';
      const outTuple1 = 'urn:tuple:out1';
      cache.set(qout1, { $id: qout1, '@type': 'QueryOutputVariable', variableName: 'person' });
      cache.set(tm1, { $id: tm1, '@type': 'TupleMember', position: 0, variable: qout1 });
      cache.set(outTuple1, { $id: outTuple1, '@type': 'QueryOutputTuple', memberEntries: [tm1] });

      const qin1 = 'urn:qin:person';
      const tm2 = 'urn:tm:2';
      const inTuple1 = 'urn:tuple:in1';
      cache.set(qin1, { $id: qin1, '@type': 'QueryInputVariable', variableName: 'person' });
      cache.set(tm2, { $id: tm2, '@type': 'TupleMember', position: 0, variable: qin1 });
      cache.set(inTuple1, { $id: inTuple1, '@type': 'QueryInputTuple', memberEntries: [tm2] });

      // Second chain: org output from n2 (only org, not person)
      const qout2 = 'urn:qout:org';
      const tm3 = 'urn:tm:3';
      const outTuple2 = 'urn:tuple:out2';
      cache.set(qout2, { $id: qout2, '@type': 'QueryOutputVariable', variableName: 'org' });
      cache.set(tm3, { $id: tm3, '@type': 'TupleMember', position: 0, variable: qout2 });
      cache.set(outTuple2, { $id: outTuple2, '@type': 'QueryOutputTuple', memberEntries: [tm3] });

      // Third chain: org input to n3
      const qin2 = 'urn:qin:org';
      const tm5 = 'urn:tm:5';
      const inTuple2 = 'urn:tuple:in2';
      cache.set(qin2, { $id: qin2, '@type': 'QueryInputVariable', variableName: 'org' });
      cache.set(tm5, { $id: tm5, '@type': 'TupleMember', position: 0, variable: qin2 });
      cache.set(inTuple2, { $id: inTuple2, '@type': 'QueryInputTuple', memberEntries: [tm5] });

      // Output from n3
      const qout4 = 'urn:qout:org2';
      const qout5 = 'urn:qout:name';
      const tm6 = 'urn:tm:6';
      const tm7 = 'urn:tm:7';
      const outTuple3 = 'urn:tuple:out3';
      cache.set(qout4, { $id: qout4, '@type': 'QueryOutputVariable', variableName: 'org' });
      cache.set(qout5, { $id: qout5, '@type': 'QueryOutputVariable', variableName: 'name' });
      cache.set(tm6, { $id: tm6, '@type': 'TupleMember', position: 0, variable: qout4 });
      cache.set(tm7, { $id: tm7, '@type': 'TupleMember', position: 1, variable: qout5 });
      cache.set(outTuple3, { $id: outTuple3, '@type': 'QueryOutputTuple', memberEntries: [tm6, tm7] });

      // EndNode input tuple
      const qin3 = 'urn:qin:org3';
      const qin4 = 'urn:qin:name3';
      const tm8 = 'urn:tm:8';
      const tm9 = 'urn:tm:9';
      // EndNode uses pass-through semantics - no separate endInputTuple needed
      cache.set(qin3, { $id: qin3, '@type': 'QueryInputVariable', variableName: 'org' });
      cache.set(qin4, { $id: qin4, '@type': 'QueryInputVariable', variableName: 'name' });
      cache.set(tm8, { $id: tm8, '@type': 'TupleMember', position: 0, variable: qin3 });
      cache.set(tm9, { $id: tm9, '@type': 'TupleMember', position: 1, variable: qin4 });

      // Query versions
      const qv1 = 'urn:qv:persons';
      const qv2 = 'urn:qv:orgs';
      const qv3 = 'urn:qv:org-details';
      cache.set(qv1, {
        $id: qv1,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?person WHERE { ?person a <http://xmlns.com/foaf/0.1/Person> }',
        queryType: QueryTypeIri.select
      });
      cache.set(qv2, {
        $id: qv2,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?person ?org WHERE { VALUES (?person) { (UNDEF) } ?person <http://example.org/worksAt> ?org }',
        queryType: QueryTypeIri.select
      });
      cache.set(qv3, {
        $id: qv3,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?org ?name WHERE { VALUES (?org) { (UNDEF) } ?org <http://example.org/name> ?name }',
        queryType: QueryTypeIri.select
      });

      // Nodes
      const n1 = 'urn:node:persons';
      const n2 = 'urn:node:orgs';
      const n3 = 'urn:node:org-details';
      const endNode = 'urn:node:end';
      cache.set(n1, {
        $id: n1,
        '@type': 'QueryNode',
        backendId,
        queryId: qv1,
        outputs: [outTuple1]
      });
      cache.set(n2, {
        $id: n2,
        '@type': 'QueryNode',
        backendId,
        queryId: qv2,
        inputs: [inTuple1],
        outputs: [outTuple2]
      });
      cache.set(n3, {
        $id: n3,
        '@type': 'QueryNode',
        backendId,
        queryId: qv3,
        inputs: [inTuple2],
        outputs: [outTuple3]
      });
      cache.set(endNode, {
        $id: endNode,
        '@type': 'EndNode',
        inputs: [outTuple3]
      });

      // Edges
      const e1 = 'urn:edge:1';
      const e2 = 'urn:edge:2';
      const e3 = 'urn:edge:3';
      cache.set(e1, {
        $id: e1,
        '@type': 'QueryEdge',
        sourceNodeId: n1,
        targetNodeId: n2,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple1,
        targetInputId: inTuple1
      });
      cache.set(e2, {
        $id: e2,
        '@type': 'QueryEdge',
        sourceNodeId: n2,
        targetNodeId: n3,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple2,
        targetInputId: inTuple2
      });
      cache.set(e3, {
        $id: e3,
        '@type': 'QueryEdge',
        sourceNodeId: n3,
        targetNodeId: endNode,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple3,
        targetInputId: outTuple3
      });

      const gv = 'urn:qgv:person-org-details';
      cache.set(gv, {
        $id: gv,
        '@type': 'QueryGroupVersion',
        executionNodes: [n1, n2, n3],
        endNode,
        edges: [e1, e2, e3]
      });

      const graph = graphBuilder.buildFromGroupVersionId(gv);
      const result = await executionEngine.execute(graph);

      expect(result).toEqual({
        result: orgDetailsResult,
        resultNodeId: n3
      });

      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledTimes(3);

      // Verify execution order and variable passing
      const firstCall = (mockExecutor.selectQueryParsed as any).mock.calls[0][0];
      expect(firstCall).toContain('?person');
      expect(firstCall).toContain('http://xmlns.com/foaf/0.1/Person');

      const secondCall = (mockExecutor.selectQueryParsed as any).mock.calls[1][0];
      expect(secondCall).toContain('VALUES');
      expect(secondCall).toContain('<http://example.org/Person1>');

      const thirdCall = (mockExecutor.selectQueryParsed as any).mock.calls[2][0];
      expect(thirdCall).toContain('VALUES');
      expect(thirdCall).toContain('<http://example.org/Org1>');
    });
  });

  describe('Mixed query types', () => {
    it('executes ASK -> SELECT chain', async () => {
      const askResult = true;
      const selectResult = {
        head: { vars: ['exists', 'count'] },
        results: {
          bindings: [{
            exists: { type: 'literal', value: 'true', datatype: 'http://www.w3.org/2001/XMLSchema#boolean' },
            count: { type: 'literal', value: '5', datatype: 'http://www.w3.org/2001/XMLSchema#integer' }
          }]
        }
      };

      (mockExecutor.askQuery as any).mockResolvedValue({ result: askResult, duration: 0 });
      (mockExecutor.selectQueryParsed as any).mockResolvedValue({ result: selectResult, duration: 0 });

      // Set up cache
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      // Output from ASK query (boolean using BooleanIO)
      const boolOut = 'urn:bool:out';
      cache.set(boolOut, { $id: boolOut, '@type': 'BooleanIO', ioType: 'output', outputType: 'Boolean' });

      // Input to SELECT query (boolean as input tuple variable)
      const qin1 = 'urn:qin:exists';
      const tm2 = 'urn:tm:2';
      const inTuple = 'urn:tuple:in';
      cache.set(qin1, { $id: qin1, '@type': 'QueryInputVariable', variableName: 'exists' });
      cache.set(tm2, { $id: tm2, '@type': 'TupleMember', position: 0, variable: qin1 });
      cache.set(inTuple, { $id: inTuple, '@type': 'QueryInputTuple', memberEntries: [tm2] });

      // Output from SELECT query
      const qout2 = 'urn:qout:exists2';
      const qout3 = 'urn:qout:count';
      const tm3 = 'urn:tm:3';
      const tm4 = 'urn:tm:4';
      const outTuple2 = 'urn:tuple:out2';
      cache.set(qout2, { $id: qout2, '@type': 'QueryOutputVariable', variableName: 'exists' });
      cache.set(qout3, { $id: qout3, '@type': 'QueryOutputVariable', variableName: 'count' });
      cache.set(tm3, { $id: tm3, '@type': 'TupleMember', position: 0, variable: qout2 });
      cache.set(tm4, { $id: tm4, '@type': 'TupleMember', position: 1, variable: qout3 });
      cache.set(outTuple2, { $id: outTuple2, '@type': 'QueryOutputTuple', memberEntries: [tm3, tm4] });

      // EndNode input tuple
      const qin2 = 'urn:qin:exists3';
      const qin3 = 'urn:qin:count3';
      const tm5 = 'urn:tm:5';
      const tm6 = 'urn:tm:6';
      // EndNode uses pass-through semantics - no separate endInputTuple needed
      cache.set(qin2, { $id: qin2, '@type': 'QueryInputVariable', variableName: 'exists' });
      cache.set(qin3, { $id: qin3, '@type': 'QueryInputVariable', variableName: 'count' });
      cache.set(tm5, { $id: tm5, '@type': 'TupleMember', position: 0, variable: qin2 });
      cache.set(tm6, { $id: tm6, '@type': 'TupleMember', position: 1, variable: qin3 });

      const qv1 = 'urn:qv:check';
      const qv2 = 'urn:qv:count';
      cache.set(qv1, {
        $id: qv1,
        '@type': 'QueryVersion',
        queryString: 'ASK WHERE { ?x a <http://example.org/Entity> }',
        queryType: QueryTypeIri.ask
      });
      cache.set(qv2, {
        $id: qv2,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?exists (COUNT(*) as ?count) WHERE { VALUES (?exists) { (UNDEF) } ?x a <http://example.org/Entity> }',
        queryType: QueryTypeIri.select
      });

      const n1 = 'urn:node:check';
      const n2 = 'urn:node:count';
      const endNode = 'urn:node:end';
      cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1, outputs: [boolOut] });
      cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv2, inputs: [inTuple], outputs: [outTuple2] });
      cache.set(endNode, {
        $id: endNode,
        '@type': 'EndNode',
        inputs: [outTuple2]
      });

      const e1 = 'urn:edge:1';
      const e2 = 'urn:edge:2';
      cache.set(e1, {
        $id: e1,
        '@type': 'QueryEdge',
        sourceNodeId: n1,
        targetNodeId: n2,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: boolOut,
        targetInputId: inTuple
      });
      cache.set(e2, {
        $id: e2,
        '@type': 'QueryEdge',
        sourceNodeId: n2,
        targetNodeId: endNode,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple2,
        targetInputId: outTuple2
      });

      const gv = 'urn:qgv:ask-select';
      cache.set(gv, {
        $id: gv,
        '@type': 'QueryGroupVersion',
        executionNodes: [n1, n2],
        endNode,
        edges: [e1, e2]
      });

      const graph = graphBuilder.buildFromGroupVersionId(gv);
      const result = await executionEngine.execute(graph);

      // Should return result from n2 (the node connected to endNode)
      expect(result).toEqual({
        result: selectResult,
        resultNodeId: n2
      });
      const askCall = (mockExecutor.askQuery as any).mock.calls[0][0];
      expect(askCall).toContain('<http://example.org/Entity>');
      const selectCall = (mockExecutor.selectQueryParsed as any).mock.calls[0][0];
      expect(selectCall).toContain('VALUES');
      // Note: Boolean value substitution not yet implemented, still uses UNDEF placeholder
    });

    it('executes SELECT -> CONSTRUCT chain', async () => {
      const selectResult = {
        head: { vars: ['entity'] },
        results: {
          bindings: [{ entity: { type: 'uri', value: 'http://example.org/Entity1' } }]
        }
      };

      const constructResult = '<http://example.org/Entity1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/ProcessedEntity> .';

      (mockExecutor.selectQueryParsed as any).mockResolvedValue({ result: selectResult, duration: 0 });
      (mockExecutor.constructQueryParsed as any).mockResolvedValue({ result: constructResult, duration: 0 });

      // Set up cache for SELECT -> CONSTRUCT
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const qout1 = 'urn:qout:entity';
      const tm1 = 'urn:tm:1';
      const outTuple = 'urn:tuple:out';
      cache.set(qout1, { $id: qout1, '@type': 'QueryOutputVariable', variableName: 'entity' });
      cache.set(tm1, { $id: tm1, '@type': 'TupleMember', position: 0, variable: qout1 });
      cache.set(outTuple, { $id: outTuple, '@type': 'QueryOutputTuple', memberEntries: [tm1] });

      const qin1 = 'urn:qin:entity';
      const tm2 = 'urn:tm:2';
      const inTuple = 'urn:tuple:in';
      cache.set(qin1, { $id: qin1, '@type': 'QueryInputVariable', variableName: 'entity' });
      cache.set(tm2, { $id: tm2, '@type': 'TupleMember', position: 0, variable: qin1 });
      cache.set(inTuple, { $id: inTuple, '@type': 'QueryInputTuple', memberEntries: [tm2] });

      // RDF output from n2 to endNode
      const rdfOut = 'urn:rdf:out';
      cache.set(rdfOut, { $id: rdfOut, '@type': 'TriplesQuadsIO', mediaType: 'application/n-triples' });

      // EndNode input for RDF
      const rdfIn = 'urn:rdf:in';
      cache.set(rdfIn, { $id: rdfIn, '@type': 'TriplesQuadsIO', mediaType: 'application/n-triples' });

      const qv1 = 'urn:qv:select';
      const qv2 = 'urn:qv:construct';
      cache.set(qv1, {
        $id: qv1,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?entity WHERE { ?entity a <http://example.org/Entity> }',
        queryType: QueryTypeIri.select
      });
      cache.set(qv2, {
        $id: qv2,
        '@type': 'QueryVersion',
        queryString: 'CONSTRUCT { ?entity a <http://example.org/ProcessedEntity> } WHERE { VALUES (?entity) { (UNDEF) } }',
        queryType: QueryTypeIri.construct
      });

      const n1 = 'urn:node:select';
      const n2 = 'urn:node:construct';
      const endNode = 'urn:node:end';
      cache.set(n1, {
        $id: n1,
        '@type': 'QueryNode',
        backendId,
        queryId: qv1,
        outputs: [outTuple]
      });
      cache.set(n2, {
        $id: n2,
        '@type': 'QueryNode',
        backendId,
        queryId: qv2,
        inputs: [inTuple],
        outputs: [rdfOut]
      });
      cache.set(endNode, {
        $id: endNode,
        '@type': 'EndNode',
        inputs: [rdfOut]
      });

      const e1 = 'urn:edge:1';
      const e2 = 'urn:edge:2';
      cache.set(e1, {
        $id: e1,
        '@type': 'QueryEdge',
        sourceNodeId: n1,
        targetNodeId: n2,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple,
        targetInputId: inTuple
      });
      cache.set(e2, {
        $id: e2,
        '@type': 'QueryEdge',
        sourceNodeId: n2,
        targetNodeId: endNode,
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: rdfOut,
        targetInputId: rdfOut
      });

      const gv = 'urn:qgv:select-construct';
      cache.set(gv, {
        $id: gv,
        '@type': 'QueryGroupVersion',
        executionNodes: [n1, n2],
        endNode,
        edges: [e1, e2]
      });

      const graph = graphBuilder.buildFromGroupVersionId(gv);
      const result = await executionEngine.execute(graph);

      expect(result).toEqual({
        result: constructResult,
        resultNodeId: n2
      });

      expect(mockExecutor.selectQueryParsed).toHaveBeenCalledTimes(1);
      expect(mockExecutor.constructQueryParsed).toHaveBeenCalledTimes(1);

      const constructCall = (mockExecutor.constructQueryParsed as any).mock.calls[0][0];
      expect(constructCall).toContain('VALUES');
      expect(constructCall).toContain('<http://example.org/Entity1>');
    });
  });

  describe('Complex scenarios', () => {
    it('handles multi-variable tuple passing', async () => {
      const sourceResult = {
        head: { vars: ['entity', 'type'] },
        results: {
          bindings: [{
            entity: { type: 'uri', value: 'http://example.org/Entity1' },
            type: { type: 'uri', value: 'http://example.org/Type1' }
          }]
        }
      };

      const targetResult = {
        head: { vars: ['entity', 'type', 'label'] },
        results: {
          bindings: [{
            entity: { type: 'uri', value: 'http://example.org/Entity1' },
            type: { type: 'uri', value: 'http://example.org/Type1' },
            label: { type: 'literal', value: 'Entity One' }
          }]
        }
      };

      (mockExecutor.selectQueryParsed as any)
        .mockResolvedValueOnce({ result: sourceResult, duration: 0 })
        .mockResolvedValueOnce({ result: targetResult, duration: 0 });

      // Set up cache for multi-variable tuple
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      // Output tuple with two variables
      const qout1 = 'urn:qout:entity';
      const qout2 = 'urn:qout:type';
      const tm1 = 'urn:tm:1';
      const tm2 = 'urn:tm:2';
      const outTuple = 'urn:tuple:out';
      cache.set(qout1, { $id: qout1, '@type': 'QueryOutputVariable', variableName: 'entity' });
      cache.set(qout2, { $id: qout2, '@type': 'QueryOutputVariable', variableName: 'type' });
      cache.set(tm1, { $id: tm1, '@type': 'TupleMember', position: 0, variable: qout1 });
      cache.set(tm2, { $id: tm2, '@type': 'TupleMember', position: 1, variable: qout2 });
      cache.set(outTuple, { $id: outTuple, '@type': 'QueryOutputTuple', memberEntries: [tm1, tm2] });

      // Input tuple with two variables
      const qin1 = 'urn:qin:entity';
      const qin2 = 'urn:qin:type';
      const tm3 = 'urn:tm:3';
      const tm4 = 'urn:tm:4';
      const inTuple = 'urn:tuple:in';
      cache.set(qin1, { $id: qin1, '@type': 'QueryInputVariable', variableName: 'entity' });
      cache.set(qin2, { $id: qin2, '@type': 'QueryInputVariable', variableName: 'type' });
      cache.set(tm3, { $id: tm3, '@type': 'TupleMember', position: 0, variable: qin1 });
      cache.set(tm4, { $id: tm4, '@type': 'TupleMember', position: 1, variable: qin2 });
      cache.set(inTuple, { $id: inTuple, '@type': 'QueryInputTuple', memberEntries: [tm3, tm4] });

      // Output tuple from n2 (with three variables)
      const qout3 = 'urn:qout:entity2';
      const qout4 = 'urn:qout:type2';
      const qout5 = 'urn:qout:label';
      const tm5 = 'urn:tm:5';
      const tm6 = 'urn:tm:6';
      const tm7 = 'urn:tm:7';
      const outTuple2 = 'urn:tuple:out2';
      cache.set(qout3, { $id: qout3, '@type': 'QueryOutputVariable', variableName: 'entity' });
      cache.set(qout4, { $id: qout4, '@type': 'QueryOutputVariable', variableName: 'type' });
      cache.set(qout5, { $id: qout5, '@type': 'QueryOutputVariable', variableName: 'label' });
      cache.set(tm5, { $id: tm5, '@type': 'TupleMember', position: 0, variable: qout3 });
      cache.set(tm6, { $id: tm6, '@type': 'TupleMember', position: 1, variable: qout4 });
      cache.set(tm7, { $id: tm7, '@type': 'TupleMember', position: 2, variable: qout5 });
      cache.set(outTuple2, { $id: outTuple2, '@type': 'QueryOutputTuple', memberEntries: [tm5, tm6, tm7] });

      // EndNode input tuple (receives the final output from n2)
      const qin3 = 'urn:qin:entity3';
      const qin4 = 'urn:qin:type3';
      const qin5 = 'urn:qin:label3';
      const tm8 = 'urn:tm:8';
      const tm9 = 'urn:tm:9';
      const tm10 = 'urn:tm:10';
      // EndNode uses pass-through semantics - no separate endInputTuple needed
      cache.set(qin3, { $id: qin3, '@type': 'QueryInputVariable', variableName: 'entity' });
      cache.set(qin4, { $id: qin4, '@type': 'QueryInputVariable', variableName: 'type' });
      cache.set(qin5, { $id: qin5, '@type': 'QueryInputVariable', variableName: 'label' });
      cache.set(tm8, { $id: tm8, '@type': 'TupleMember', position: 0, variable: qin3 });
      cache.set(tm9, { $id: tm9, '@type': 'TupleMember', position: 1, variable: qin4 });
      cache.set(tm10, { $id: tm10, '@type': 'TupleMember', position: 2, variable: qin5 });

      const qv1 = 'urn:qv:source';
      const qv2 = 'urn:qv:target';
      cache.set(qv1, {
        $id: qv1,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?entity ?type WHERE { ?entity a ?type }',
        queryType: QueryTypeIri.select
      });
      cache.set(qv2, {
        $id: qv2,
        '@type': 'QueryVersion',
        queryString: 'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> SELECT ?entity ?type ?label WHERE { VALUES (?entity ?type) { (UNDEF UNDEF) } ?entity rdfs:label ?label }',
        queryType: QueryTypeIri.select
      });

      const n1 = 'urn:node:source';
      const n2 = 'urn:node:target';
      const endNode = 'urn:node:end';
      cache.set(n1, {
        $id: n1,
        '@type': 'QueryNode',
        backendId,
        queryId: qv1,
        outputs: [outTuple]
      });
      cache.set(n2, {
        $id: n2,
        '@type': 'QueryNode',
        backendId,
        queryId: qv2,
        inputs: [inTuple],
        outputs: [outTuple2]
      });
      cache.set(endNode, {
        $id: endNode,
        '@type': 'EndNode',
        inputs: [outTuple2]
      });

      const e1 = 'urn:edge:1';
      const e2 = 'urn:edge:2';
      cache.set(e1, {
        $id: e1,
        '@type': 'QueryEdge',
        sourceNodeId: n1,
        targetNodeId: n2,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple,
        targetInputId: inTuple
      });
      cache.set(e2, {
        $id: e2,
        '@type': 'QueryEdge',
        sourceNodeId: n2,
        targetNodeId: endNode,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple2,
        targetInputId: outTuple2
      });

      const gv = 'urn:qgv:multi-var';
      cache.set(gv, {
        $id: gv,
        '@type': 'QueryGroupVersion',
        executionNodes: [n1, n2],
        endNode,
        edges: [e1, e2]
      });

      const graph = graphBuilder.buildFromGroupVersionId(gv);
      const result = await executionEngine.execute(graph);

      expect(result).toEqual({
        result: targetResult,
        resultNodeId: n2
      });

      // Verify both variables are passed in VALUES clause
      const secondCall = (mockExecutor.selectQueryParsed as any).mock.calls[1][0];
      expect(secondCall).toContain('VALUES( ?entity ?type )');
      expect(secondCall).toContain('<http://example.org/Entity1>');
      expect(secondCall).toContain('<http://example.org/Type1>');
    });
  });
});
