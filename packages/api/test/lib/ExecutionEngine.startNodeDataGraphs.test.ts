import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import type { ExecutionGraph, ResolvedEdge, ResolvedNode } from '../../src/lib/orchestration/types.js';
import type { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import type { RuleSetExecutor } from '../../src/lib/RuleSetExecutor.js';
import type { SparqlQueryParser } from '../../src/lib/parser.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';

/**
 * Data graphs supplied to a query group's start node.
 *
 * A start node declares two independent kinds of external input: tuples, filled
 * from the run's `arguments`, and data graphs, filled from its `dataGraphs`.
 * The point of the feature is that they are *not* alternatives, so the cases
 * below check each slot on its own and both at once, and then check that every
 * way of getting the pairing wrong is a hard error rather than a run that
 * quietly went ahead with less data than the author asked for.
 *
 * Graphs are routed by position: the run lists what it supplies, and the start
 * node's declared order says where each one goes. Nothing names a port.
 */

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  loadDataFromString: vi.fn(),
  getEphemeralStore: vi.fn(),
  destroyEphemeralStore: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: hoisted.get }),
}));

vi.mock('../../src/lib/OxigraphStoreManager.js', () => ({
  oxigraphStoreManager: {
    loadDataFromString: hoisted.loadDataFromString,
    getEphemeralStore: hoisted.getEphemeralStore,
    destroyEphemeralStore: hoisted.destroyEphemeralStore,
  },
}));

const GRAPH_TEXT = '<http://example.org/a> <http://example.org/p> <http://example.org/b> .';

function startNode(id: string, outputs: string[]): ResolvedNode {
  return {
    id,
    raw: { '@type': 'StartNode', $id: id, outputs } as ResolvedNode['raw'],
    backendId: undefined,
    queryVersionId: undefined,
    queryVersion: undefined,
    queryString: undefined,
    queryType: undefined,
    inputTupleIds: [],
    outputTupleIds: outputs,
  };
}

function ruleSetNode(id: string): ResolvedNode {
  return {
    id,
    raw: { '@type': 'RuleSetNode', $id: id, name: 'Rules' } as ResolvedNode['raw'],
    backendId: undefined,
    queryVersionId: undefined,
    queryVersion: undefined,
    queryString: undefined,
    queryType: undefined,
    ruleSetVersionId: 'urn:rsv:1',
    ruleSetVersion: { $id: 'urn:rsv:1', '@type': 'RuleSetVersion' } as unknown as ResolvedNode['ruleSetVersion'],
    inputTupleIds: [],
    outputTupleIds: [],
  };
}

function endNode(id: string, inputs: string[]): ResolvedNode {
  return {
    id,
    raw: { '@type': 'EndNode', $id: id, inputs } as ResolvedNode['raw'],
    backendId: undefined,
    queryVersionId: undefined,
    queryVersion: undefined,
    queryString: undefined,
    queryType: undefined,
    inputTupleIds: [],
    outputTupleIds: [],
  };
}

function edge(partial: Partial<ResolvedEdge> & Pick<ResolvedEdge, 'id' | 'sourceNodeId' | 'targetNodeId'>): ResolvedEdge {
  return { raw: {} as unknown as ResolvedEdge['raw'], ...partial } as ResolvedEdge;
}

const typeOf = (node: ResolvedNode): string | undefined =>
  (node.raw as { '@type'?: string })['@type'];

function graphOf(nodes: ResolvedNode[], edges: ResolvedEdge[]): ExecutionGraph {
  const incomingEdges = new Map<string, ResolvedEdge[]>();
  const outgoingEdges = new Map<string, ResolvedEdge[]>();
  for (const e of edges) {
    if (!outgoingEdges.has(e.sourceNodeId)) outgoingEdges.set(e.sourceNodeId, []);
    outgoingEdges.get(e.sourceNodeId)!.push(e);
    if (!incomingEdges.has(e.targetNodeId)) incomingEdges.set(e.targetNodeId, []);
    incomingEdges.get(e.targetNodeId)!.push(e);
  }
  return {
    groupVersion: {} as unknown as ExecutionGraph['groupVersion'],
    nodes: new Map(nodes.map(node => [node.id, node])),
    edges,
    incomingEdges,
    outgoingEdges,
    startNodeIds: nodes.filter(node => typeOf(node) === 'StartNode').map(node => node.id),
    endNodeIds: nodes.filter(node => typeOf(node) === 'EndNode').map(node => node.id),
  };
}

describe('ExecutionEngine — data graph inputs on the start node', () => {
  let cache: Map<string, Record<string, unknown>>;
  let ruleSetExecutor: { execute: ReturnType<typeof vi.fn> };
  let executorFactory: ExecutorFactory;
  let executor: {
    selectQueryParsed: ReturnType<typeof vi.fn>;
    constructQueryParsed: ReturnType<typeof vi.fn>;
    askQuery: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let engine: ExecutionEngine;
  let parser: { detectInputs: ReturnType<typeof vi.fn>; applyArguments: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new Map<string, Record<string, unknown>>();
    hoisted.get.mockImplementation((id: string) => cache.get(id) ?? null);
    hoisted.getEphemeralStore.mockReturnValue({ store: true });

    ruleSetExecutor = {
      execute: vi.fn().mockResolvedValue({ finalGraphNQuads: '<urn:inferred> <urn:p> <urn:o> .' }),
    };
    executor = {
      selectQueryParsed: vi.fn().mockResolvedValue({ result: { head: { vars: [] }, results: { bindings: [] } } }),
      constructQueryParsed: vi.fn().mockResolvedValue({ result: '<urn:s> <urn:p> <urn:o> .' }),
      askQuery: vi.fn(),
      update: vi.fn(),
    };
    executorFactory = { getExecutorForNode: vi.fn().mockResolvedValue(executor) } as unknown as ExecutorFactory;
    parser = { detectInputs: vi.fn().mockReturnValue({ valuesInputs: [] }), applyArguments: vi.fn((q: string) => q) };
    engine = new ExecutionEngine(
      executorFactory,
      parser as unknown as SparqlQueryParser,
      ruleSetExecutor as unknown as RuleSetExecutor,
    );
  });

  /** Start → RuleSet → End, with one declared data graph port on the start node. */
  function rulesPipeline(portId: string) {
    cache.set(portId, { $id: portId, '@type': 'TriplesQuadsIO', name: 'source data' });
    const rulesOutput = 'urn:io:rules-out';
    cache.set(rulesOutput, { $id: rulesOutput, '@type': 'TriplesQuadsIO' });
    return graphOf(
      [startNode('start', [portId]), ruleSetNode('rules'), endNode('end', [rulesOutput])],
      [
        edge({ id: 'e1', sourceNodeId: 'start', targetNodeId: 'rules', dataFlowType: 'RDF_GRAPH', sourceOutputId: portId, targetInputId: 'urn:io:rules-in' }),
        edge({ id: 'e2', sourceNodeId: 'rules', targetNodeId: 'end', dataFlowType: 'RDF_GRAPH', sourceOutputId: rulesOutput, targetInputId: rulesOutput }),
      ],
    );
  }

  it('hands a supplied graph to the rule set downstream of the start node', async () => {
    const graph = rulesPipeline('urn:io:data-in');

    const { result } = await engine.execute(graph, [], undefined, {
      dataGraphs: [{ content: GRAPH_TEXT, format: 'turtle' }],
    });

    expect(ruleSetExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ $id: 'urn:rsv:1' }),
      { initialGraph: GRAPH_TEXT },
    );
    expect(result).toBe('<urn:inferred> <urn:p> <urn:o> .');
  });

  /*
   * Graphs are matched to ports by position and nothing else: a run says what
   * it supplies and in what order, and the group's declared order says where
   * each one goes.
   */
  it('fills the declared inputs in the order the run lists its graphs', async () => {
    const first = 'urn:io:data-in';
    const second = 'urn:io:shapes-in';
    cache.set(second, { $id: second, '@type': 'TriplesQuadsIO', name: 'shapes' });
    const rulesOutput = 'urn:io:rules-out';
    cache.set(rulesOutput, { $id: rulesOutput, '@type': 'TriplesQuadsIO' });
    cache.set(first, { $id: first, '@type': 'TriplesQuadsIO', name: 'source data', position: 0 });
    cache.set(second, { $id: second, '@type': 'TriplesQuadsIO', name: 'shapes', position: 1 });

    // Only the second port feeds the rules node, so what arrives there says
    // which of the two supplied graphs was routed to it.
    const graph = graphOf(
      [startNode('start', [first, second]), ruleSetNode('rules'), endNode('end', [rulesOutput])],
      [
        edge({ id: 'e1', sourceNodeId: 'start', targetNodeId: 'rules', dataFlowType: 'RDF_GRAPH', sourceOutputId: second, targetInputId: 'urn:io:rules-in' }),
        edge({ id: 'e2', sourceNodeId: 'rules', targetNodeId: 'end', dataFlowType: 'RDF_GRAPH', sourceOutputId: rulesOutput, targetInputId: rulesOutput }),
      ],
    );

    await engine.execute(graph, [], undefined, {
      dataGraphs: [
        { content: GRAPH_TEXT, format: 'turtle' },
        { content: '<http://example.org/c> <http://example.org/q> <http://example.org/d> .', format: 'turtle' },
      ],
    });

    // The rule set reads the second declared port, so the run's *second* graph
    // is the one that reaches it — position, not name.
    expect(ruleSetExecutor.execute).toHaveBeenCalledWith(
      expect.anything(),
      { initialGraph: '<http://example.org/c> <http://example.org/q> <http://example.org/d> .' },
    );
  });

  it('fills tuple inputs and data graph inputs from the same run', async () => {
    // The whole point of the change: the two slots are independent, so a start
    // node declaring both gets both filled rather than one winning.
    const dataPort = 'urn:io:data-in';
    cache.set(dataPort, { $id: dataPort, '@type': 'TriplesQuadsIO', name: 'source data' });
    const tuplePort = 'urn:io:tuple-out';
    cache.set('urn:var:x', { $id: 'urn:var:x', '@type': 'QueryInputVariable', variableName: 'x' });
    cache.set('urn:tm:1', { $id: 'urn:tm:1', '@type': 'TupleMember', position: 0, variable: 'urn:var:x' });
    cache.set(tuplePort, { $id: tuplePort, '@type': 'QueryInputTuple', memberEntries: ['urn:tm:1'] });
    const rulesOutput = 'urn:io:rules-out';
    cache.set(rulesOutput, { $id: rulesOutput, '@type': 'TriplesQuadsIO' });

    const query: ResolvedNode = {
      id: 'query',
      raw: { '@type': 'QueryNode', $id: 'query' } as ResolvedNode['raw'],
      backendId: 'urn:backend:1',
      queryVersionId: 'urn:qv:1',
      queryVersion: {} as unknown as ResolvedNode['queryVersion'],
      queryString: 'SELECT ?x WHERE { VALUES (?x) { (UNDEF) } ?x ?p ?o }',
      queryType: QueryTypeIri.select,
      inputTupleIds: [tuplePort],
      outputTupleIds: [],
    };
    parser.detectInputs.mockReturnValue({ valuesInputs: [['x']] });

    const graph = graphOf(
      [startNode('start', [tuplePort, dataPort]), query, ruleSetNode('rules'), endNode('end', [rulesOutput])],
      [
        edge({ id: 'e1', sourceNodeId: 'start', targetNodeId: 'query', dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: tuplePort, targetInputId: tuplePort }),
        edge({ id: 'e2', sourceNodeId: 'start', targetNodeId: 'rules', dataFlowType: 'RDF_GRAPH', sourceOutputId: dataPort, targetInputId: 'urn:io:rules-in' }),
        edge({ id: 'e3', sourceNodeId: 'rules', targetNodeId: 'end', dataFlowType: 'RDF_GRAPH', sourceOutputId: rulesOutput, targetInputId: rulesOutput }),
      ],
    );

    await engine.execute(
      graph,
      [{ head: { vars: ['x'] }, arguments: { bindings: [{ x: { type: 'uri', value: 'http://example.org/a' } }] } }],
      undefined,
      { dataGraphs: [{ content: GRAPH_TEXT, format: 'turtle' }] },
    );

    // The tuple reached the query as a bound VALUES row...
    expect(parser.applyArguments).toHaveBeenCalledWith(
      query.queryString,
      expect.arrayContaining([
        expect.objectContaining({
          arguments: { bindings: [{ x: { type: 'uri', value: 'http://example.org/a' } }] },
        }),
      ]),
    );
    // ...and the graph reached the rules, in the same run.
    expect(ruleSetExecutor.execute).toHaveBeenCalledWith(expect.anything(), { initialGraph: GRAPH_TEXT });
  });

  it('loads a supplied graph into the ephemeral store of a SPARQL node that reads it', async () => {
    const dataPort = 'urn:io:data-in';
    cache.set(dataPort, { $id: dataPort, '@type': 'TriplesQuadsIO' });
    const queryOutput = 'urn:io:query-out';
    cache.set(queryOutput, { $id: queryOutput, '@type': 'TriplesQuadsIO' });

    const query: ResolvedNode = {
      id: 'query',
      raw: {
        '@type': 'QueryNode',
        $id: 'query',
        backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-1' },
      } as ResolvedNode['raw'],
      backendId: undefined,
      queryVersionId: 'urn:qv:1',
      queryVersion: {} as unknown as ResolvedNode['queryVersion'],
      queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.construct,
      inputTupleIds: [],
      outputTupleIds: [queryOutput],
      backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-1' },
    };

    const graph = graphOf(
      [startNode('start', [dataPort]), query, endNode('end', [queryOutput])],
      [
        edge({ id: 'e1', sourceNodeId: 'start', targetNodeId: 'query', dataFlowType: 'RDF_GRAPH', sourceOutputId: dataPort, targetInputId: 'urn:io:query-in' }),
        edge({ id: 'e2', sourceNodeId: 'query', targetNodeId: 'end', dataFlowType: 'RDF_GRAPH', sourceOutputId: queryOutput, targetInputId: queryOutput }),
      ],
    );

    await engine.execute(graph, [], undefined, {
      dataGraphs: [{ content: GRAPH_TEXT, format: 'turtle' }],
    });

    expect(hoisted.loadDataFromString).toHaveBeenCalledWith({ store: true }, GRAPH_TEXT, 'turtle');
    expect(hoisted.destroyEphemeralStore).toHaveBeenCalledWith('store-1');
  });

  it('returns a supplied graph the group passes straight through to its end node', async () => {
    const dataPort = 'urn:io:data-in';
    cache.set(dataPort, { $id: dataPort, '@type': 'TriplesQuadsIO' });
    const query: ResolvedNode = {
      id: 'query',
      raw: { '@type': 'QueryNode', $id: 'query' } as ResolvedNode['raw'],
      backendId: 'urn:backend:1',
      queryVersionId: 'urn:qv:1',
      queryVersion: {} as unknown as ResolvedNode['queryVersion'],
      queryString: 'SELECT ?x WHERE { ?x ?p ?o }',
      queryType: QueryTypeIri.select,
      inputTupleIds: [],
      outputTupleIds: [],
    };

    const graph = graphOf(
      [startNode('start', [dataPort]), query, endNode('end', [dataPort])],
      [
        edge({ id: 'e1', sourceNodeId: 'start', targetNodeId: 'end', dataFlowType: 'RDF_GRAPH', sourceOutputId: dataPort, targetInputId: dataPort }),
        edge({ id: 'e2', sourceNodeId: 'start', targetNodeId: 'query', dataFlowType: 'CONTROL_FLOW' }),
      ],
    );

    const { result } = await engine.execute(graph, [], undefined, {
      dataGraphs: [{ content: GRAPH_TEXT, format: 'turtle' }],
    });

    expect(result).toBe(GRAPH_TEXT);
  });

  it('refuses a declared data graph input the run did not supply', async () => {
    await expect(engine.execute(rulesPipeline('urn:io:data-in'), [], undefined, { dataGraphs: [] }))
      .rejects.toThrow(/declares data graph input source data \(urn:io:data-in\).*did not supply/s);
  });

  it('refuses more graphs than the start node has inputs to put them in', async () => {
    await expect(engine.execute(rulesPipeline('urn:io:data-in'), [], undefined, {
      dataGraphs: [
        { content: GRAPH_TEXT, format: 'turtle' },
        { content: GRAPH_TEXT, format: 'turtle' },
      ],
    })).rejects.toThrow(/supplies 2 data graph\(s\) but the query group's start node declares 1/);
  });

  it('refuses a graph when the start node declares no data graph input at all', async () => {
    const tuplePort = 'urn:io:tuple-out';
    cache.set(tuplePort, { $id: tuplePort, '@type': 'QueryInputTuple', memberEntries: [] });
    const rulesOutput = 'urn:io:rules-out';
    cache.set(rulesOutput, { $id: rulesOutput, '@type': 'TriplesQuadsIO' });

    const graph = graphOf(
      [startNode('start', [tuplePort]), ruleSetNode('rules'), endNode('end', [rulesOutput])],
      [
        edge({ id: 'e1', sourceNodeId: 'start', targetNodeId: 'rules', dataFlowType: 'CONTROL_FLOW' }),
        edge({ id: 'e2', sourceNodeId: 'rules', targetNodeId: 'end', dataFlowType: 'RDF_GRAPH', sourceOutputId: rulesOutput, targetInputId: rulesOutput }),
      ],
    );

    await expect(engine.execute(graph, [], undefined, {
      dataGraphs: [{ content: GRAPH_TEXT, format: 'turtle' }],
    })).rejects.toThrow(/declares no data graph input/);
  });

  it('runs a group with no data graph input when the run supplies none', async () => {
    const rulesOutput = 'urn:io:rules-out';
    cache.set(rulesOutput, { $id: rulesOutput, '@type': 'TriplesQuadsIO' });
    const graph = graphOf(
      [startNode('start', []), ruleSetNode('rules'), endNode('end', [rulesOutput])],
      [
        edge({ id: 'e1', sourceNodeId: 'start', targetNodeId: 'rules', dataFlowType: 'CONTROL_FLOW' }),
        edge({ id: 'e2', sourceNodeId: 'rules', targetNodeId: 'end', dataFlowType: 'RDF_GRAPH', sourceOutputId: rulesOutput, targetInputId: rulesOutput }),
      ],
    );

    const { result } = await engine.execute(graph);

    expect(result).toBe('<urn:inferred> <urn:p> <urn:o> .');
    expect(ruleSetExecutor.execute).toHaveBeenCalledWith(expect.anything(), { initialGraph: undefined });
  });
});
