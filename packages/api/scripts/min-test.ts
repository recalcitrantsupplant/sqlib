/* Minimal smoke test for DAG chaining without external backends. */
import { memoryCacheManager } from '../src/lib/MemoryCacheManager.js';
import { GraphBuilder } from '../src/lib/orchestration/GraphBuilder.js';
import { ExecutionEngine } from '../src/lib/orchestration/ExecutionEngine.js';
import type { ISparqlExecutor } from '../src/server/ISparqlExecutor.js';

class MockExecutor implements ISparqlExecutor {
  public lastQuery: string | undefined;
  constructor(private result: any) {}
  async selectQueryParsed(query: string): Promise<any> { this.lastQuery = query; return this.result; }
  async constructQueryParsed(query: string): Promise<string> { this.lastQuery = query; return '@prefix : <#> .'; }
  async selectQueryStream(): Promise<any> { throw new Error('not used'); }
  async constructQueryStream(): Promise<any> { throw new Error('not used'); }
  async update(): Promise<void> { throw new Error('not used'); }
  async askQuery(query: string): Promise<boolean> { this.lastQuery = query; return true; }
}

class TestExecutorFactory {
  private nodeExec = new Map<string, MockExecutor>();
  set(nodeId: string, exec: MockExecutor) { this.nodeExec.set(nodeId, exec); }
  getExecutorForNode(node: { id: string }): ISparqlExecutor {
    const exec = this.nodeExec.get(node.id);
    if (!exec) throw new Error(`Missing mock executor for node ${node.id}`);
    return exec;
  }
}

async function main() {
  (memoryCacheManager as any).isLoaded = true;
  (memoryCacheManager as any).triggerIdRefreshIfStale = () => {};
  (memoryCacheManager as any).triggerTypeRefreshIfStale = () => {};
  const cache = new Map<string, any>();
  (memoryCacheManager as any).cache = cache;

  const backendId = 'urn:backend:test';
  cache.set(backendId, { $id: backendId, '@type': 'Backend', backendType: 'HTTP', endpoint: 'http://example.invalid/sparql' });

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

  const srcQuery = 'SELECT ?entity ?name WHERE { ?entity <http://example.org/p> ?name }';
  const tgtQuery = 'SELECT ?entity ?name ?x WHERE { VALUES (?entity ?name) { (UNDEF UNDEF) } OPTIONAL { ?entity <http://example.org/p> ?x } }';
  const qv1 = 'urn:qv:1';
  const qv2 = 'urn:qv:2';
  cache.set(qv1, { $id: qv1, '@type': 'QueryVersion', queryString: srcQuery, queryType: 'SELECT' });
  cache.set(qv2, { $id: qv2, '@type': 'QueryVersion', queryString: tgtQuery, queryType: 'SELECT' });

  const n1 = 'urn:node:1';
  const n2 = 'urn:node:2';
  cache.set(n1, { $id: n1, '@type': 'QueryNode', backendId, queryId: qv1, outputTuples: [outTuple] });
  cache.set(n2, { $id: n2, '@type': 'QueryNode', backendId, queryId: qv2, inputTuples: [inTuple] });

  const e1 = 'urn:edge:1';
  cache.set(e1, { $id: e1, '@type': 'QueryEdge', sourceNodeId: n1, targetNodeId: n2, dataFlowType: 'VARIABLE_BINDINGS', sourceOutputTupleId: outTuple, targetInputTupleId: inTuple });

  const gv = 'urn:qgv:1';
  cache.set(gv, { $id: gv, '@type': 'QueryGroupVersion', nodes: [n1, n2], edges: [e1] });

  const gb = new GraphBuilder();
  const graph = gb.buildFromGroupVersionId(gv);

  const factory = new TestExecutorFactory() as any;
  const engine = new ExecutionEngine(factory);

  const rn1 = graph.nodes.get(n1)!;
  const rn2 = graph.nodes.get(n2)!;
  const srcExec = new MockExecutor({
    head: { vars: ['entity', 'name'] },
    results: { bindings: [
      { entity: { type: 'uri', value: 'urn:a' }, name: { type: 'literal', value: 'A' } },
      { entity: { type: 'uri', value: 'urn:b' }, name: { type: 'literal', value: 'B' } },
    ] },
  });
  const tgtExec = new MockExecutor({ head: { vars: [] }, results: { bindings: [] } });
  factory.set(rn1.id, srcExec);
  factory.set(rn2.id, tgtExec);

  const { resultNodeId } = await engine.execute(graph);
  const q = tgtExec.lastQuery || '';
  const ok = resultNodeId === n2 && q.includes('VALUES (?entity ?name)') && q.includes('<urn:a>') && q.includes('"A"') && q.includes('<urn:b>') && q.includes('"B"');
  if (!ok) {
    console.error('FAIL: Argument substitution or execution order incorrect');
    console.error('Result node:', resultNodeId);
    console.error('Query:', q);
    process.exit(1);
  }
  console.log('PASS: Minimal DAG chaining test');
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });

