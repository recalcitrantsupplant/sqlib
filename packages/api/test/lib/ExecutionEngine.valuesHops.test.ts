import { describe, it, expect, vi } from 'vitest';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import type { ArgumentSet, ExecutionGraph, ResolvedEdge, ResolvedNode, SparqlResultsJson } from '../../src/lib/orchestration/types.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';

/**
 * Rows crossing a SELECT → VALUES hop (WP15), with the real parser and a real
 * in-process store, since both failures were the parser refusing what the
 * engine built.
 */

const entities: Record<string, Record<string, unknown>> = {
  'urn:io:data': { '@type': 'TriplesQuadsIO' },
  // An output tuple (?s ?label) and an input tuple (?label), as stored.
  'urn:io:people-out': { '@type': 'QueryOutputTuple', memberEntries: ['urn:m:s', 'urn:m:label'] },
  'urn:m:s': { variable: 'urn:v:s', position: 0 },
  'urn:m:label': { variable: 'urn:v:label', position: 1 },
  'urn:v:s': { variableName: 's' },
  'urn:v:label': { variableName: 'label' },
  'urn:io:labels-in': { '@type': 'QueryInputTuple', memberEntries: ['urn:m:in-label'] },
  'urn:m:in-label': { variable: 'urn:v:in-label', position: 0 },
  'urn:v:in-label': { variableName: 'label' },
  'urn:io:labels-out': { '@type': 'QueryOutputTuple' },
};

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => entities[id] ?? null }),
}));

function node(id: string, raw: Record<string, unknown>, rest: Partial<ResolvedNode> = {}): ResolvedNode {
  return {
    id,
    raw: { $id: id, name: id, ...raw } as ResolvedNode['raw'],
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

function graphOf(nodes: ResolvedNode[], edges: ResolvedEdge[]): ExecutionGraph {
  const incomingEdges = new Map<string, ResolvedEdge[]>();
  const outgoingEdges = new Map<string, ResolvedEdge[]>();
  for (const e of edges) {
    outgoingEdges.set(e.sourceNodeId, [...(outgoingEdges.get(e.sourceNodeId) ?? []), e]);
    incomingEdges.set(e.targetNodeId, [...(incomingEdges.get(e.targetNodeId) ?? []), e]);
  }
  return {
    groupVersion: {} as ExecutionGraph['groupVersion'],
    nodes: new Map(nodes.map(n => [n.id, n])),
    edges,
    incomingEdges,
    outgoingEdges,
    startNodeIds: ['start'],
    endNodeIds: ['end'],
  };
}

const labelsOf = (result: unknown) =>
  (result as SparqlResultsJson).results.bindings.map(row => row.label?.value).sort();

describe('ExecutionEngine — rows in VALUES hops', () => {
  it('runs when an OPTIONAL upstream column leaves some rows unbound', async () => {
    const people = node('people', { '@type': 'QueryNode' }, {
      queryVersionId: 'urn:qv:people',
      queryString: 'SELECT ?s ?label WHERE { ?s a <urn:Person> OPTIONAL { ?s <urn:label> ?label } }',
      queryType: QueryTypeIri.select,
      outputTupleIds: ['urn:io:people-out'],
      backendConfig: { type: 'ephemeral-oxigraph', storeId: 'people' },
    });
    const labels = node('labels', { '@type': 'QueryNode' }, {
      queryVersionId: 'urn:qv:labels',
      queryString: 'SELECT ?label WHERE { VALUES ?label { UNDEF } }',
      queryType: QueryTypeIri.select,
      inputTupleIds: ['urn:io:labels-in'],
      outputTupleIds: ['urn:io:labels-out'],
      backendConfig: { type: 'ephemeral-oxigraph', storeId: 'labels' },
    });
    const edges: ResolvedEdge[] = [
      { id: 'e0', raw: {} as ResolvedEdge['raw'], sourceNodeId: 'start', targetNodeId: 'people', dataFlowType: 'RDF_GRAPH', sourceOutputId: 'urn:io:data', targetInputId: 'urn:io:people-data' },
      { id: 'e1', raw: {} as ResolvedEdge['raw'], sourceNodeId: 'people', targetNodeId: 'labels', dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: 'urn:io:people-out', targetInputId: 'urn:io:labels-in' },
      { id: 'e2', raw: {} as ResolvedEdge['raw'], sourceNodeId: 'labels', targetNodeId: 'end', dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: 'urn:io:labels-out', targetInputId: 'urn:io:labels-out' },
    ];
    const graph = graphOf([
      node('start', { '@type': 'StartNode', outputs: ['urn:io:data'] }, { outputTupleIds: ['urn:io:data'] }),
      people,
      labels,
      node('end', { '@type': 'EndNode', inputs: ['urn:io:labels-out'] }),
    ], edges);

    // Ann has a label; Bob does not, so his row reaches the hop with ?label unbound.
    const data = [
      '<urn:ann> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <urn:Person> .',
      '<urn:ann> <urn:label> "Ann" .',
      '<urn:bob> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <urn:Person> .',
    ].join('\n');

    const { result } = await new ExecutionEngine(new ExecutorFactory({ internal: true }))
      .execute(graph, [], undefined, { dataGraphs: [{ content: data, format: 'ntriples' }] });

    expect(labelsOf(result)).toEqual(['Ann']);
  });

  it('fills a group node from an argument set naming its variables in another order', async () => {
    const query = node('query', { '@type': 'QueryNode' }, {
      queryVersionId: 'urn:qv:pairs',
      queryString: 'SELECT ?city ?state WHERE { VALUES (?city ?state) { (UNDEF UNDEF) } }',
      queryType: QueryTypeIri.select,
      outputTupleIds: ['urn:io:labels-out'],
      backendConfig: { type: 'ephemeral-oxigraph', storeId: 'pairs' },
    });
    const graph = graphOf([
      node('start', { '@type': 'StartNode' }),
      query,
      node('end', { '@type': 'EndNode', inputs: ['urn:io:labels-out'] }),
    ], [
      { id: 'e0', raw: {} as ResolvedEdge['raw'], sourceNodeId: 'start', targetNodeId: 'query', dataFlowType: 'CONTROL_FLOW' },
      { id: 'e1', raw: {} as ResolvedEdge['raw'], sourceNodeId: 'query', targetNodeId: 'end', dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: 'urn:io:labels-out', targetInputId: 'urn:io:labels-out' },
    ]);
    const reordered: ArgumentSet = {
      head: { vars: ['state', 'city'] },
      results: { bindings: [{ state: { type: 'literal', value: 'NSW' }, city: { type: 'literal', value: 'Sydney' } }] },
    };

    const { result } = await new ExecutionEngine(new ExecutorFactory({ internal: true })).execute(graph, [reordered]);

    expect((result as SparqlResultsJson).results.bindings).toEqual([
      { city: { type: 'literal', value: 'Sydney' }, state: { type: 'literal', value: 'NSW' } },
    ]);
  });
});
