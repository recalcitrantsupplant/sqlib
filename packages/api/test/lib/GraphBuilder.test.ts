import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { GraphBuilder } from '../../src/lib/orchestration/GraphBuilder.js';

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  getAll: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.get,
    list: hoisted.list,
    getAll: hoisted.getAll,
  }),
}));

describe('GraphBuilder', () => {
  let graphBuilder: GraphBuilder;
  let cache: Map<string, any>;

  beforeEach(() => {
    graphBuilder = new GraphBuilder();
    cache = new Map<string, any>();

    vi.clearAllMocks();
    hoisted.get.mockImplementation((id: string) => cache.get(id) ?? null);
    hoisted.list.mockImplementation((type: string) =>
      Array.from(cache.values()).filter((entity: any) => entity['@type'] === type)
    );
    hoisted.getAll.mockImplementation(() => Array.from(cache.values()));
  });

  describe('Basic graph building', () => {
    it('builds a simple single-node graph', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, {
        $id: backendId,
        '@type': 'Backend',
        backendType: 'HTTP',
        endpoint: 'http://example.org/sparql'
      });

      const queryVersionId = 'urn:qv:1';
      cache.set(queryVersionId, {
        $id: queryVersionId,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?x WHERE { ?x ?p ?o }',
        queryType: QueryTypeIri.select
      });

      // Create output tuple for QueryNode
      const qout1 = 'urn:qout:x';
      cache.set(qout1, { $id: qout1, '@type': 'QueryOutput', variableName: 'x' });
      const tm1 = 'urn:tm:1';
      cache.set(tm1, { $id: tm1, '@type': 'TupleMember', position: 0, variable: qout1 });
      const outTuple = 'urn:tuple:out';
      cache.set(outTuple, { $id: outTuple, '@type': 'QueryOutputTuple', memberEntries: [tm1] });

      const nodeId = 'urn:node:1';
      cache.set(nodeId, {
        $id: nodeId,
        '@type': 'QueryNode',
        backendId,
        queryId: queryVersionId,
        outputs: [outTuple]
      });

      const startNodeId = 'urn:ui-temp:urn:node:start';
      cache.set(startNodeId, {
        $id: startNodeId,
        '@type': 'StartNode',
        outputs: []
      });

      const endNodeId = 'urn:ui-temp:urn:node:end';
      cache.set(endNodeId, {
        $id: endNodeId,
        '@type': 'EndNode',
        inputs: [outTuple]  // EndNode uses pass-through: same QueryOutputTuple ID
      });

      // Edges: start -> node -> end
      const edge1 = 'urn:edge:start-to-node';
      cache.set(edge1, {
        $id: edge1,
        '@type': 'QueryEdge',
        sourceNodeId: startNodeId,
        targetNodeId: nodeId,
        dataFlowType: 'CONTROL_FLOW'
      });

      const edge2 = 'urn:edge:node-to-end';
      cache.set(edge2, {
        $id: edge2,
        '@type': 'QueryEdge',
        sourceNodeId: nodeId,
        targetNodeId: endNodeId,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple,
        targetInputId: outTuple  // EndNode uses pass-through: same QueryOutputTuple ID
      });

      const groupVersionId = 'urn:qgv:1';
      cache.set(groupVersionId, {
        $id: groupVersionId,
        '@type': 'QueryGroupVersion',
        executionNodes: [startNodeId, nodeId, endNodeId],
        edges: [edge1, edge2]
      });

      const graph = graphBuilder.buildFromGroupVersionId(groupVersionId);

      expect(graph.nodes.size).toBe(3);
      expect(graph.edges).toHaveLength(2);
      expect(graph.startNodeIds).toEqual([startNodeId]);
      expect(graph.endNodeIds).toEqual([endNodeId]);

      const node = graph.nodes.get(nodeId)!;
      expect(node.queryString).toBe('SELECT ?x WHERE { ?x ?p ?o }');
      expect(node.queryType).toBe('https://sparql-query-lib/query-type/select');
    });

    it('builds a two-node chain with edge', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      // Set up output tuple for source node
      const qout1 = 'urn:qout:entity';
      cache.set(qout1, { $id: qout1, '@type': 'QueryOutput', variableName: 'entity' });
      const tm1 = 'urn:tm:1';
      cache.set(tm1, { $id: tm1, '@type': 'TupleMember', position: 0, variable: qout1 });
      const outTuple = 'urn:tuple:out';
      cache.set(outTuple, { $id: outTuple, '@type': 'QueryOutputTuple', memberEntries: [tm1] });

      // Set up input tuple for target node
      const qin1 = 'urn:qin:entity';
      cache.set(qin1, { $id: qin1, '@type': 'QueryInput', variableName: 'entity' });
      const tm2 = 'urn:tm:2';
      cache.set(tm2, { $id: tm2, '@type': 'TupleMember', position: 0, variable: qin1 });
      const inTuple = 'urn:tuple:in';
      cache.set(inTuple, { $id: inTuple, '@type': 'QueryInputTuple', memberEntries: [tm2] });

      // Query versions
      const qv1 = 'urn:qv:1';
      const qv2 = 'urn:qv:2';
      cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }', queryType: QueryTypeIri.select });
      cache.set(qv2, { $id: qv2, '@type': 'QueryVersion', queryString: 'SELECT * WHERE { VALUES (?entity) { (UNDEF) } }', queryType: QueryTypeIri.select });

      // Nodes
      const n1 = 'urn:node:1';
      const n2 = 'urn:node:2';
      cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1, outputs: [outTuple] });
      cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv2, inputs: [inTuple], outputs: [outTuple] });

      // StartNode and EndNode
      const startNodeId = 'urn:ui-temp:urn:node:start';
      cache.set(startNodeId, {
        $id: startNodeId,
        '@type': 'StartNode',
        outputs: []
      });

      const endNodeId = 'urn:ui-temp:urn:node:end';
      cache.set(endNodeId, {
        $id: endNodeId,
        '@type': 'EndNode',
        inputs: [outTuple]  // EndNode uses pass-through: same QueryOutputTuple ID
      });

      // Edges: start -> n1 -> n2 -> end
      const edgeStart = 'urn:edge:start';
      cache.set(edgeStart, {
        $id: edgeStart,
        '@type': 'QueryEdge',
        sourceNodeId: startNodeId,
        targetNodeId: n1,
        dataFlowType: 'CONTROL_FLOW'
      });

      const e1 = 'urn:edge:1';
      cache.set(e1, {
        $id: e1,
        '@type': 'QueryEdge',
        sourceNodeId: n1,
        targetNodeId: n2,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple,
        targetInputId: inTuple
      });

      const edgeEnd = 'urn:edge:end';
      cache.set(edgeEnd, {
        $id: edgeEnd,
        '@type': 'QueryEdge',
        sourceNodeId: n2,
        targetNodeId: endNodeId,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple,
        targetInputId: outTuple  // EndNode uses pass-through: same QueryOutputTuple ID
      });

      const gv = 'urn:qgv:1';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [startNodeId, n1, n2, endNodeId], edges: [edgeStart, e1, edgeEnd] });

      const graph = graphBuilder.buildFromGroupVersionId(gv);

      expect(graph.nodes.size).toBe(4);
      expect(graph.edges).toHaveLength(3);
      expect(graph.startNodeIds).toEqual([startNodeId]);
      expect(graph.endNodeIds).toEqual([endNodeId]);
      expect(graph.incomingEdges.get(n2)).toHaveLength(1);
      expect(graph.outgoingEdges.get(n1)).toHaveLength(1);
    });
  });

  describe('ephemeral materialization flag', () => {
    it('marks nodes that feed downstream RDF consumers', () => {
      const backendId = 'urn:backend:rdf';
      cache.set(backendId, { $id: backendId, '@type': 'Backend', backendType: 'HTTP', endpoint: 'http://example.org' });

      const extractQueryVersion = 'urn:qv:extract';
      cache.set(extractQueryVersion, {
        $id: extractQueryVersion,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?s WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select
      });

      const triplesOutExtract = 'urn:triples:extract';
      cache.set(triplesOutExtract, { $id: triplesOutExtract, '@type': 'TriplesQuadsIO' });
      const triplesInRuleset = 'urn:triples:ruleset-in';
      cache.set(triplesInRuleset, { $id: triplesInRuleset, '@type': 'TriplesQuadsIO' });
      const triplesOutRuleset = 'urn:triples:ruleset-out';
      cache.set(triplesOutRuleset, { $id: triplesOutRuleset, '@type': 'TriplesQuadsIO' });

      const ruleSetVersionId = 'urn:ruleset:version';
      cache.set(ruleSetVersionId, {
        $id: ruleSetVersionId,
        '@type': 'RuleSetVersion',
        isPartOf: 'urn:ruleset',
        version: 1
      });

      const startNodeId = 'urn:node:start';
      cache.set(startNodeId, { $id: startNodeId, '@type': 'StartNode', outputs: [] });
      const endNodeId = 'urn:node:end';
      cache.set(endNodeId, { $id: endNodeId, '@type': 'EndNode', inputs: [triplesOutRuleset] });

      const extractNodeId = 'urn:node:extract';
      cache.set(extractNodeId, {
        $id: extractNodeId,
        '@type': 'QueryNode',
        backendId,
        queryId: extractQueryVersion,
        outputs: [triplesOutExtract],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-extract' }
      });

      const rulesetNodeId = 'urn:node:ruleset';
      cache.set(rulesetNodeId, {
        $id: rulesetNodeId,
        '@type': 'RuleSetNode',
        ruleSetVersion: ruleSetVersionId,
        inputs: [triplesInRuleset],
        outputs: [triplesOutRuleset]
      });

      const edgeStart = 'urn:edge:start-extract';
      cache.set(edgeStart, {
        $id: edgeStart,
        '@type': 'QueryEdge',
        sourceNodeId: startNodeId,
        targetNodeId: extractNodeId,
        dataFlowType: 'CONTROL_FLOW'
      });

      const edgeRdf = 'urn:edge:extract-ruleset';
      cache.set(edgeRdf, {
        $id: edgeRdf,
        '@type': 'QueryEdge',
        sourceNodeId: extractNodeId,
        targetNodeId: rulesetNodeId,
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: triplesOutExtract,
        targetInputId: triplesInRuleset
      });

      const edgeToEnd = 'urn:edge:ruleset-end';
      cache.set(edgeToEnd, {
        $id: edgeToEnd,
        '@type': 'QueryEdge',
        sourceNodeId: rulesetNodeId,
        targetNodeId: endNodeId,
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: triplesOutRuleset,
        targetInputId: triplesOutRuleset
      });

      const groupVersionId = 'urn:qgv:rdf';
      cache.set(groupVersionId, {
        $id: groupVersionId,
        '@type': 'QueryGroupVersion',
        executionNodes: [startNodeId, extractNodeId, rulesetNodeId, endNodeId],
        edges: [edgeStart, edgeRdf, edgeToEnd]
      });

      const graph = graphBuilder.buildFromGroupVersionId(groupVersionId);
      const extractNode = graph.nodes.get(extractNodeId)!;

      expect(extractNode.backendConfig?.type).toBe('ephemeral-oxigraph');
      expect(extractNode.needsEphemeralMaterialization).toBe(true);
    });

    it('skips nodes whose RDF outputs terminate at the End node', () => {
      const backendId = 'urn:backend:end';
      cache.set(backendId, { $id: backendId, '@type': 'Backend', backendType: 'HTTP', endpoint: 'http://example.org' });

      const constructVersionId = 'urn:qv:construct';
      cache.set(constructVersionId, {
        $id: constructVersionId,
        '@type': 'QueryVersion',
        queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.construct
      });

      const triplesOutputId = 'urn:triples:construct';
      cache.set(triplesOutputId, { $id: triplesOutputId, '@type': 'TriplesQuadsIO' });

      const startNodeId = 'urn:node:start2';
      cache.set(startNodeId, { $id: startNodeId, '@type': 'StartNode', outputs: [] });
      const endNodeId = 'urn:node:end2';
      cache.set(endNodeId, { $id: endNodeId, '@type': 'EndNode', inputs: [triplesOutputId] });

      const constructNodeId = 'urn:node:construct';
      cache.set(constructNodeId, {
        $id: constructNodeId,
        '@type': 'QueryNode',
        backendId,
        queryId: constructVersionId,
        outputs: [triplesOutputId],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-construct' }
      });

      const edgeStart = 'urn:edge:start-construct';
      cache.set(edgeStart, {
        $id: edgeStart,
        '@type': 'QueryEdge',
        sourceNodeId: startNodeId,
        targetNodeId: constructNodeId,
        dataFlowType: 'CONTROL_FLOW'
      });

      const edgeToEnd = 'urn:edge:construct-end';
      cache.set(edgeToEnd, {
        $id: edgeToEnd,
        '@type': 'QueryEdge',
        sourceNodeId: constructNodeId,
        targetNodeId: endNodeId,
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: triplesOutputId,
        targetInputId: triplesOutputId
      });

      const groupVersionId = 'urn:qgv:construct';
      cache.set(groupVersionId, {
        $id: groupVersionId,
        '@type': 'QueryGroupVersion',
        executionNodes: [startNodeId, constructNodeId, endNodeId],
        edges: [edgeStart, edgeToEnd]
      });

      const graph = graphBuilder.buildFromGroupVersionId(groupVersionId);
      const constructNode = graph.nodes.get(constructNodeId)!;

      expect(constructNode.backendConfig?.type).toBe('ephemeral-oxigraph');
      expect(constructNode.needsEphemeralMaterialization).toBe(false);
    });
  });

  describe('Graph validation', () => {
    it('throws error for missing QueryGroupVersion', () => {
      expect(() => {
        graphBuilder.buildFromGroupVersionId('urn:nonexistent');
      }).toThrow('QueryGroupVersion not found: urn:nonexistent');
    });

    it('throws error for QueryGroupVersion with no executable nodes', () => {
      const gv = 'urn:qgv:empty';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [], edges: [] });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gv);
      }).toThrow('QueryGroupVersion urn:qgv:empty has no executable QueryNode nodes');
    });

    it('throws error for missing QueryVersion reference', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const nodeId = 'urn:node:1';
      cache.set(nodeId, { 
        $id: nodeId, 
        '@type': 'QueryNode', 
        backendId, 
        queryId: 'urn:nonexistent:qv' 
      });

      const gv = 'urn:qgv:1';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [nodeId], edges: [] });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gv);
      }).toThrow('QueryNode urn:node:1 references missing QueryVersion urn:nonexistent:qv');
    });

    it('detects cycles in the graph', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      // Create a simple cycle: n1 -> n2 -> n1
      const qv1 = 'urn:qv:1';
      const qv2 = 'urn:qv:2';
      cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: 'SELECT ?x WHERE { ?x ?p ?o }', queryType: QueryTypeIri.select });
      cache.set(qv2, { $id: qv2, '@type': 'QueryVersion', queryString: 'SELECT ?y WHERE { ?y ?p ?o }', queryType: QueryTypeIri.select });

      const n1 = 'urn:node:1';
      const n2 = 'urn:node:2';
      cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1 });
      cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv2 });

      const e1 = 'urn:edge:1';
      const e2 = 'urn:edge:2';
      cache.set(e1, { $id: e1, '@type': 'QueryEdge', sourceNodeId: n1, targetNodeId: n2 });
      cache.set(e2, { $id: e2, '@type': 'QueryEdge', sourceNodeId: n2, targetNodeId: n1 });

      const gv = 'urn:qgv:cycle';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n1, n2], edges: [e1, e2] });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gv);
      }).toThrow('Graph validation failed: cycle detected');
    });

    it('rejects VARIABLE_BINDINGS inbound edges on rule-set nodes', () => {
      const backendId = 'urn:backend:bindings';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const queryVersionId = 'urn:qv:bindings';
      cache.set(queryVersionId, {
        $id: queryVersionId,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?x WHERE { ?x ?p ?o }',
        queryType: QueryTypeIri.select,
      });

      const outputVarId = 'urn:var:out';
      const outputMemberId = 'urn:member:out';
      const outputTupleId = 'urn:tuple:out';
      cache.set(outputVarId, { $id: outputVarId, '@type': 'QueryOutputVariable', variableName: 'x' });
      cache.set(outputMemberId, { $id: outputMemberId, '@type': 'TupleMember', position: 0, variable: outputVarId });
      cache.set(outputTupleId, { $id: outputTupleId, '@type': 'QueryOutputTuple', memberEntries: [outputMemberId] });

      const inputVarId = 'urn:var:in';
      const inputMemberId = 'urn:member:in';
      const inputTupleId = 'urn:tuple:in';
      cache.set(inputVarId, { $id: inputVarId, '@type': 'QueryInputVariable', variableName: 'x' });
      cache.set(inputMemberId, { $id: inputMemberId, '@type': 'TupleMember', position: 0, variable: inputVarId });
      cache.set(inputTupleId, { $id: inputTupleId, '@type': 'QueryInputTuple', memberEntries: [inputMemberId] });

      const queryNodeId = 'urn:node:select';
      cache.set(queryNodeId, {
        $id: queryNodeId,
        '@type': 'QueryNode',
        backendId,
        queryId: queryVersionId,
        outputs: [outputTupleId],
      });

      const ruleSetVersionId = 'urn:ruleset:version:bindings';
      cache.set(ruleSetVersionId, {
        $id: ruleSetVersionId,
        '@type': 'RuleSetVersion',
        isPartOf: 'urn:ruleset',
        version: 1,
      });

      const ruleSetNodeId = 'urn:node:ruleset:bindings';
      cache.set(ruleSetNodeId, {
        $id: ruleSetNodeId,
        '@type': 'RuleSetNode',
        ruleSetVersion: ruleSetVersionId,
        inputs: [inputTupleId],
        outputs: [],
      });

      const edgeId = 'urn:edge:bindings';
      cache.set(edgeId, {
        $id: edgeId,
        '@type': 'QueryEdge',
        sourceNodeId: queryNodeId,
        targetNodeId: ruleSetNodeId,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outputTupleId,
        targetInputId: inputTupleId,
      });

      const gvId = 'urn:qgv:ruleset:bindings';
      cache.set(gvId, {
        $id: gvId,
        '@type': 'QueryGroupVersion',
        executionNodes: [queryNodeId, ruleSetNodeId],
        edges: [edgeId],
      });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gvId);
      }).toThrow(`RuleSetNode ${ruleSetNodeId} only accepts RDF_GRAPH or CONTROL_FLOW edges. Invalid inbound edge ${edgeId} (VARIABLE_BINDINGS)`);
    });

    it('rejects VARIABLE_BINDINGS outbound edges on rule-set nodes', () => {
      const ruleSetVersionId = 'urn:ruleset:version:outbound';
      cache.set(ruleSetVersionId, {
        $id: ruleSetVersionId,
        '@type': 'RuleSetVersion',
        isPartOf: 'urn:ruleset',
        version: 1,
      });

      const outputVarId = 'urn:var:ruleset';
      const outputMemberId = 'urn:member:ruleset';
      const outputTupleId = 'urn:tuple:ruleset';
      cache.set(outputVarId, { $id: outputVarId, '@type': 'QueryOutputVariable', variableName: 'x' });
      cache.set(outputMemberId, { $id: outputMemberId, '@type': 'TupleMember', position: 0, variable: outputVarId });
      cache.set(outputTupleId, { $id: outputTupleId, '@type': 'QueryOutputTuple', memberEntries: [outputMemberId] });

      const ruleSetNodeId = 'urn:node:ruleset:outbound';
      cache.set(ruleSetNodeId, {
        $id: ruleSetNodeId,
        '@type': 'RuleSetNode',
        ruleSetVersion: ruleSetVersionId,
        inputs: [],
        outputs: [outputTupleId],
      });

      const endNodeId = 'urn:node:end:ruleset';
      cache.set(endNodeId, { $id: endNodeId, '@type': 'EndNode', inputs: [outputTupleId] });

      const edgeId = 'urn:edge:ruleset:outbound';
      cache.set(edgeId, {
        $id: edgeId,
        '@type': 'QueryEdge',
        sourceNodeId: ruleSetNodeId,
        targetNodeId: endNodeId,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outputTupleId,
        targetInputId: outputTupleId,
      });

      const gvId = 'urn:qgv:ruleset:outbound';
      cache.set(gvId, {
        $id: gvId,
        '@type': 'QueryGroupVersion',
        executionNodes: [ruleSetNodeId, endNodeId],
        edges: [edgeId],
      });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gvId);
      }).toThrow(`RuleSetNode ${ruleSetNodeId} only produces RDF_GRAPH or CONTROL_FLOW edges. Invalid outbound edge ${edgeId} (VARIABLE_BINDINGS)`);
    });
  });

  describe('Edge validation', () => {
    it('throws error for unsupported dataFlowType', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const qv1 = 'urn:qv:1';
      cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: 'SELECT ?x WHERE { ?x ?p ?o }', queryType: QueryTypeIri.select });

      const n1 = 'urn:node:1';
      const n2 = 'urn:node:2';
      cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1 });
      cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv1 });

      const e1 = 'urn:edge:1';
      cache.set(e1, { 
        $id: e1, 
        '@type': 'QueryEdge', 
        sourceNodeId: n1, 
        targetNodeId: n2, 
        dataFlowType: 'RDF_GRAPH' // Unsupported
      });

      const gv = 'urn:qgv:1';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n1, n2], edges: [e1] });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gv);
      }).toThrow('Edge urn:edge:1 with dataFlowType=RDF_GRAPH must specify both sourceOutputId and targetInputId');
    });

    it('throws error for VARIABLE_BINDINGS edge missing tuple IDs', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const qv1 = 'urn:qv:1';
      cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: 'SELECT ?x WHERE { ?x ?p ?o }', queryType: QueryTypeIri.select });

      const n1 = 'urn:node:1';
      const n2 = 'urn:node:2';
      cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1 });
      cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv1 });

      const e1 = 'urn:edge:1';
      cache.set(e1, { 
        $id: e1, 
        '@type': 'QueryEdge', 
        sourceNodeId: n1, 
        targetNodeId: n2, 
        dataFlowType: 'VARIABLE_BINDINGS'
        // Missing sourceOutputId and targetInputId
      });

      const gv = 'urn:qgv:1';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n1, n2], edges: [e1] });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gv);
      }).toThrow('Edge urn:edge:1 with dataFlowType=VARIABLE_BINDINGS must specify both sourceOutputId and targetInputId');
    });

    it('throws error for mismatched tuple dimensions', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      // Source tuple with 2 members
      const qout1 = 'urn:qout:entity';
      const qout2 = 'urn:qout:label';
      cache.set(qout1, { $id: qout1, '@type': 'QueryOutput', variableName: 'entity' });
      cache.set(qout2, { $id: qout2, '@type': 'QueryOutput', variableName: 'label' });
      const tm1 = 'urn:tm:1';
      const tm2 = 'urn:tm:2';
      cache.set(tm1, { $id: tm1, '@type': 'TupleMember', position: 0, variable: qout1 });
      cache.set(tm2, { $id: tm2, '@type': 'TupleMember', position: 1, variable: qout2 });
      const outTuple = 'urn:tuple:out';
      cache.set(outTuple, { $id: outTuple, '@type': 'QueryOutputTuple', memberEntries: [tm1, tm2] });

      // Target tuple with 1 member
      const qin1 = 'urn:qin:entity';
      cache.set(qin1, { $id: qin1, '@type': 'QueryInput', variableName: 'entity' });
      const tm3 = 'urn:tm:3';
      cache.set(tm3, { $id: tm3, '@type': 'TupleMember', position: 0, variable: qin1 });
      const inTuple = 'urn:tuple:in';
      cache.set(inTuple, { $id: inTuple, '@type': 'QueryInputTuple', memberEntries: [tm3] });

      const qv1 = 'urn:qv:1';
      cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: 'SELECT ?entity ?label WHERE { ?entity ?p ?label }', queryType: QueryTypeIri.select });

      const n1 = 'urn:node:1';
      const n2 = 'urn:node:2';
      cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1, outputs: [outTuple] });
      cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv1, inputs: [inTuple] });

      const e1 = 'urn:edge:1';
      cache.set(e1, {
        $id: e1,
        '@type': 'QueryEdge',
        sourceNodeId: n1,
        targetNodeId: n2,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple,
        targetInputId: inTuple
      });

      const gv = 'urn:qgv:1';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n1, n2], edges: [e1] });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gv);
      }).toThrow('Tuple dimensions mismatch on edge urn:edge:1: 2 != 1');
    });

    it('throws error when source query does not export required variables', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      // Output tuple expecting 'entity' and 'label'
      const qout1 = 'urn:qout:entity';
      const qout2 = 'urn:qout:label';
      cache.set(qout1, { $id: qout1, '@type': 'QueryOutput', variableName: 'entity' });
      cache.set(qout2, { $id: qout2, '@type': 'QueryOutput', variableName: 'label' });
      const tm1 = 'urn:tm:1';
      const tm2 = 'urn:tm:2';
      cache.set(tm1, { $id: tm1, '@type': 'TupleMember', position: 0, variable: qout1 });
      cache.set(tm2, { $id: tm2, '@type': 'TupleMember', position: 1, variable: qout2 });
      const outTuple = 'urn:tuple:out';
      cache.set(outTuple, { $id: outTuple, '@type': 'QueryOutputTuple', memberEntries: [tm1, tm2] });

      const qin1 = 'urn:qin:entity';
      const qin2 = 'urn:qin:label';
      cache.set(qin1, { $id: qin1, '@type': 'QueryInput', variableName: 'entity' });
      cache.set(qin2, { $id: qin2, '@type': 'QueryInput', variableName: 'label' });
      const tm3 = 'urn:tm:3';
      const tm4 = 'urn:tm:4';
      cache.set(tm3, { $id: tm3, '@type': 'TupleMember', position: 0, variable: qin1 });
      cache.set(tm4, { $id: tm4, '@type': 'TupleMember', position: 1, variable: qin2 });
      const inTuple = 'urn:tuple:in';
      cache.set(inTuple, { $id: inTuple, '@type': 'QueryInputTuple', memberEntries: [tm3, tm4] });

      // Source query only selects 'entity', not 'label'
      const qv1 = 'urn:qv:1';
      const qv2 = 'urn:qv:2';
      cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }', queryType: QueryTypeIri.select });
      cache.set(qv2, { $id: qv2, '@type': 'QueryVersion', queryString: 'SELECT * WHERE { VALUES (?entity ?label) { (UNDEF UNDEF) } }', queryType: QueryTypeIri.select });

      const n1 = 'urn:node:1';
      const n2 = 'urn:node:2';
      cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1, outputs: [outTuple] });
      cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv2, inputs: [inTuple] });

      const e1 = 'urn:edge:1';
      cache.set(e1, {
        $id: e1,
        '@type': 'QueryEdge',
        sourceNodeId: n1,
        targetNodeId: n2,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple,
        targetInputId: inTuple
      });

      const gv = 'urn:qgv:1';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n1, n2], edges: [e1] });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gv);
      }).toThrow('Source node urn:node:1 does not export variables required by its OutputTuple urn:tuple:out: label');
    });

    it('throws error when target query lacks matching VALUES group', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const qout1 = 'urn:qout:entity';
      cache.set(qout1, { $id: qout1, '@type': 'QueryOutput', variableName: 'entity' });
      const tm1 = 'urn:tm:1';
      cache.set(tm1, { $id: tm1, '@type': 'TupleMember', position: 0, variable: qout1 });
      const outTuple = 'urn:tuple:out';
      cache.set(outTuple, { $id: outTuple, '@type': 'QueryOutputTuple', memberEntries: [tm1] });

      const qin1 = 'urn:qin:entity';
      cache.set(qin1, { $id: qin1, '@type': 'QueryInput', variableName: 'entity' });
      const tm2 = 'urn:tm:2';
      cache.set(tm2, { $id: tm2, '@type': 'TupleMember', position: 0, variable: qin1 });
      const inTuple = 'urn:tuple:in';
      cache.set(inTuple, { $id: inTuple, '@type': 'QueryInputTuple', memberEntries: [tm2] });

      const qv1 = 'urn:qv:1';
      const qv2 = 'urn:qv:2';
      cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }', queryType: QueryTypeIri.select });
      // Target query has no VALUES clause
      cache.set(qv2, { $id: qv2, '@type': 'QueryVersion', queryString: 'SELECT ?entity WHERE { ?entity ?p ?o }', queryType: QueryTypeIri.select });

      const n1 = 'urn:node:1';
      const n2 = 'urn:node:2';
      cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1, outputs: [outTuple] });
      cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv2, inputs: [inTuple] });

      const e1 = 'urn:edge:1';
      cache.set(e1, {
        $id: e1,
        '@type': 'QueryEdge',
        sourceNodeId: n1,
        targetNodeId: n2,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: outTuple,
        targetInputId: inTuple
      });

      const gv = 'urn:qgv:1';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n1, n2], edges: [e1] });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gv);
      }).toThrow('Target node urn:node:2 query does not contain a VALUES group matching InputTuple urn:tuple:in variables in order: [entity]');
    });
  });

  describe('Terminal node validation', () => {
    it('allows ASK queries without outgoing edges', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const qv1 = 'urn:qv:1';
      cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: 'ASK WHERE { ?x ?p ?o }', queryType: QueryTypeIri.ask });

      const n1 = 'urn:node:1';
      cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1 });

      const gv = 'urn:qgv:1';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n1], edges: [] });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gv);
      }).not.toThrow();
    });

    it('throws error for ASK query with outgoing VARIABLE_BINDINGS edge', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const qv1 = 'urn:qv:1';
      const qv2 = 'urn:qv:2';
      cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: 'ASK WHERE { ?x ?p ?o }', queryType: QueryTypeIri.ask });
      cache.set(qv2, { $id: qv2, '@type': 'QueryVersion', queryString: 'SELECT ?x WHERE { ?x ?p ?o }', queryType: QueryTypeIri.select });

      const n1 = 'urn:node:1';
      const n2 = 'urn:node:2';
      cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1 });
      cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv2 });

      const e1 = 'urn:edge:1';
      cache.set(e1, { 
        $id: e1, 
        '@type': 'QueryEdge', 
        sourceNodeId: n1, 
        targetNodeId: n2, 
        dataFlowType: 'VARIABLE_BINDINGS'
      });

      const gv = 'urn:qgv:1';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n1, n2], edges: [e1] });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gv);
      }).toThrow('Edge urn:edge:1 with dataFlowType=VARIABLE_BINDINGS must specify both sourceOutputId and targetInputId');
    });

    it('throws error for CONSTRUCT query with outgoing VARIABLE_BINDINGS edge', () => {
      const backendId = 'urn:backend:test';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const qv1 = 'urn:qv:1';
      const qv2 = 'urn:qv:2';
      cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: 'CONSTRUCT { ?x ?p ?o } WHERE { ?x ?p ?o }', queryType: QueryTypeIri.construct });
      cache.set(qv2, { $id: qv2, '@type': 'QueryVersion', queryString: 'SELECT ?x WHERE { ?x ?p ?o }', queryType: QueryTypeIri.select });

      const n1 = 'urn:node:1';
      const n2 = 'urn:node:2';
      cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1 });
      cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv2 });

      const e1 = 'urn:edge:1';
      cache.set(e1, { 
        $id: e1, 
        '@type': 'QueryEdge', 
        sourceNodeId: n1, 
        targetNodeId: n2, 
        dataFlowType: 'VARIABLE_BINDINGS'
      });

      const gv = 'urn:qgv:1';
      cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n1, n2], edges: [e1] });

      expect(() => {
        graphBuilder.buildFromGroupVersionId(gv);
      }).toThrow('Edge urn:edge:1 with dataFlowType=VARIABLE_BINDINGS must specify both sourceOutputId and targetInputId');
    });
  });

  describe('specialised edge types', () => {
    it('supports BOOLEAN edges between nodes', () => {
      const backendId = 'urn:backend:boolean';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const booleanOutputId = 'urn:boolean:out';
      const booleanInputId = 'urn:boolean:in';
      cache.set(booleanOutputId, { $id: booleanOutputId, '@type': 'BooleanIO' });
      cache.set(booleanInputId, { $id: booleanInputId, '@type': 'BooleanIO' });

      const askQueryVersionId = 'urn:qv:ask';
      cache.set(askQueryVersionId, {
        $id: askQueryVersionId,
        '@type': 'QueryVersion',
        queryString: 'ASK { ?s ?p ?o }',
        queryType: QueryTypeIri.ask,
      });

      const selectQueryVersionId = 'urn:qv:select';
      cache.set(selectQueryVersionId, {
        $id: selectQueryVersionId,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?flag WHERE { VALUES (?flag) { (UNDEF) } }',
        queryType: QueryTypeIri.select,
      });

      const outputVariableId = 'urn:var:flag';
      cache.set(outputVariableId, { $id: outputVariableId, '@type': 'QueryOutput', variableName: 'flag' });
      const outputTupleMemberId = 'urn:tuple:member:flag';
      cache.set(outputTupleMemberId, { $id: outputTupleMemberId, '@type': 'TupleMember', position: 0, variable: outputVariableId });
      const resultTupleId = 'urn:tuple:result';
      cache.set(resultTupleId, { $id: resultTupleId, '@type': 'QueryOutputTuple', memberEntries: [outputTupleMemberId] });

      const askNodeId = 'urn:node:ask';
      cache.set(askNodeId, {
        $id: askNodeId,
        '@type': 'QueryNode',
        backendId,
        queryId: askQueryVersionId,
        outputs: [booleanOutputId],
      });

      const selectNodeId = 'urn:node:select';
      cache.set(selectNodeId, {
        $id: selectNodeId,
        '@type': 'QueryNode',
        backendId,
        queryId: selectQueryVersionId,
        inputs: [booleanInputId],
        outputs: [resultTupleId],
      });

      const startNodeId = 'urn:node:start:boolean';
      cache.set(startNodeId, {
        $id: startNodeId,
        '@type': 'StartNode',
        outputs: [],
      });

      const endNodeId = 'urn:node:end:boolean';
      cache.set(endNodeId, {
        $id: endNodeId,
        '@type': 'EndNode',
        inputs: [resultTupleId],
      });

      const edgeStart = 'urn:edge:start:boolean';
      const edgeBoolean = 'urn:edge:boolean';
      const edgeEnd = 'urn:edge:end:boolean';

      cache.set(edgeStart, {
        $id: edgeStart,
        '@type': 'QueryEdge',
        sourceNodeId: startNodeId,
        targetNodeId: askNodeId,
        dataFlowType: 'CONTROL_FLOW',
      });

      cache.set(edgeBoolean, {
        $id: edgeBoolean,
        '@type': 'QueryEdge',
        sourceNodeId: askNodeId,
        targetNodeId: selectNodeId,
        dataFlowType: 'BOOLEAN',
        sourceOutputId: booleanOutputId,
        targetInputId: booleanInputId,
      });

      cache.set(edgeEnd, {
        $id: edgeEnd,
        '@type': 'QueryEdge',
        sourceNodeId: selectNodeId,
        targetNodeId: endNodeId,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: resultTupleId,
        targetInputId: resultTupleId,
      });

      const qgvId = 'urn:qgv:boolean';
      cache.set(qgvId, {
        $id: qgvId,
        '@type': 'QueryGroupVersion',
        executionNodes: [startNodeId, askNodeId, selectNodeId, endNodeId],
        edges: [edgeStart, edgeBoolean, edgeEnd],
      });

      const graph = graphBuilder.buildFromGroupVersionId(qgvId);
      expect(graph.edges.find((edge) => edge.id === edgeBoolean)?.dataFlowType).toBe('BOOLEAN');
    });

    it('supports QUERY_ID edges targeting DynamicQueryNode', () => {
      const backendId = 'urn:backend:dynamic';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });

      const outputVarId = 'urn:var:queryId';
      cache.set(outputVarId, { $id: outputVarId, '@type': 'QueryOutput', variableName: 'queryId' });
      const tupleMemberId = 'urn:tuple:member:queryId';
      cache.set(tupleMemberId, { $id: tupleMemberId, '@type': 'TupleMember', position: 0, variable: outputVarId });
      const queryIdTupleId = 'urn:tuple:queryId';
      cache.set(queryIdTupleId, { $id: queryIdTupleId, '@type': 'QueryOutputTuple', memberEntries: [tupleMemberId] });

      const queryIdInputId = 'urn:queryid:input';
      cache.set(queryIdInputId, { $id: queryIdInputId, '@type': 'QueryIdInput' });

      const selectQueryVersionId = 'urn:qv:dispatcher';
      cache.set(selectQueryVersionId, {
        $id: selectQueryVersionId,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?queryId WHERE { VALUES (?queryId) {(<urn:sqlib:query:foo>)} }',
        queryType: QueryTypeIri.select,
      });

      const dynamicQueryVersionId = 'urn:qv:dynamic';
      cache.set(dynamicQueryVersionId, {
        $id: dynamicQueryVersionId,
        '@type': 'QueryVersion',
        queryString: 'SELECT ?s WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
      });

      const selectorNodeId = 'urn:node:selector';
      cache.set(selectorNodeId, {
        $id: selectorNodeId,
        '@type': 'QueryNode',
        backendId,
        queryId: selectQueryVersionId,
        outputs: [queryIdTupleId],
      });

      // The dynamic node saves a result tuple so the EndNode has something
      // to return; an EndNode fed only by control flow is rejected outright.
      const dynamicOutVarId = 'urn:var:dynamic:s';
      cache.set(dynamicOutVarId, { $id: dynamicOutVarId, '@type': 'QueryOutput', variableName: 's' });
      const dynamicOutMemberId = 'urn:tuple:member:dynamic:s';
      cache.set(dynamicOutMemberId, { $id: dynamicOutMemberId, '@type': 'TupleMember', position: 0, variable: dynamicOutVarId });
      const dynamicOutTupleId = 'urn:tuple:dynamic:s';
      cache.set(dynamicOutTupleId, { $id: dynamicOutTupleId, '@type': 'QueryOutputTuple', memberEntries: [dynamicOutMemberId] });

      const dynamicNodeId = 'urn:node:dynamic';
      cache.set(dynamicNodeId, {
        $id: dynamicNodeId,
        '@type': 'DynamicQueryNode',
        backendId,
        queryId: dynamicQueryVersionId,
        inputs: [queryIdInputId],
        outputs: [dynamicOutTupleId],
      });

      const startNodeId = 'urn:node:start:dynamic';
      cache.set(startNodeId, {
        $id: startNodeId,
        '@type': 'StartNode',
        outputs: [],
      });

      const endNodeId = 'urn:node:end:dynamic';
      cache.set(endNodeId, {
        $id: endNodeId,
        '@type': 'EndNode',
        inputs: [dynamicOutTupleId],
      });

      const edgeStart = 'urn:edge:start:dynamic';
      const edgeQueryId = 'urn:edge:queryId';
      const edgeEnd = 'urn:edge:end:dynamic';

      cache.set(edgeStart, {
        $id: edgeStart,
        '@type': 'QueryEdge',
        sourceNodeId: startNodeId,
        targetNodeId: selectorNodeId,
        dataFlowType: 'CONTROL_FLOW',
      });

      cache.set(edgeQueryId, {
        $id: edgeQueryId,
        '@type': 'QueryEdge',
        sourceNodeId: selectorNodeId,
        targetNodeId: dynamicNodeId,
        dataFlowType: 'QUERY_ID',
        sourceOutputId: queryIdTupleId,
        targetInputId: queryIdInputId,
      });

      cache.set(edgeEnd, {
        $id: edgeEnd,
        '@type': 'QueryEdge',
        sourceNodeId: dynamicNodeId,
        targetNodeId: endNodeId,
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: dynamicOutTupleId,
        targetInputId: dynamicOutTupleId,
      });

      const qgvId = 'urn:qgv:dynamic';
      cache.set(qgvId, {
        $id: qgvId,
        '@type': 'QueryGroupVersion',
        executionNodes: [startNodeId, selectorNodeId, dynamicNodeId, endNodeId],
        edges: [edgeStart, edgeQueryId, edgeEnd],
      });

      const graph = graphBuilder.buildFromGroupVersionId(qgvId);
      expect(graph.edges.find((edge) => edge.id === edgeQueryId)?.dataFlowType).toBe('QUERY_ID');
      expect(graph.nodes.get(dynamicNodeId)?.raw['@type']).toBe('DynamicQueryNode');
    });
  });

  describe('structured validation errors', () => {
    /** A 1-variable output tuple whose member/variable entities are registered. */
    const registerOutputTuple = (prefix: string, varName: string) => {
      cache.set(`${prefix}-var`, { $id: `${prefix}-var`, '@type': 'QueryOutput', variableName: varName });
      cache.set(`${prefix}-member`, { $id: `${prefix}-member`, '@type': 'TupleMember', position: 0, variable: `${prefix}-var` });
      cache.set(prefix, { $id: prefix, '@type': 'QueryOutputTuple', memberEntries: [`${prefix}-member`] });
      return prefix;
    };

    /**
     * Producer nodes all feeding the EndNode, so the graph has the multi-predecessor
     * shape the engine can only merge when every input is RDF. RDF producers wire up
     * as CONSTRUCT/DESCRIBE over TriplesQuadsIO ports (a CONSTRUCT may not emit
     * VARIABLE_BINDINGS); binding producers wire up as SELECT over output tuples.
     */
    const buildFanInGroup = (producers: Array<{ id: string; rdf?: boolean; nodeType?: string }>) => {
      cache.set('urn:backend:fanin', { $id: 'urn:backend:fanin', '@type': 'Backend' });
      const startNodeId = 'urn:node:fanin-start';
      const endNodeId = 'urn:node:fanin-end';
      const edges: string[] = [];
      const nodes: string[] = [startNodeId, endNodeId];
      const endInputs: string[] = [];

      producers.forEach((producer, index) => {
        let port: string;
        if (producer.rdf) {
          port = `urn:rdfio:fanin-${index}`;
          cache.set(port, { $id: port, '@type': 'TriplesQuadsIO' });
        } else {
          port = registerOutputTuple(`urn:tuple:fanin-${index}`, `v${index}`);
        }
        endInputs.push(port);

        const queryVersionId = `urn:qv:fanin-${index}`;
        cache.set(queryVersionId, {
          $id: queryVersionId, '@type': 'QueryVersion',
          queryString: producer.rdf
            ? `CONSTRUCT { ?v${index} ?p ?o } WHERE { ?v${index} ?p ?o }`
            : `SELECT ?v${index} WHERE { ?v${index} ?p ?o }`,
          queryType: producer.rdf ? QueryTypeIri.construct : QueryTypeIri.select,
        });
        cache.set(producer.id, {
          $id: producer.id,
          '@type': producer.nodeType ?? 'QueryNode',
          backendId: 'urn:backend:fanin',
          queryId: queryVersionId,
          outputs: [port],
        });
        nodes.push(producer.id);

        const controlEdge = `urn:edge:fanin-start-${index}`;
        cache.set(controlEdge, {
          $id: controlEdge, '@type': 'QueryEdge',
          sourceNodeId: startNodeId, targetNodeId: producer.id, dataFlowType: 'CONTROL_FLOW',
        });
        const dataEdge = `urn:edge:fanin-end-${index}`;
        cache.set(dataEdge, {
          $id: dataEdge, '@type': 'QueryEdge',
          sourceNodeId: producer.id, targetNodeId: endNodeId,
          dataFlowType: producer.rdf ? 'RDF_GRAPH' : 'VARIABLE_BINDINGS',
          sourceOutputId: port, targetInputId: port,
        });
        edges.push(controlEdge, dataEdge);
      });

      cache.set(startNodeId, { $id: startNodeId, '@type': 'StartNode', outputs: [] });
      cache.set(endNodeId, { $id: endNodeId, '@type': 'EndNode', inputs: endInputs });
      const qgvId = 'urn:qgv:fanin';
      cache.set(qgvId, { $id: qgvId, '@type': 'QueryGroupVersion', executionNodes: nodes, edges });
      return qgvId;
    };

    it('rejects a multi-input EndNode whose inputs are not all RDF', () => {
      // The engine can only concatenate RDF strings; anything else hits an explicit
      // "not yet implemented" throw at execution. Validation must predict that, or
      // the canvas shows a valid graph that then dies at run time.
      const qgvId = buildFanInGroup([
        { id: 'urn:node:fanin-a' },
        { id: 'urn:node:fanin-b' },
      ]);

      let thrown: any;
      try {
        graphBuilder.buildFromGroupVersionId(qgvId);
      } catch (error) {
        thrown = error;
      }

      expect(thrown?.name).toBe('GraphValidationError');
      expect(thrown.code).toBe('END_NODE_MIXED_RESULT_TYPES');
      expect(thrown.entityType).toBe('node');
      expect(thrown.entityId).toBe('urn:node:fanin-a');
      expect(thrown.message).toContain('produces bindings');
    });

    it('allows a multi-input EndNode when every input is RDF', () => {
      const qgvId = buildFanInGroup([
        { id: 'urn:node:fanin-a', rdf: true },
        { id: 'urn:node:fanin-b', rdf: true },
      ]);
      expect(() => graphBuilder.buildFromGroupVersionId(qgvId)).not.toThrow();
    });

    it('allows a single non-RDF input to EndNode', () => {
      const qgvId = buildFanInGroup([{ id: 'urn:node:fanin-a' }]);
      expect(() => graphBuilder.buildFromGroupVersionId(qgvId)).not.toThrow();
    });

    it('does not statically reject nodes whose result shape is chosen at runtime', () => {
      // A DynamicQueryNode picks its query via QUERY_ID and a DuckDbEtlNode's output
      // depends on its job, so neither can be proven non-RDF here. Rejecting them
      // would be a false positive; the engine still guards at execution time.
      const qgvId = buildFanInGroup([
        { id: 'urn:node:fanin-a', rdf: true },
        { id: 'urn:node:fanin-b', nodeType: 'DynamicQueryNode' },
      ]);
      expect(() => graphBuilder.buildFromGroupVersionId(qgvId)).not.toThrow();
    });

    it('carries a code and the offending entity id without parsing the message', () => {
      // Regression guard for the old regex-scraping in GET /validate: the entity is
      // reported by the error itself, so it stays correct if wording changes.
      const backendId = 'urn:backend:codes';
      cache.set(backendId, { $id: backendId, '@type': 'Backend' });
      const queryVersionId = 'urn:qv:codes';
      cache.set(queryVersionId, {
        $id: queryVersionId, '@type': 'QueryVersion',
        queryString: 'SELECT ?x WHERE { ?x ?p ?o }', queryType: QueryTypeIri.select,
      });
      const tuple = registerOutputTuple('urn:tuple:codes', 'x');
      const nodeId = 'urn:node:codes';
      cache.set(nodeId, { $id: nodeId, '@type': 'QueryNode', backendId, queryId: queryVersionId, outputs: [tuple] });
      const endNodeId = 'urn:node:codes-end';
      cache.set(endNodeId, { $id: endNodeId, '@type': 'EndNode', inputs: [tuple] });

      // A CONTROL_FLOW edge is not allowed to carry I/O references.
      const badEdge = 'urn:edge:codes-bad';
      cache.set(badEdge, {
        $id: badEdge, '@type': 'QueryEdge',
        sourceNodeId: nodeId, targetNodeId: endNodeId,
        dataFlowType: 'CONTROL_FLOW', sourceOutputId: tuple, targetInputId: tuple,
      });
      const qgvId = 'urn:qgv:codes';
      cache.set(qgvId, {
        $id: qgvId, '@type': 'QueryGroupVersion',
        executionNodes: [nodeId, endNodeId], edges: [badEdge],
      });

      let thrown: any;
      try {
        graphBuilder.buildFromGroupVersionId(qgvId);
      } catch (error) {
        thrown = error;
      }

      expect(thrown.code).toBe('EDGE_CONTROL_FLOW_HAS_IO');
      expect(thrown.entityType).toBe('edge');
      expect(thrown.entityId).toBe(badEdge);
    });
  });
  /**
   * A start node's data graph inputs — the RDF half of what a group declares.
   *
   * The rule the existing RDF cases state ("a SPARQL node only sees upstream
   * RDF through an ephemeral store") still holds, but a start node has no store
   * of its own to share: the graph is loaded into the *target's* store instead,
   * so the check has to look at the other end of the edge.
   */
  describe('start node data graph inputs', () => {
    const ruleSetVersionId = 'urn:ruleset:version:dg';
    const dataPort = 'urn:triples:start-data';
    const rulesIn = 'urn:triples:rules-in-dg';
    const rulesOut = 'urn:triples:rules-out-dg';
    const startNodeId = 'urn:node:start:dg';
    const endNodeId = 'urn:node:end:dg';

    const seedCommon = () => {
      cache.set(ruleSetVersionId, { $id: ruleSetVersionId, '@type': 'RuleSetVersion', isPartOf: 'urn:ruleset', version: 1 });
      cache.set(dataPort, { $id: dataPort, '@type': 'TriplesQuadsIO', name: 'source data' });
      cache.set(rulesIn, { $id: rulesIn, '@type': 'TriplesQuadsIO' });
      cache.set(rulesOut, { $id: rulesOut, '@type': 'TriplesQuadsIO' });
      cache.set(startNodeId, { $id: startNodeId, '@type': 'StartNode', outputs: [dataPort] });
      cache.set(endNodeId, { $id: endNodeId, '@type': 'EndNode', inputs: [rulesOut] });
    };

    it('accepts a data graph the start node hands to a rule set', () => {
      seedCommon();
      const rulesNodeId = 'urn:node:rules:dg';
      cache.set(rulesNodeId, {
        $id: rulesNodeId, '@type': 'RuleSetNode', ruleSetVersion: ruleSetVersionId,
        inputs: [rulesIn], outputs: [rulesOut],
      });
      const edgeIn = 'urn:edge:start-rules:dg';
      cache.set(edgeIn, {
        $id: edgeIn, '@type': 'QueryEdge', sourceNodeId: startNodeId, targetNodeId: rulesNodeId,
        dataFlowType: 'RDF_GRAPH', sourceOutputId: dataPort, targetInputId: rulesIn,
      });
      const edgeOut = 'urn:edge:rules-end:dg';
      cache.set(edgeOut, {
        $id: edgeOut, '@type': 'QueryEdge', sourceNodeId: rulesNodeId, targetNodeId: endNodeId,
        dataFlowType: 'RDF_GRAPH', sourceOutputId: rulesOut, targetInputId: rulesOut,
      });
      const gv = 'urn:qgv:start-data-graph';
      cache.set(gv, {
        $id: gv, '@type': 'QueryGroupVersion',
        executionNodes: [startNodeId, rulesNodeId, endNodeId], edges: [edgeIn, edgeOut],
      });

      const graph = graphBuilder.buildFromGroupVersionId(gv);

      expect(graph.startNodeIds).toEqual([startNodeId]);
      expect(graph.outgoingEdges.get(startNodeId)?.[0].dataFlowType).toBe('RDF_GRAPH');
    });

    it('accepts a data graph sent to a SPARQL node that has a store to load it into', () => {
      seedCommon();
      const backendId = 'urn:backend:dg';
      cache.set(backendId, { $id: backendId, '@type': 'Backend', backendType: 'HTTP', endpoint: 'http://example.org' });
      const queryVersionId = 'urn:qv:dg';
      cache.set(queryVersionId, {
        $id: queryVersionId, '@type': 'QueryVersion',
        queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', queryType: QueryTypeIri.construct,
      });
      const queryIn = 'urn:triples:query-in-dg';
      cache.set(queryIn, { $id: queryIn, '@type': 'TriplesQuadsIO' });
      const queryOut = 'urn:triples:query-out-dg';
      cache.set(queryOut, { $id: queryOut, '@type': 'TriplesQuadsIO' });
      cache.set(endNodeId, { $id: endNodeId, '@type': 'EndNode', inputs: [queryOut] });

      const queryNodeId = 'urn:node:query:dg';
      cache.set(queryNodeId, {
        $id: queryNodeId, '@type': 'QueryNode', backendId, queryId: queryVersionId,
        inputs: [queryIn], outputs: [queryOut],
        backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-dg' },
      });
      const edgeIn = 'urn:edge:start-query:dg';
      cache.set(edgeIn, {
        $id: edgeIn, '@type': 'QueryEdge', sourceNodeId: startNodeId, targetNodeId: queryNodeId,
        dataFlowType: 'RDF_GRAPH', sourceOutputId: dataPort, targetInputId: queryIn,
      });
      const edgeOut = 'urn:edge:query-end:dg';
      cache.set(edgeOut, {
        $id: edgeOut, '@type': 'QueryEdge', sourceNodeId: queryNodeId, targetNodeId: endNodeId,
        dataFlowType: 'RDF_GRAPH', sourceOutputId: queryOut, targetInputId: queryOut,
      });
      const gv = 'urn:qgv:start-data-graph-query';
      cache.set(gv, {
        $id: gv, '@type': 'QueryGroupVersion',
        executionNodes: [startNodeId, queryNodeId, endNodeId], edges: [edgeIn, edgeOut],
      });

      expect(() => graphBuilder.buildFromGroupVersionId(gv)).not.toThrow();
    });

    it('refuses a data graph sent to a SPARQL node with nowhere to put it', () => {
      seedCommon();
      const backendId = 'urn:backend:dg2';
      cache.set(backendId, { $id: backendId, '@type': 'Backend', backendType: 'HTTP', endpoint: 'http://example.org' });
      const queryVersionId = 'urn:qv:dg2';
      cache.set(queryVersionId, {
        $id: queryVersionId, '@type': 'QueryVersion',
        queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', queryType: QueryTypeIri.construct,
      });
      const queryIn = 'urn:triples:query-in-dg2';
      cache.set(queryIn, { $id: queryIn, '@type': 'TriplesQuadsIO' });
      const queryOut = 'urn:triples:query-out-dg2';
      cache.set(queryOut, { $id: queryOut, '@type': 'TriplesQuadsIO' });
      cache.set(endNodeId, { $id: endNodeId, '@type': 'EndNode', inputs: [queryOut] });

      const queryNodeId = 'urn:node:query:dg2';
      cache.set(queryNodeId, {
        $id: queryNodeId, '@type': 'QueryNode', backendId, queryId: queryVersionId,
        inputs: [queryIn], outputs: [queryOut],
      });
      const edgeIn = 'urn:edge:start-query:dg2';
      cache.set(edgeIn, {
        $id: edgeIn, '@type': 'QueryEdge', sourceNodeId: startNodeId, targetNodeId: queryNodeId,
        dataFlowType: 'RDF_GRAPH', sourceOutputId: dataPort, targetInputId: queryIn,
      });
      const edgeOut = 'urn:edge:query-end:dg2';
      cache.set(edgeOut, {
        $id: edgeOut, '@type': 'QueryEdge', sourceNodeId: queryNodeId, targetNodeId: endNodeId,
        dataFlowType: 'RDF_GRAPH', sourceOutputId: queryOut, targetInputId: queryOut,
      });
      const gv = 'urn:qgv:start-data-graph-inert';
      cache.set(gv, {
        $id: gv, '@type': 'QueryGroupVersion',
        executionNodes: [startNodeId, queryNodeId, endNodeId], edges: [edgeIn, edgeOut],
      });

      let thrown: { code?: string; message?: string } | undefined;
      try {
        graphBuilder.buildFromGroupVersionId(gv);
      } catch (error) {
        thrown = error as { code?: string; message?: string };
      }

      expect(thrown?.code).toBe('EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME');
      expect(thrown?.message).toMatch(/start node data graph/);
    });
  });
});
