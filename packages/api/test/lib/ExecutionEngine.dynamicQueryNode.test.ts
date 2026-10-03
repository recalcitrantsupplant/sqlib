import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ExecutionEngine, ExecutionNodeError } from '../../src/lib/orchestration/ExecutionEngine.js';
import type { ExecutionGraph, ResolvedEdge, ResolvedNode } from '../../src/lib/orchestration/types.js';
import type { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import type { RuleSetExecutor } from '../../src/lib/RuleSetExecutor.js';
import type { SparqlQueryParser } from '../../src/lib/parser.js';
import type { ExecutionAuthScope } from '../../src/auth/executionScope.js';
import type { AuthContext, LibraryMode } from '../../src/auth/types.js';
import { QueryTypeIri, type QueryTypeValue } from '../../src/constants/queryTypes.js';

/**
 * What a DynamicQueryNode may be pointed at.
 *
 * The QUERY_ID value that picks a dynamic node's query is data, and may be the
 * caller's own. So the version it names has to be one the group could have
 * wired in statically (its own library) or one the caller could run directly
 * (a library they may `execute`), and it has to produce what the node's
 * outgoing edges carry — never an UPDATE.
 */

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: hoisted.get }),
}));

const MINE = 'urn:sqlib:library:mine';
const THEIRS = 'urn:sqlib:library:theirs';
const GROUP_VERSION = 'urn:group:1:v1';
const QID_OUT = 'urn:io:qid-out';
const QID_IN = 'urn:io:qid-in';

const typeOf = (node: ResolvedNode): string | undefined =>
  (node.raw as { '@type'?: string })['@type'];

function edge(partial: Partial<ResolvedEdge> & Pick<ResolvedEdge, 'id' | 'sourceNodeId' | 'targetNodeId'>): ResolvedEdge {
  return { raw: {} as unknown as ResolvedEdge['raw'], ...partial } as ResolvedEdge;
}

function node(id: string, type: string, fields: Partial<ResolvedNode> = {}): ResolvedNode {
  return {
    id,
    raw: { '@type': type, $id: id } as ResolvedNode['raw'],
    backendId: undefined,
    queryVersionId: undefined,
    queryVersion: undefined,
    queryString: undefined,
    queryType: undefined,
    inputTupleIds: [],
    outputTupleIds: [],
    ...fields,
  };
}

function graphOf(nodes: ResolvedNode[], edges: ResolvedEdge[], groupVersion: unknown): ExecutionGraph {
  const incomingEdges = new Map<string, ResolvedEdge[]>();
  const outgoingEdges = new Map<string, ResolvedEdge[]>();
  for (const e of edges) {
    if (!outgoingEdges.has(e.sourceNodeId)) outgoingEdges.set(e.sourceNodeId, []);
    outgoingEdges.get(e.sourceNodeId)!.push(e);
    if (!incomingEdges.has(e.targetNodeId)) incomingEdges.set(e.targetNodeId, []);
    incomingEdges.get(e.targetNodeId)!.push(e);
  }
  return {
    groupVersion: groupVersion as ExecutionGraph['groupVersion'],
    nodes: new Map(nodes.map(n => [n.id, n])),
    edges,
    incomingEdges,
    outgoingEdges,
    startNodeIds: nodes.filter(n => typeOf(n) === 'StartNode').map(n => n.id),
    endNodeIds: nodes.filter(n => typeOf(n) === 'EndNode').map(n => n.id),
  };
}

function requestWith(libraries: Record<string, LibraryMode[]>): FastifyRequest {
  const context: AuthContext = {
    subject: 'urn:sqlib:principal:user:alice',
    principals: ['urn:sqlib:principal:user:alice'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map(),
      libraries: new Map(Object.entries(libraries).map(([iri, modes]) => [iri, new Set(modes)])),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
  return {
    id: 'req-1',
    method: 'POST',
    url: '/execute',
    log: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
    authContext: context,
  } as unknown as FastifyRequest;
}

describe('ExecutionEngine — DynamicQueryNode resolution guard', () => {
  let cache: Map<string, Record<string, unknown>>;
  let executor: {
    selectQueryParsed: ReturnType<typeof vi.fn>;
    constructQueryParsed: ReturnType<typeof vi.fn>;
    askQuery: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let parser: { detectInputs: ReturnType<typeof vi.fn>; applyArguments: ReturnType<typeof vi.fn> };

  const chosenRows = { head: { vars: ['value'] }, results: { bindings: [] } };

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new Map<string, Record<string, unknown>>();
    hoisted.get.mockImplementation((id: string) => cache.get(id) ?? null);

    cache.set(MINE, { $id: MINE, '@type': 'Library' });
    cache.set(THEIRS, { $id: THEIRS, '@type': 'Library' });
    cache.set('urn:group:1', { $id: 'urn:group:1', '@type': 'QueryGroup', isPartOf: MINE });
    cache.set(GROUP_VERSION, { $id: GROUP_VERSION, '@type': 'QueryGroupVersion', isPartOf: 'urn:group:1' });

    // The source node's single-variable output that carries the chosen id.
    cache.set(QID_OUT, { $id: QID_OUT, '@type': 'QueryOutputTuple', memberEntries: ['urn:member:qid'] });
    cache.set('urn:member:qid', { '@type': 'TupleMember', position: 0, variable: 'urn:var:qid' });
    cache.set('urn:var:qid', { '@type': 'QueryOutputVariable', variableName: 'queryId' });
    cache.set(QID_IN, { $id: QID_IN, '@type': 'QueryIdInput' });

    executor = {
      selectQueryParsed: vi.fn(),
      constructQueryParsed: vi.fn().mockResolvedValue({ result: '' }),
      askQuery: vi.fn().mockResolvedValue({ result: true }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    parser = { detectInputs: vi.fn().mockReturnValue({ valuesInputs: [] }), applyArguments: vi.fn((q: string) => q) };
  });

  function engineFor(callerScope?: ExecutionAuthScope): ExecutionEngine {
    return new ExecutionEngine(
      { getExecutorForNode: vi.fn().mockResolvedValue(executor), callerScope } as unknown as ExecutorFactory,
      parser as unknown as SparqlQueryParser,
      { execute: vi.fn() } as unknown as RuleSetExecutor,
    );
  }

  /** A saved query in `library` and its version, returned as the version id. */
  function savedQuery(id: string, library: string, queryType: QueryTypeValue, queryString: string): string {
    cache.set(id, { $id: id, '@type': 'Query', isPartOf: [library] });
    const versionId = `${id}:v1`;
    cache.set(versionId, { $id: versionId, '@type': 'QueryVersion', isPartOf: id, version: 1, queryString, queryType });
    return versionId;
  }

  /**
   * Start → source → dynamic → End. The source's SELECT answers with the id
   * of `chosen`, and the dynamic node's result leaves along `outFlow`.
   */
  function dynamicGroup(chosen: string, outFlow: ResolvedEdge['dataFlowType'] = 'VARIABLE_BINDINGS') {
    executor.selectQueryParsed
      .mockResolvedValueOnce({
        result: { head: { vars: ['queryId'] }, results: { bindings: [{ queryId: { type: 'uri', value: chosen } }] } },
      })
      .mockResolvedValue({ result: chosenRows });

    const nodes = [
      node('start', 'StartNode'),
      node('source', 'QueryNode', {
        backendId: 'urn:backend:1',
        queryString: 'SELECT ?queryId WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        outputTupleIds: [QID_OUT],
      }),
      node('dynamic', 'DynamicQueryNode', {
        backendId: 'urn:backend:1',
        queryString: 'SELECT ?placeholder WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.select,
        inputTupleIds: [QID_IN],
        outputTupleIds: ['urn:io:dynamic-out'],
      }),
      { ...node('end', 'EndNode'), raw: { '@type': 'EndNode', $id: 'end', inputs: ['urn:io:dynamic-out'] } as ResolvedNode['raw'] },
    ];
    const edges = [
      edge({ id: 'e-start', sourceNodeId: 'start', targetNodeId: 'source', dataFlowType: 'CONTROL_FLOW' }),
      edge({
        id: 'e-qid', sourceNodeId: 'source', targetNodeId: 'dynamic', dataFlowType: 'QUERY_ID',
        sourceOutputId: QID_OUT, targetInputId: QID_IN,
      }),
      edge({
        id: 'e-end', sourceNodeId: 'dynamic', targetNodeId: 'end', dataFlowType: outFlow,
        sourceOutputId: 'urn:io:dynamic-out', targetInputId: 'urn:io:dynamic-out',
      }),
    ];
    return graphOf(nodes, edges, cache.get(GROUP_VERSION));
  }

  it('runs a SELECT version from the group\'s own library', async () => {
    const chosen = savedQuery('urn:query:mine', MINE, QueryTypeIri.select, 'SELECT ?value WHERE { ?s ?p ?o }');

    const result = await engineFor().execute(dynamicGroup(chosen));

    expect(result).toEqual({ result: chosenRows, resultNodeId: 'dynamic' });
    expect(executor.selectQueryParsed).toHaveBeenLastCalledWith('SELECT ?value WHERE { ?s ?p ?o }', { signal: expect.any(AbortSignal) });
  });

  /*
   * An internal run has no caller whose grants could widen its reach, so it is
   * held to the group's library.
   */
  it('refuses a version in another library for an internal run', async () => {
    const chosen = savedQuery('urn:query:theirs', THEIRS, QueryTypeIri.select, 'SELECT ?secret WHERE { ?s ?p ?o }');

    const run = engineFor().execute(dynamicGroup(chosen));

    await expect(run).rejects.toBeInstanceOf(ExecutionNodeError);
    await expect(run).rejects.toThrow(/not to this group's library/);
    expect(vi.mocked(executor.selectQueryParsed).mock.calls.map(call => call[0])).not.toContain('SELECT ?secret WHERE { ?s ?p ?o }');
  });

  it('refuses a version in a library the caller may not execute', async () => {
    const chosen = savedQuery('urn:query:theirs', THEIRS, QueryTypeIri.select, 'SELECT ?secret WHERE { ?s ?p ?o }');
    const scope = { request: requestWith({ [MINE]: ['read', 'execute'] }), viaLibrary: MINE };

    const run = engineFor(scope).execute(dynamicGroup(chosen));

    await expect(run).rejects.toBeInstanceOf(ExecutionNodeError);
    await expect(run).rejects.toThrow(/Missing "execute" permission on library urn:sqlib:library:theirs/);
    expect(vi.mocked(executor.selectQueryParsed).mock.calls.map(call => call[0])).not.toContain('SELECT ?secret WHERE { ?s ?p ?o }');
  });

  /* The caller could run that query directly, so reaching it through a group grants nothing new. */
  it('runs a version in another library the caller may execute', async () => {
    const chosen = savedQuery('urn:query:theirs', THEIRS, QueryTypeIri.select, 'SELECT ?value WHERE { ?s ?p ?o }');
    const scope = {
      request: requestWith({ [MINE]: ['read', 'execute'], [THEIRS]: ['read', 'execute'] }),
      viaLibrary: MINE,
    };

    const result = await engineFor(scope).execute(dynamicGroup(chosen));

    expect(result).toEqual({ result: chosenRows, resultNodeId: 'dynamic' });
  });

  it('refuses an UPDATE version, even from the group\'s own library', async () => {
    const chosen = savedQuery('urn:query:wipe', MINE, QueryTypeIri.update, 'DELETE WHERE { ?s ?p ?o }');

    const run = engineFor().execute(dynamicGroup(chosen));

    await expect(run).rejects.toBeInstanceOf(ExecutionNodeError);
    await expect(run).rejects.toThrow(/cannot run UPDATE QueryVersion/);
    expect(executor.update).not.toHaveBeenCalled();
  });

  it('refuses a version whose results its outgoing edge cannot carry', async () => {
    const chosen = savedQuery('urn:query:graph', MINE, QueryTypeIri.construct, 'CONSTRUCT WHERE { ?s ?p ?o }');

    await expect(engineFor().execute(dynamicGroup(chosen, 'VARIABLE_BINDINGS')))
      .rejects.toThrow(/of type CONSTRUCT, which its VARIABLE_BINDINGS edge e-end cannot carry/);
    expect(executor.constructQueryParsed).not.toHaveBeenCalled();
  });

  /* Dispatched by the resolved query's type, not by the placeholder's SELECT. */
  it('runs a CONSTRUCT version along an RDF_GRAPH edge', async () => {
    const chosen = savedQuery('urn:query:graph', MINE, QueryTypeIri.construct, 'CONSTRUCT WHERE { ?s ?p ?o }');
    executor.constructQueryParsed.mockResolvedValue({ result: '<urn:s> <urn:p> <urn:o> .\n' });

    const result = await engineFor().execute(dynamicGroup(chosen, 'RDF_GRAPH'));

    expect(result).toEqual({ result: '<urn:s> <urn:p> <urn:o> .\n', resultNodeId: 'dynamic' });
    expect(executor.constructQueryParsed).toHaveBeenCalledWith('CONSTRUCT WHERE { ?s ?p ?o }', { acceptHeader: undefined, signal: expect.any(AbortSignal) });
  });

  describe('unrouted tables beside a dynamic node', () => {
    /** A QueryInputTuple port declaring `vars`. */
    function tuplePort(id: string, vars: string[]) {
      const memberEntries = vars.map((name, position) => {
        cache.set(`${id}#var-${name}`, { '@type': 'QueryInputVariable', variableName: name });
        cache.set(`${id}#member-${position}`, { '@type': 'TupleMember', position, variable: `${id}#var-${name}` });
        return `${id}#member-${position}`;
      });
      cache.set(id, { $id: id, '@type': 'QueryInputTuple', memberEntries });
      return id;
    }

    /** The dynamic group, with the source reading `?city` and the dynamic node declaring a `?year` port. */
    function groupWithClauses(chosen: string): ExecutionGraph {
      const graph = dynamicGroup(chosen);
      graph.nodes.get('source')!.queryString = 'SELECT ?queryId WHERE { VALUES ?city { UNDEF } ?s ?p ?city }';
      graph.nodes.get('dynamic')!.inputTupleIds.push(tuplePort('urn:io:year', ['year']));
      parser.detectInputs.mockImplementation((text: string) => ({
        valuesInputs: text.includes('VALUES ?city') ? [['city']] : [],
      }));
      return graph;
    }

    const table = (name: string) => ({
      head: { vars: [name] },
      arguments: { bindings: [{ [name]: { type: 'uri' as const, value: `http://ex/${name}` } }] },
    });

    /*
     * A dynamic node used to switch the whole check off, so a stray table
     * beside one was silently dropped by every static node in the group.
     */
    it('still refuses a table no node can take', async () => {
      const chosen = savedQuery('urn:query:mine', MINE, QueryTypeIri.select, 'SELECT ?value WHERE { ?s ?p ?o }');

      await expect(engineFor().execute(groupWithClauses(chosen), [table('city'), table('spare')]))
        .rejects.toThrow(/fill no input the query group declares: \(\?spare\)/);
      expect(executor.selectQueryParsed).not.toHaveBeenCalled();
    });

    /* The dynamic node's own clauses are unknowable, so a table for a port it declares goes through. */
    it('lets through a table for a port the dynamic node declares', async () => {
      const chosen = savedQuery('urn:query:mine', MINE, QueryTypeIri.select, 'SELECT ?value WHERE { ?s ?p ?o }');

      const result = await engineFor().execute(groupWithClauses(chosen), [table('city'), table('year')]);

      expect(result).toEqual({ result: chosenRows, resultNodeId: 'dynamic' });
    });
  });
});
