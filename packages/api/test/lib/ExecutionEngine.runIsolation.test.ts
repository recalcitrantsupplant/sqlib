import { describe, it, expect, vi } from 'vitest';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import type { ExecutionGraph, ResolvedEdge, ResolvedNode } from '../../src/lib/orchestration/types.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';

/**
 * Two runs of one group version at once (WP13).
 *
 * A node's ephemeral `storeId` is persisted on the group version, so every
 * run of that version names the same store. The stores and executors here are
 * real, because the failure being guarded against is two runs meeting in one
 * real Oxigraph store: each seeing the other's data, and the first to finish
 * destroying the store the second is still using.
 */

const DATA_PORT = 'urn:io:data-in';
const QUERY_OUTPUT = 'urn:io:query-out';
const SHARED_STORE = 'store-shared';

const ports: Record<string, Record<string, unknown>> = {
  [DATA_PORT]: { $id: DATA_PORT, '@type': 'TriplesQuadsIO' },
  [QUERY_OUTPUT]: { $id: QUERY_OUTPUT, '@type': 'TriplesQuadsIO' },
};

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => ports[id] ?? null }),
}));

function node(id: string, raw: Record<string, unknown>, rest: Partial<ResolvedNode> = {}): ResolvedNode {
  return {
    id,
    raw: { $id: id, ...raw } as ResolvedNode['raw'],
    backendId: undefined,
    queryVersionId: undefined,
    queryVersion: undefined,
    queryString: undefined,
    queryType: undefined,
    inputTupleIds: [],
    outputTupleIds: [],
    ...rest,
  };
}

function buildGraph(): ExecutionGraph {
  const start = node('start', { '@type': 'StartNode', outputs: [DATA_PORT] }, { outputTupleIds: [DATA_PORT] });
  const query = node('query', { '@type': 'QueryNode', name: 'Echo' }, {
    queryVersionId: 'urn:qv:1',
    queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    queryType: QueryTypeIri.construct,
    outputTupleIds: [QUERY_OUTPUT],
    backendConfig: { type: 'ephemeral-oxigraph', storeId: SHARED_STORE },
  });
  const end = node('end', { '@type': 'EndNode', inputs: [QUERY_OUTPUT] });
  const edges: ResolvedEdge[] = [
    { id: 'e1', raw: {} as ResolvedEdge['raw'], sourceNodeId: 'start', targetNodeId: 'query', dataFlowType: 'RDF_GRAPH', sourceOutputId: DATA_PORT, targetInputId: 'urn:io:query-in' },
    { id: 'e2', raw: {} as ResolvedEdge['raw'], sourceNodeId: 'query', targetNodeId: 'end', dataFlowType: 'RDF_GRAPH', sourceOutputId: QUERY_OUTPUT, targetInputId: QUERY_OUTPUT },
  ];
  return {
    groupVersion: {} as ExecutionGraph['groupVersion'],
    nodes: new Map([start, query, end].map(n => [n.id, n])),
    edges,
    incomingEdges: new Map([['query', [edges[0]]], ['end', [edges[1]]]]),
    outgoingEdges: new Map([['start', [edges[0]]], ['query', [edges[1]]]]),
    startNodeIds: ['start'],
    endNodeIds: ['end'],
  };
}

describe('ExecutionEngine — per-run ephemeral stores', () => {
  it('keeps two concurrent runs of one group in separate stores', async () => {
    const graph = buildGraph();
    const engine = new ExecutionEngine(new ExecutorFactory({ internal: true }));
    const run = (subject: string) => engine.execute(graph, [], undefined, {
      acceptHeader: 'application/n-triples',
      dataGraphs: [{ content: `<urn:${subject}> <urn:p> <urn:o> .`, format: 'ntriples' }],
    });

    const [a, b] = await Promise.all([run('a'), run('b')]);

    expect(a.result).toContain('<urn:a>');
    expect(a.result).not.toContain('<urn:b>');
    expect(b.result).toContain('<urn:b>');
    expect(b.result).not.toContain('<urn:a>');
  });

  it('leaves the persisted graph untouched and destroys only its own stores', async () => {
    const graph = buildGraph();
    // A store some other run (or anything else) already holds under the
    // author's bare id must survive this run's teardown.
    const bystander = oxigraphStoreManager.createEphemeralStore(SHARED_STORE);
    try {
      await new ExecutionEngine(new ExecutorFactory({ internal: true })).execute(graph, [], undefined, {
        dataGraphs: [{ content: '<urn:s> <urn:p> <urn:o> .', format: 'ntriples' }],
      });
      expect(oxigraphStoreManager.getEphemeralStore(SHARED_STORE)).toBe(bystander);
      expect(bystander.size).toBe(0);
      expect(graph.nodes.get('query')?.backendConfig?.storeId).toBe(SHARED_STORE);
    } finally {
      oxigraphStoreManager.destroyEphemeralStore(SHARED_STORE);
    }
  });
});
