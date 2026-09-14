import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import type { ExecutionGraph, ResolvedEdge, ResolvedNode } from '../../src/lib/orchestration/types.js';
import type { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import type { RuleSetExecutor } from '../../src/lib/RuleSetExecutor.js';
import type { SparqlQueryParser } from '../../src/lib/parser.js';

/**
 * `LIMIT` / `OFFSET` values reaching a group's member queries.
 *
 * The route used to refuse these for a group because there is "no unambiguous
 * single query to which a *global* LIMIT/OFFSET can be applied". These are not
 * global: a placeholder is named, so a value reaches exactly those nodes whose
 * query declares that name — which is what these check, node by node. See
 * `docs/concepts.md`.
 */

const hoisted = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: hoisted.get }),
}));

vi.mock('../../src/lib/OxigraphStoreManager.js', () => ({
  oxigraphStoreManager: {
    loadDataFromString: vi.fn(),
    getEphemeralStore: vi.fn().mockReturnValue({ store: true }),
    destroyEphemeralStore: vi.fn(),
  },
}));

function queryNode(id: string, queryString: string): ResolvedNode {
  return {
    id,
    raw: { '@type': 'QueryNode', $id: id, name: id } as ResolvedNode['raw'],
    backendId: 'urn:backend:1',
    queryVersionId: `urn:qv:${id}`,
    queryVersion: undefined,
    queryString,
    queryType: undefined,
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

const typeOf = (node: ResolvedNode): string | undefined => (node.raw as { '@type'?: string })['@type'];

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
    startNodeIds: [],
    endNodeIds: nodes.filter(node => typeOf(node) === 'EndNode').map(node => node.id),
  };
}

describe('ExecutionEngine — LIMIT/OFFSET on a group run', () => {
  let engine: ExecutionEngine;
  let parser: {
    detectInputs: ReturnType<typeof vi.fn>;
    applyArguments: ReturnType<typeof vi.fn>;
    applyLimitOffsetParameters: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.get.mockReturnValue(null);

    const executor = {
      selectQueryParsed: vi.fn().mockResolvedValue({ result: { head: { vars: [] }, results: { bindings: [] } } }),
      constructQueryParsed: vi.fn(),
      askQuery: vi.fn(),
      update: vi.fn(),
    };
    const executorFactory = { getExecutorForNode: vi.fn().mockResolvedValue(executor) } as unknown as ExecutorFactory;

    parser = {
      // Each node declares whatever its own text spells, so the engine's filter
      // is exercised rather than mocked away.
      detectInputs: vi.fn((query: string) => ({
        valuesInputs: [],
        limitParameters: [...query.matchAll(/LIMIT\s+000(\d+)/g)].map(m => m[1]),
        offsetParameters: [...query.matchAll(/OFFSET\s+000(\d+)/g)].map(m => m[1]),
      })),
      applyArguments: vi.fn((query: string) => query),
      applyLimitOffsetParameters: vi.fn((query: string, limits: Array<{ name: string; value: number }>, offsets: Array<{ name: string; value: number }>) => {
        let out = query;
        for (const limit of limits) out = out.replace(new RegExp(`LIMIT\\s+000${limit.name}\\b`), `LIMIT ${limit.value}`);
        for (const offset of offsets) out = out.replace(new RegExp(`OFFSET\\s+000${offset.name}\\b`), `OFFSET ${offset.value}`);
        return out;
      }),
    };

    engine = new ExecutionEngine(
      executorFactory,
      parser as unknown as SparqlQueryParser,
      { execute: vi.fn() } as unknown as RuleSetExecutor,
    );
  });

  const twoNodes = (first: string, second: string) => graphOf(
    /*
     * Only `a` feeds the end node: merging two bindings results into one end
     * input is unimplemented and beside the point here, which is which query
     * text each node was handed.
     */
    [queryNode('a', first), queryNode('b', second), endNode('end', ['urn:io:out-a'])],
    [
      edge({
        id: 'e1', sourceNodeId: 'a', targetNodeId: 'end', dataFlowType: 'SPARQL_RESULTS',
        sourceOutputId: 'urn:io:out-a', targetInputId: 'urn:io:out-a',
      }),
    ],
  );

  /** What every node was actually asked to run. */
  const appliedQueries = () => parser.applyArguments.mock.calls.map(call => call[0] as string);

  it('applies a number only to the node whose query declares its name', async () => {
    const graph = twoNodes(
      'SELECT * WHERE { ?s ?p ?o } LIMIT 00010',
      'SELECT * WHERE { ?a ?b ?c }',
    );

    await engine.execute(graph, [], undefined, { limits: [{ name: '10', value: 5 }] });

    const queries = appliedQueries();
    expect(queries).toContain('SELECT * WHERE { ?s ?p ?o } LIMIT 5');
    // The node that never declared it is untouched, not handed a stray value.
    expect(queries).toContain('SELECT * WHERE { ?a ?b ?c }');
  });

  it('gives two nodes sharing a name the same value — that is what sharing one means', async () => {
    const graph = twoNodes(
      'SELECT * WHERE { ?s ?p ?o } LIMIT 00010',
      'SELECT * WHERE { ?a ?b ?c } LIMIT 00010',
    );

    await engine.execute(graph, [], undefined, { limits: [{ name: '10', value: 7 }] });

    expect(appliedQueries()).toEqual(expect.arrayContaining([
      'SELECT * WHERE { ?s ?p ?o } LIMIT 7',
      'SELECT * WHERE { ?a ?b ?c } LIMIT 7',
    ]));
  });

  it('pages two nodes independently when they name their parameters differently', async () => {
    const graph = twoNodes(
      'SELECT * WHERE { ?s ?p ?o } LIMIT 00010',
      'SELECT * WHERE { ?a ?b ?c } LIMIT 00020',
    );

    await engine.execute(graph, [], undefined, {
      limits: [{ name: '10', value: 5 }, { name: '20', value: 50 }],
    });

    expect(appliedQueries()).toEqual(expect.arrayContaining([
      'SELECT * WHERE { ?s ?p ?o } LIMIT 5',
      'SELECT * WHERE { ?a ?b ?c } LIMIT 50',
    ]));
  });

  it('applies an OFFSET the same way', async () => {
    const graph = twoNodes(
      'SELECT * WHERE { ?s ?p ?o } OFFSET 00030',
      'SELECT * WHERE { ?a ?b ?c }',
    );

    await engine.execute(graph, [], undefined, { offsets: [{ name: '30', value: 100 }] });

    expect(appliedQueries()).toContain('SELECT * WHERE { ?s ?p ?o } OFFSET 100');
  });

  /* A run with no numbers must not pay for the substitution pass at all. */
  it('does not touch the query text when the run supplies no numbers', async () => {
    const graph = twoNodes('SELECT * WHERE { ?s ?p ?o } LIMIT 00010', 'SELECT * WHERE { ?a ?b ?c }');

    await engine.execute(graph, [], undefined, {});

    expect(parser.applyLimitOffsetParameters).not.toHaveBeenCalled();
    expect(appliedQueries()).toContain('SELECT * WHERE { ?s ?p ?o } LIMIT 00010');
  });
});
