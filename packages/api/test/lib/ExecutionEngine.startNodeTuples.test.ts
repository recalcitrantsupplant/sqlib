import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import type { ExecutionGraph, ResolvedEdge, ResolvedNode } from '../../src/lib/orchestration/types.js';
import type { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import type { RuleSetExecutor } from '../../src/lib/RuleSetExecutor.js';
import type { SparqlQueryParser } from '../../src/lib/parser.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';

/**
 * Tables supplied to a query group's start node.
 *
 * An argument set carries payload in order and the group says where it goes.
 * The boundary is the hop that used to have no say in it: a supplied table had
 * to match a port's signature exactly, and a miss was silent — the group ran
 * with an unfilled parameter and answered confidently from less data than the
 * author asked for.
 *
 * So the cases below cover the three things that changed: a set whose names
 * already line up still lands where it did, one whose names or order do not
 * still reaches its port, and a table that reaches nothing is an error.
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

const typeOf = (node: ResolvedNode): string | undefined =>
  (node.raw as { '@type'?: string })['@type'];

function edge(partial: Partial<ResolvedEdge> & Pick<ResolvedEdge, 'id' | 'sourceNodeId' | 'targetNodeId'>): ResolvedEdge {
  return { raw: {} as unknown as ResolvedEdge['raw'], ...partial } as ResolvedEdge;
}

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

describe('ExecutionEngine — tables supplied to the start node', () => {
  let cache: Map<string, Record<string, unknown>>;
  let engine: ExecutionEngine;
  let executor: { selectQueryParsed: ReturnType<typeof vi.fn> };
  let parser: { detectInputs: ReturnType<typeof vi.fn>; applyArguments: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new Map<string, Record<string, unknown>>();
    hoisted.get.mockImplementation((id: string) => cache.get(id) ?? null);

    executor = {
      selectQueryParsed: vi.fn().mockResolvedValue({ result: { head: { vars: [] }, results: { bindings: [] } } }),
      constructQueryParsed: vi.fn(),
      askQuery: vi.fn(),
      update: vi.fn(),
    } as unknown as typeof executor;
    parser = { detectInputs: vi.fn(), applyArguments: vi.fn((q: string) => q) };
    engine = new ExecutionEngine(
      { getExecutorForNode: vi.fn().mockResolvedValue(executor) } as unknown as ExecutorFactory,
      parser as unknown as SparqlQueryParser,
      { execute: vi.fn() } as unknown as RuleSetExecutor,
    );
  });

  /** A tuple port declaring `vars`, optionally with a stored slot and mapping. */
  function tuplePort(id: string, vars: string[], extra: Record<string, unknown> = {}) {
    const memberEntries = vars.map((name, position) => {
      const variableId = `${id}#var-${name}`;
      const memberId = `${id}#member-${position}`;
      cache.set(variableId, { $id: variableId, '@type': 'QueryInputVariable', variableName: name });
      cache.set(memberId, { $id: memberId, '@type': 'TupleMember', position, variable: variableId });
      return memberId;
    });
    cache.set(id, { $id: id, '@type': 'QueryInputTuple', memberEntries, ...extra });
    return id;
  }

  /** Start → Query → End, the query reading every port the start node declares. */
  function pipeline(ports: string[], clauses: string[][]) {
    const queryOutput = 'urn:io:query-out';
    cache.set(queryOutput, { $id: queryOutput, '@type': 'QueryOutputTuple', memberEntries: [] });
    const queryNode: ResolvedNode = {
      id: 'query',
      raw: { '@type': 'QueryNode', $id: 'query' } as ResolvedNode['raw'],
      backendId: 'urn:backend:1',
      queryVersionId: 'urn:qv:1',
      queryVersion: {} as unknown as ResolvedNode['queryVersion'],
      queryString: 'SELECT * WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.select,
      inputTupleIds: ports,
      outputTupleIds: [queryOutput],
    };
    parser.detectInputs.mockReturnValue({ valuesInputs: clauses, limitParameters: [], offsetParameters: [] });
    const bare = {
      backendId: undefined,
      queryVersionId: undefined,
      queryVersion: undefined,
      queryString: undefined,
      queryType: undefined,
    };
    return graphOf(
      [
        {
          id: 'start',
          raw: { '@type': 'StartNode', $id: 'start', outputs: ports } as ResolvedNode['raw'],
          ...bare,
          inputTupleIds: [],
          outputTupleIds: ports,
        },
        queryNode,
        {
          id: 'end',
          raw: { '@type': 'EndNode', $id: 'end', inputs: [queryOutput] } as ResolvedNode['raw'],
          ...bare,
          inputTupleIds: [],
          outputTupleIds: [],
        },
      ],
      [
        ...ports.map((portId, index) => edge({
          id: `e${index}`,
          sourceNodeId: 'start',
          targetNodeId: 'query',
          dataFlowType: 'VARIABLE_BINDINGS',
          sourceOutputId: portId,
          targetInputId: portId,
        })),
        edge({ id: 'e-out', sourceNodeId: 'query', targetNodeId: 'end', dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: queryOutput, targetInputId: queryOutput }),
      ],
    );
  }

  /** The rows the query was handed for `vars`, by the names it declares. */
  function rowsFor(vars: string[]): Array<Record<string, { value: string }>> {
    const [, argSets] = parser.applyArguments.mock.calls.at(-1) as [string, Array<{ head: { vars: string[] }; arguments: { bindings: Record<string, { value: string }>[] } }>];
    const key = [...vars].sort().join('|');
    const match = argSets.find(set => [...set.head.vars].sort().join('|') === key);
    return match?.arguments.bindings ?? [];
  }

  const uri = (value: string) => ({ type: 'uri' as const, value });

  it('seeds a table whose columns already match, as it always has', async () => {
    const port = tuplePort('urn:io:t1', ['city']);
    await engine.execute(pipeline([port], [['city']]), [
      { head: { vars: ['city'] }, arguments: { bindings: [{ city: uri('http://ex/paris') }] } },
    ]);

    expect(rowsFor(['city'])).toEqual([{ city: uri('http://ex/paris') }]);
  });

  /*
   * The failure this replaces: names that do not line up used to seed nothing
   * at all, and the group answered from an unfilled VALUES clause. Position is
   * the fallback because the run's list is ordered and the port's slot is too.
   */
  it('reaches the port by position when the column names do not line up', async () => {
    const port = tuplePort('urn:io:t1', ['city']);
    await engine.execute(pipeline([port], [['city']]), [
      { head: { vars: ['town'] }, arguments: { bindings: [{ town: uri('http://ex/paris') }] } },
    ]);

    expect(rowsFor(['city'])).toEqual([{ city: uri('http://ex/paris') }]);
  });

  it('honours a mapping the group stored on the port', async () => {
    const port = tuplePort('urn:io:t1', ['city', 'country'], {
      variableMappings: JSON.stringify([{ source: 'b', target: 'city' }, { source: 'a', target: 'country' }]),
    });
    await engine.execute(pipeline([port], [['city', 'country']]), [
      { head: { vars: ['a', 'b'] }, arguments: { bindings: [{ a: uri('http://ex/fr'), b: uri('http://ex/paris') }] } },
    ]);

    expect(rowsFor(['city', 'country'])).toEqual([
      { city: uri('http://ex/paris'), country: uri('http://ex/fr') },
    ]);
  });

  /*
   * Partial consumption: the port takes one of the two columns the caller
   * sent, which is a fact about this group's wiring and so is stated on it.
   */
  it('drops a supplied column the port does not take', async () => {
    const port = tuplePort('urn:io:t1', ['city'], {
      variableMappings: JSON.stringify([{ source: 'city', target: 'city' }]),
    });
    await engine.execute(pipeline([port], [['city']]), [
      { head: { vars: ['city', 'note'] }, arguments: { bindings: [{ city: uri('http://ex/paris'), note: uri('http://ex/x') }] } },
    ]);

    expect(rowsFor(['city'])).toEqual([{ city: uri('http://ex/paris') }]);
  });

  it('gives each port its own table when two are declared', async () => {
    const cities = tuplePort('urn:io:t1', ['city'], { position: 0 });
    const years = tuplePort('urn:io:t2', ['year'], { position: 1 });
    await engine.execute(pipeline([cities, years], [['city'], ['year']]), [
      { head: { vars: ['year'] }, arguments: { bindings: [{ year: uri('http://ex/2026') }] } },
      { head: { vars: ['city'] }, arguments: { bindings: [{ city: uri('http://ex/paris') }] } },
    ]);

    // Signature wins over order, so naming them out of order still works.
    expect(rowsFor(['city'])).toEqual([{ city: uri('http://ex/paris') }]);
    expect(rowsFor(['year'])).toEqual([{ year: uri('http://ex/2026') }]);
  });

  /*
   * The safety net. A table that reaches nothing — no declared port, and no
   * clause whose signature it matches — is the one failure that returns a
   * confident wrong answer, so it costs the run rather than being dropped, the
   * same trade `seedStartNodeDataGraphs` already makes for RDF.
   */
  it('refuses a table that fills no declared input', async () => {
    const port = tuplePort('urn:io:t1', ['city']);
    await expect(engine.execute(pipeline([port], [['city']]), [
      { head: { vars: ['city'] }, arguments: { bindings: [{ city: uri('http://ex/paris') }] } },
      { head: { vars: ['spare'] }, arguments: { bindings: [{ spare: uri('http://ex/x') }] } },
    ])).rejects.toThrow(/fill no input the query group declares/);
  });

  /*
   * And refuses before running anything. A group may contain UPDATE nodes, so
   * a request this malformed has to cost nothing rather than be reported once
   * half of it has been written.
   */
  it('refuses without executing a node', async () => {
    const port = tuplePort('urn:io:t1', ['city']);
    await expect(engine.execute(pipeline([port], [['city']]), [
      { head: { vars: ['city'] }, arguments: { bindings: [{ city: uri('http://ex/paris') }] } },
      { head: { vars: ['spare'] }, arguments: { bindings: [{ spare: uri('http://ex/x') }] } },
    ])).rejects.toThrow(/fill no input the query group declares/);

    expect(executor.selectQueryParsed).not.toHaveBeenCalled();
  });

  /*
   * The other direction stays legal: an absent external parameter runs open,
   * per `QueryEdge.whenEmpty`. Supplying nothing is a choice; supplying
   * something that lands nowhere is a mistake.
   */
  it('runs a declared port open when the run supplies nothing for it', async () => {
    const cities = tuplePort('urn:io:t1', ['city'], { position: 0 });
    const years = tuplePort('urn:io:t2', ['year'], { position: 1 });
    await expect(engine.execute(pipeline([cities, years], [['city'], ['year']]), [
      { head: { vars: ['city'] }, arguments: { bindings: [{ city: uri('http://ex/paris') }] } },
    ])).resolves.toBeDefined();

    expect(rowsFor(['city'])).toEqual([{ city: uri('http://ex/paris') }]);
    expect(rowsFor(['year'])).toEqual([]);
  });
});
