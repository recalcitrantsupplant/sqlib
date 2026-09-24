import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryTypeIri } from '../src/constants/queryTypes.js';
import { GraphBuilder } from '../src/lib/orchestration/GraphBuilder.js';
import { ExecutionEngine } from '../src/lib/orchestration/ExecutionEngine.js';
import type { ISparqlExecutor, SparqlExecutionResult } from '../src/server/ISparqlExecutor.js';
import type { ResolvedNode } from '../src/lib/orchestration/types.js';
import { BackendTypeIri } from '../src/persistence/schemas/BackendSchema.js';
import { overrideCacheCoordinatorProvider } from '../src/lib/CacheCoordinatorProvider.js';

const HTTP_BACKEND_TYPE = BackendTypeIri.http;

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

// Mock executor that records last query
class MockExecutor implements ISparqlExecutor {
  public lastQuery: string | undefined;
  constructor(private result: any) {}
  async selectQueryParsed(query: string): Promise<SparqlExecutionResult<any>> { this.lastQuery = query; return { result: this.result, duration: 0 }; }
  async constructQueryParsed(query: string): Promise<SparqlExecutionResult<string>> { this.lastQuery = query; return { result: '@prefix : <#> .', duration: 0 }; }
  async selectQueryStream(): Promise<any> { throw new Error('not used'); }
  async constructQueryStream(): Promise<any> { throw new Error('not used'); }
  async update(): Promise<SparqlExecutionResult<void>> { throw new Error('not used'); }
  async askQuery(query: string): Promise<SparqlExecutionResult<boolean>> { this.lastQuery = query; return { result: true, duration: 0 }; }
}

class TestExecutorFactory {
  private nodeExec = new Map<string, MockExecutor>();
  set(node: ResolvedNode, exec: MockExecutor) { this.nodeExec.set(node.id, exec); }
  getExecutorForNode(node: ResolvedNode): ISparqlExecutor {
    const exec = this.nodeExec.get(node.id);
    if (!exec) throw new Error(`Missing mock executor for node ${node.id}`);
    return exec;
  }
}

describe('DAG orchestration minimal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies initial arguments to a start node with VALUES', async () => {
    const cache = new Map<string, any>();
    hoisted.get.mockImplementation((id: string) => cache.get(id) ?? null);
    hoisted.list.mockImplementation((type: string) =>
      Array.from(cache.values()).filter((entity: any) => entity['@type'] === type)
    );
    hoisted.getAll.mockImplementation(() => Array.from(cache.values()));

    const backendId = 'urn:backend:test:init';
    cache.set(backendId, { $id: backendId, '@type': 'Backend', backendType: HTTP_BACKEND_TYPE, endpoint: 'http://example.invalid/sparql' });

    // Inputs and tuple
    const qin1 = 'urn:qin:entity2';
    const qin2 = 'urn:qin:name2';
    cache.set(qin1, { $id: qin1, '@type': 'QueryInput', variableName: 'entity' });
    cache.set(qin2, { $id: qin2, '@type': 'QueryInput', variableName: 'name' });
    const tim1 = 'urn:tim:0:init';
    const tim2 = 'urn:tim:1:init';
    cache.set(tim1, { $id: tim1, '@type': 'TupleMember', position: 0, variable: qin1 });
    cache.set(tim2, { $id: tim2, '@type': 'TupleMember', position: 1, variable: qin2 });
    const inTuple = 'urn:tuple:in:init';
    cache.set(inTuple, { $id: inTuple, '@type': 'QueryInputTuple', memberEntries: [tim1, tim2] });

    // Outputs for the query node
    const qout1 = 'urn:qout:entity:init';
    const qout2 = 'urn:qout:name:init';
    cache.set(qout1, { $id: qout1, '@type': 'QueryOutput', variableName: 'entity' });
    cache.set(qout2, { $id: qout2, '@type': 'QueryOutput', variableName: 'name' });
    const tom1 = 'urn:tom:0:init';
    const tom2 = 'urn:tom:1:init';
    cache.set(tom1, { $id: tom1, '@type': 'TupleMember', position: 0, variable: qout1 });
    cache.set(tom2, { $id: tom2, '@type': 'TupleMember', position: 1, variable: qout2 });
    const outTuple = 'urn:tuple:out:init';
    cache.set(outTuple, { $id: outTuple, '@type': 'QueryOutputTuple', memberEntries: [tom1, tom2] });

    const tgtQuery = 'SELECT ?entity ?name WHERE { VALUES (?entity ?name) { (UNDEF UNDEF) } }';
    const qv = 'urn:qv:init';
    cache.set(qv, { $id: qv, '@type': 'QueryVersion', queryString: tgtQuery, queryType: QueryTypeIri.select });

    const n = 'urn:node:init';
    const nEnd = 'urn:node:end:init';
    cache.set(n, { $id: n, '@type': 'QueryNode', backendId, queryId: qv, inputs: [inTuple], outputs: [outTuple] });
    cache.set(nEnd, { $id: nEnd, '@type': 'EndNode', inputs: [outTuple] });

    const e1 = 'urn:edge:init';
    cache.set(e1, { $id: e1, '@type': 'QueryEdge', sourceNodeId: n, targetNodeId: nEnd, dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: outTuple, targetInputId: outTuple });

    const gv = 'urn:qgv:init';
    cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n, nEnd], edges: [e1] });

    const gb = new GraphBuilder();
    const graph = gb.buildFromGroupVersionId(gv);

    const factory = new TestExecutorFactory() as any;
    const engine = new ExecutionEngine(factory);
    const rn = graph.nodes.get(n)!;
    const exec = new MockExecutor({ head: { vars: [] }, results: { bindings: [] } });
    factory.set(rn, exec);

    const initialArgs = [{
      head: { vars: ['entity', 'name'] },
      arguments: { bindings: [
        { entity: { type: 'uri', value: 'urn:seed' }, name: { type: 'literal', value: 'Seed' } }
      ] }
    }];

    await engine.execute(graph, initialArgs as any);
    const q = exec.lastQuery!;
    expect(q).toContain('<urn:seed>');
    expect(q).toContain('"Seed"');
  });
  it('chains SELECT results into VALUES of downstream node', async () => {
    const cache = new Map<string, any>();
    hoisted.get.mockImplementation((id: string) => cache.get(id) ?? null);
    hoisted.list.mockImplementation((type: string) =>
      Array.from(cache.values()).filter((entity: any) => entity['@type'] === type)
    );
    hoisted.getAll.mockImplementation(() => Array.from(cache.values()));

    const backendId = 'urn:backend:test';
    cache.set(backendId, { $id: backendId, '@type': 'Backend', backendType: HTTP_BACKEND_TYPE, endpoint: 'http://example.invalid/sparql' });

    // Query outputs and tuples for source
    const qout1 = 'urn:qout:entity';
    const qout2 = 'urn:qout:name';
    cache.set(qout1, { $id: qout1, '@type': 'QueryOutput', variableName: 'entity' });
    cache.set(qout2, { $id: qout2, '@type': 'QueryOutput', variableName: 'name' });
    const tm1 = 'urn:tm:0';
    const tm2 = 'urn:tm:1';
    cache.set(tm1, { $id: tm1, '@type': 'TupleMember', position: 0, variable: qout1 });
    cache.set(tm2, { $id: tm2, '@type': 'TupleMember', position: 1, variable: qout2 });
    const outTuple = 'urn:tuple:out';
    cache.set(outTuple, { $id: outTuple, '@type': 'QueryOutputTuple', memberEntries: [tm1, tm2] });

    // Query inputs and tuples for target
    const qin1 = 'urn:qin:entity';
    const qin2 = 'urn:qin:name';
    cache.set(qin1, { $id: qin1, '@type': 'QueryInput', variableName: 'entity' });
    cache.set(qin2, { $id: qin2, '@type': 'QueryInput', variableName: 'name' });
    const tim1 = 'urn:tim:0';
    const tim2 = 'urn:tim:1';
    cache.set(tim1, { $id: tim1, '@type': 'TupleMember', position: 0, variable: qin1 });
    cache.set(tim2, { $id: tim2, '@type': 'TupleMember', position: 1, variable: qin2 });
    const inTuple = 'urn:tuple:in';
    cache.set(inTuple, { $id: inTuple, '@type': 'QueryInputTuple', memberEntries: [tim1, tim2] });

    // Query outputs for n2
    const qout2a = 'urn:qout:entity2';
    const qout2b = 'urn:qout:name2';
    const qout2c = 'urn:qout:x';
    cache.set(qout2a, { $id: qout2a, '@type': 'QueryOutput', variableName: 'entity' });
    cache.set(qout2b, { $id: qout2b, '@type': 'QueryOutput', variableName: 'name' });
    cache.set(qout2c, { $id: qout2c, '@type': 'QueryOutput', variableName: 'x' });
    const tm2a = 'urn:tm2:0';
    const tm2b = 'urn:tm2:1';
    const tm2c = 'urn:tm2:2';
    cache.set(tm2a, { $id: tm2a, '@type': 'TupleMember', position: 0, variable: qout2a });
    cache.set(tm2b, { $id: tm2b, '@type': 'TupleMember', position: 1, variable: qout2b });
    cache.set(tm2c, { $id: tm2c, '@type': 'TupleMember', position: 2, variable: qout2c });
    const outTuple2 = 'urn:tuple:out2';
    cache.set(outTuple2, { $id: outTuple2, '@type': 'QueryOutputTuple', memberEntries: [tm2a, tm2b, tm2c] });

    // Query versions
    const srcQuery = 'SELECT ?entity ?name WHERE { ?entity <http://example.org/p> ?name }';
    const tgtQuery = 'SELECT ?entity ?name ?x WHERE { VALUES (?entity ?name) { (UNDEF UNDEF) } OPTIONAL { ?entity <http://example.org/p> ?x } }';
    const qv1 = 'urn:qv:1';
    const qv2 = 'urn:qv:2';
    cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: srcQuery, queryType: QueryTypeIri.select });
    cache.set(qv2, { $id: qv2, '@type': 'QueryVersion', queryString: tgtQuery, queryType: QueryTypeIri.select });

    // Nodes
    const n1 = 'urn:node:1';
    const n2 = 'urn:node:2';
    const nEnd = 'urn:node:end';
    cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1, outputs: [outTuple] });
    cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv2, inputs: [inTuple], outputs: [outTuple2] });
    cache.set(nEnd, { $id: nEnd, '@type': 'EndNode', inputs: [outTuple2] });

    // Edges
    const e1 = 'urn:edge:1';
    const e2 = 'urn:edge:2';
    cache.set(e1, { $id: e1, '@type': 'QueryEdge', sourceNodeId: n1, targetNodeId: n2, dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: outTuple, targetInputId: inTuple });
    cache.set(e2, { $id: e2, '@type': 'QueryEdge', sourceNodeId: n2, targetNodeId: nEnd, dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: outTuple2, targetInputId: outTuple2 });

    // Group version
    const gv = 'urn:qgv:1';
    cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n1, n2, nEnd], edges: [e1, e2] });

    const gb = new GraphBuilder();
    const graph = gb.buildFromGroupVersionId(gv);

    // Prepare executors
    const factory = new TestExecutorFactory() as any;
    const engine = new ExecutionEngine(factory);

    const rn1 = graph.nodes.get(n1)!;
    const rn2 = graph.nodes.get(n2)!;

    const srcExec = new MockExecutor({
      head: { vars: ['entity', 'name'] },
      results: { bindings: [
        { entity: { type: 'uri', value: 'urn:a' }, name: { type: 'literal', value: 'A' } },
        { entity: { type: 'uri', value: 'urn:b' }, name: { type: 'literal', value: 'B' } }
      ] }
    });
    const tgtExec = new MockExecutor({ head: { vars: [] }, results: { bindings: [] } });
    factory.set(rn1, srcExec);
    factory.set(rn2, tgtExec);

    const { result, resultNodeId } = await engine.execute(graph);
    expect(resultNodeId).toBe(n2);
    // Ensure VALUES were applied for both rows
    const q = tgtExec.lastQuery!;
    expect(q).toContain('VALUES( ?entity ?name )');
    expect(q).toContain('<urn:a>');
    expect(q).toContain('"A"');
    expect(q).toContain('<urn:b>');
    expect(q).toContain('"B"');
    // Minimal final result shape
    expect(result && typeof result === 'object' && 'head' in (result as any)).toBe(true);
  });

  it('chains across three nodes with renamed tuple variables', async () => {
    const cache = new Map<string, any>();
    hoisted.get.mockImplementation((id: string) => cache.get(id) ?? null);
    hoisted.list.mockImplementation((type: string) =>
      Array.from(cache.values()).filter((entity: any) => entity['@type'] === type)
    );
    hoisted.getAll.mockImplementation(() => Array.from(cache.values()));

    const backendId = 'urn:backend:test:multi';
    cache.set(backendId, { $id: backendId, '@type': 'Backend', backendType: HTTP_BACKEND_TYPE, endpoint: 'http://example.invalid/sparql' });

    // Node1 outputs: entity, label
    const o1a = 'urn:qout:e1'; const o1b = 'urn:qout:l1';
    cache.set(o1a, { $id: o1a, '@type': 'QueryOutput', variableName: 'entity' });
    cache.set(o1b, { $id: o1b, '@type': 'QueryOutput', variableName: 'label' });
    const tm10 = 'urn:tmem:10'; const tm11 = 'urn:tmem:11';
    cache.set(tm10, { $id: tm10, '@type': 'TupleMember', position: 0, variable: o1a });
    cache.set(tm11, { $id: tm11, '@type': 'TupleMember', position: 1, variable: o1b });
    const out1 = 'urn:tuple:out1';
    cache.set(out1, { $id: out1, '@type': 'QueryOutputTuple', memberEntries: [tm10, tm11] });

    // Node2 inputs: ent, name; outputs: id, title
    const i2a = 'urn:qin:ent'; const i2b = 'urn:qin:name';
    cache.set(i2a, { $id: i2a, '@type': 'QueryInput', variableName: 'ent' });
    cache.set(i2b, { $id: i2b, '@type': 'QueryInput', variableName: 'name' });
    const tm20 = 'urn:tmem:20'; const tm21 = 'urn:tmem:21';
    cache.set(tm20, { $id: tm20, '@type': 'TupleMember', position: 0, variable: i2a });
    cache.set(tm21, { $id: tm21, '@type': 'TupleMember', position: 1, variable: i2b });
    const in2 = 'urn:tuple:in2';
    cache.set(in2, { $id: in2, '@type': 'QueryInputTuple', memberEntries: [tm20, tm21] });

    const o2a = 'urn:qout:id'; const o2b = 'urn:qout:title';
    cache.set(o2a, { $id: o2a, '@type': 'QueryOutput', variableName: 'id' });
    cache.set(o2b, { $id: o2b, '@type': 'QueryOutput', variableName: 'title' });
    const tm22 = 'urn:tmem:22'; const tm23 = 'urn:tmem:23';
    cache.set(tm22, { $id: tm22, '@type': 'TupleMember', position: 0, variable: o2a });
    cache.set(tm23, { $id: tm23, '@type': 'TupleMember', position: 1, variable: o2b });
    const out2 = 'urn:tuple:out2';
    cache.set(out2, { $id: out2, '@type': 'QueryOutputTuple', memberEntries: [tm22, tm23] });

    // Node3 inputs: id, title; outputs: id, title
    const i3a = 'urn:qin:id'; const i3b = 'urn:qin:title';
    cache.set(i3a, { $id: i3a, '@type': 'QueryInput', variableName: 'id' });
    cache.set(i3b, { $id: i3b, '@type': 'QueryInput', variableName: 'title' });
    const tm30 = 'urn:tmem:30'; const tm31 = 'urn:tmem:31';
    cache.set(tm30, { $id: tm30, '@type': 'TupleMember', position: 0, variable: i3a });
    cache.set(tm31, { $id: tm31, '@type': 'TupleMember', position: 1, variable: i3b });
    const in3 = 'urn:tuple:in3';
    cache.set(in3, { $id: in3, '@type': 'QueryInputTuple', memberEntries: [tm30, tm31] });

    const o3a = 'urn:qout:id3'; const o3b = 'urn:qout:title3';
    cache.set(o3a, { $id: o3a, '@type': 'QueryOutput', variableName: 'id' });
    cache.set(o3b, { $id: o3b, '@type': 'QueryOutput', variableName: 'title' });
    const tm32 = 'urn:tmem:32'; const tm33 = 'urn:tmem:33';
    cache.set(tm32, { $id: tm32, '@type': 'TupleMember', position: 0, variable: o3a });
    cache.set(tm33, { $id: tm33, '@type': 'TupleMember', position: 1, variable: o3b });
    const out3 = 'urn:tuple:out3';
    cache.set(out3, { $id: out3, '@type': 'QueryOutputTuple', memberEntries: [tm32, tm33] });

    // Queries
    const q1 = 'SELECT ?entity ?label WHERE { ?entity <p:name> ?label }';
    const q2 = 'SELECT ?id ?title WHERE { VALUES (?ent ?name) { (UNDEF UNDEF) } BIND(?ent AS ?id) BIND(?name AS ?title) }';
    const q3 = 'SELECT ?id ?title WHERE { VALUES (?id ?title) { (UNDEF UNDEF) } }';
    const qv1 = 'urn:qv:one'; const qv2 = 'urn:qv:two'; const qv3 = 'urn:qv:three';
    cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: q1, queryType: QueryTypeIri.select });
    cache.set(qv2, { $id: qv2, '@type': 'QueryVersion', queryString: q2, queryType: QueryTypeIri.select });
    cache.set(qv3, { $id: qv3, '@type': 'QueryVersion', queryString: q3, queryType: QueryTypeIri.select });

    // Nodes
    const n1 = 'urn:node:one'; const n2 = 'urn:node:two'; const n3 = 'urn:node:three'; const nEnd = 'urn:node:end';
    cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1, outputs: [out1] });
    cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv2, inputs: [in2], outputs: [out2] });
    cache.set(n3, { $id: n3, '@type': 'QueryNode', backendId, queryId: qv3, inputs: [in3], outputs: [out3] });
    cache.set(nEnd, { $id: nEnd, '@type': 'EndNode', inputs: [out3] });

    // Edges: n1(out1)->n2(in2), n2(out2)->n3(in3), n3(out3)->end(out3 pass-through)
    const e12 = 'urn:edge:12'; const e23 = 'urn:edge:23'; const e3end = 'urn:edge:3end';
    cache.set(e12, { $id: e12, '@type': 'QueryEdge', sourceNodeId: n1, targetNodeId: n2, dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: out1, targetInputId: in2 });
    cache.set(e23, { $id: e23, '@type': 'QueryEdge', sourceNodeId: n2, targetNodeId: n3, dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: out2, targetInputId: in3 });
    cache.set(e3end, { $id: e3end, '@type': 'QueryEdge', sourceNodeId: n3, targetNodeId: nEnd, dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: out3, targetInputId: out3 });

    const gv = 'urn:qgv:multi';
    cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', executionNodes: [n1, n2, n3, nEnd], edges: [e12, e23, e3end] });

    const gb = new GraphBuilder();
    const graph = gb.buildFromGroupVersionId(gv);

    const factory = new TestExecutorFactory() as any;
    const engine = new ExecutionEngine(factory);
    const rn1 = graph.nodes.get(n1)!; const rn2 = graph.nodes.get(n2)!; const rn3 = graph.nodes.get(n3)!;
    const exec1 = new MockExecutor({ head: { vars: ['entity', 'label'] }, results: { bindings: [ { entity: { type: 'uri', value: 'urn:x' }, label: { type: 'literal', value: 'X' } } ] } });
    const exec2 = new MockExecutor({ head: { vars: ['id', 'title'] }, results: { bindings: [ { id: { type: 'uri', value: 'urn:y' }, title: { type: 'literal', value: 'Y' } } ] } });
    const exec3 = new MockExecutor({ head: { vars: [] }, results: { bindings: [] } });
    factory.set(rn1, exec1);
    factory.set(rn2, exec2);
    factory.set(rn3, exec3);

    const { resultNodeId } = await engine.execute(graph);
    expect(resultNodeId).toBe(n3);
    // Node2 should have received (?ent ?name) from node1's (?entity ?label)
    expect(exec2.lastQuery!).toContain('VALUES( ?ent ?name )');
    expect(exec2.lastQuery!).toContain('<urn:x>');
    expect(exec2.lastQuery!).toContain('"X"');
    // Node3 should have received (?id ?title) from node2
    expect(exec3.lastQuery!).toContain('VALUES( ?id ?title )');
    expect(exec3.lastQuery!).toContain('<urn:y>');
    expect(exec3.lastQuery!).toContain('"Y"');
  });
});
