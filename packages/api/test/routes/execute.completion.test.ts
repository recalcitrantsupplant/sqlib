/**
 * A run is an argument set plus anything it left open.
 *
 * `/execute` used to refuse `argumentSetIds` combined with any inline value at
 * all. Too coarse: a set may deliberately leave a parameter unfilled — the
 * `partial` verdict the switcher already computes — and completing it at run
 * time is how one set serves several fixtures without becoming several sets.
 * What is worth refusing is an *overlap*, where either precedence rule would
 * surprise half the callers. See `docs/concepts.md`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import Fastify, { FastifyInstance } from 'fastify';
import executeRoutes from '../../src/routes/execute.js';
import { setupValidator } from '../../src/lib/validator-setup.js';

const { executorFactoryInstance } = vi.hoisted(() => ({
  executorFactoryInstance: { getExecutorForNode: vi.fn(), getExecutorForNodeSync: vi.fn() },
}));

vi.mock('../../src/lib/orchestration/ExecutorFactory.js', () => ({
  ExecutorFactory: vi.fn(function () { return executorFactoryInstance; }),
}));

const groupExecution = vi.hoisted(() => ({
  buildFromGroupVersion: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../../src/lib/orchestration/GraphBuilder.js', () => ({
  GraphBuilder: vi.fn(function () { return { buildFromGroupVersion: groupExecution.buildFromGroupVersion }; }),
}));

vi.mock('../../src/lib/orchestration/ExecutionEngine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/orchestration/ExecutionEngine.js')>();
  return { ...actual, ExecutionEngine: vi.fn(function () { return { execute: groupExecution.execute }; }) };
});

const hoisted = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: hoisted.mockGet }),
}));

const store = new Map<string, Record<string, unknown>>();

const LIBRARY = 'urn:sqlib:library:lib1';
const GROUP = 'urn:sqlib:query-group:g1';
const GROUP_VERSION = 'urn:sqlib:query-group-version:gv1';
const QUERY = 'urn:sqlib:query:q1';
const QUERY_VERSION = 'urn:sqlib:query-version:qv1';
const NODE = 'urn:sqlib:query-node:n1';
const MEMBER_VERSION = 'urn:sqlib:query-version:member1';
const GRAPH_VERSION = 'urn:sqlib:data-graph-version:dgv1';
const TURTLE = '<http://ex/a> <http://ex/p> <http://ex/b> .';

const backend = {
  $id: 'urn:sqlib:backend:svc', '@type': 'Backend', name: 'B',
  backendType: BackendTypeIri.http, endpoint: 'http://example.org/sparql',
};

/** One saved set: a `?city` table and a LIMIT named `10`. */
function seedArgumentSet(id: string, opts: { table?: boolean; limit?: boolean }) {
  const versionId = `${id}-v1`;
  const tupleBindings: string[] = [];
  const scalarBindings: string[] = [];

  if (opts.table) {
    const bindingId = `${id}-tb`;
    store.set(bindingId, {
      $id: bindingId, '@type': 'ArgumentTupleBinding', tupleSignature: 'city',
      fallbackVariables: ['city'],
      contentString: JSON.stringify({
        head: { vars: ['city'] },
        results: { bindings: [{ city: { type: 'literal', value: 'Perth' } }] },
      }),
    });
    tupleBindings.push(bindingId);
  }
  if (opts.limit) {
    const scalarId = `${id}-sb`;
    store.set(scalarId, {
      $id: scalarId, '@type': 'ArgumentScalarBinding',
      parameterKind: 'limit', parameterName: '10', numericValue: 20,
    });
    scalarBindings.push(scalarId);
  }

  store.set(versionId, {
    $id: versionId, '@type': 'ArgumentSetVersion', isPartOf: id, version: 1,
    tupleBindings, scalarBindings,
  });
  store.set(id, {
    $id: id, '@type': 'ArgumentSet', name: 'Set', isPartOf: LIBRARY, currentVersion: versionId,
  });
  return id;
}

function seed() {
  store.clear();
  store.set(LIBRARY, { $id: LIBRARY, '@type': 'Library', name: 'Lib' });
  store.set(backend.$id, backend);
  store.set(GRAPH_VERSION, {
    $id: GRAPH_VERSION, '@type': 'DataGraphVersion',
    contentString: TURTLE, contentFormat: 'text/turtle', tripleCount: 1,
  });
  // A group whose one member declares LIMIT 00010.
  store.set(MEMBER_VERSION, {
    $id: MEMBER_VERSION, '@type': 'QueryVersion',
    queryString: 'SELECT * WHERE { ?s ?p ?o } LIMIT 00010',
  });
  store.set(NODE, { $id: NODE, '@type': 'QueryNode', queryId: MEMBER_VERSION });
  store.set(GROUP_VERSION, {
    $id: GROUP_VERSION, '@type': 'QueryGroupVersion', isPartOf: GROUP, executionNodes: [NODE],
  });
  store.set(GROUP, { $id: GROUP, '@type': 'QueryGroup', name: 'G', isPartOf: LIBRARY, currentVersion: GROUP_VERSION });
  store.set(QUERY_VERSION, {
    $id: QUERY_VERSION, '@type': 'QueryVersion', isPartOf: QUERY, version: 1,
    queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: QueryTypeIri.select,
  });
  store.set(QUERY, { $id: QUERY, '@type': 'Query', name: 'Q', isPartOf: LIBRARY, currentVersion: QUERY_VERSION });
}

describe('POST /execute — completing an argument set', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    seed();
    vi.clearAllMocks();
    hoisted.mockGet.mockImplementation((id: string) => store.get(id) ?? null);
    groupExecution.buildFromGroupVersion.mockReturnValue({ nodes: new Map(), endNodeIds: [] });
    groupExecution.execute.mockResolvedValue({ result: { head: { vars: [] }, results: { bindings: [] } }, resultNodeId: null });
    executorFactoryInstance.getExecutorForNode.mockResolvedValue({
      selectQueryParsed: vi.fn().mockResolvedValue({ result: { head: { vars: [] }, results: { bindings: [] } }, duration: 1 }),
      constructQueryParsed: vi.fn(), askQuery: vi.fn(), update: vi.fn(),
    });
    app = Fastify({ logger: false });
    setupValidator(app);
    await app.register(executeRoutes, { prefix: '/execute' });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  const run = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/execute/', payload });

  /** The options the group engine was actually handed. */
  const engineOptions = () => groupExecution.execute.mock.calls[0]?.[3] as {
    limits?: Array<{ name: string; value: number }>;
    dataGraphs?: Array<{ content: string; format: string }>;
  } | undefined;

  it('merges an inline number with a set that fills only a table', async () => {
    const setId = seedArgumentSet('urn:sqlib:argument-set:table-only', { table: true });

    const res = await run({
      targetId: GROUP,
      argumentSetIds: [setId],
      limits: [{ name: '10', value: 5 }],
    });

    expect(res.statusCode).toBe(200);
    expect(engineOptions()?.limits).toEqual([{ name: '10', value: 5 }]);
  });

  it('refuses an inline number for a parameter the set already fills, naming it', async () => {
    const setId = seedArgumentSet('urn:sqlib:argument-set:with-limit', { limit: true });

    const res = await run({
      targetId: GROUP,
      argumentSetIds: [setId],
      limits: [{ name: '10', value: 5 }],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/already fills LIMIT parameter '10'/);
  });

  /*
   * A set carries no graphs, so a group's graphs arrive in `dataGraphs[]` and
   * nowhere else, and a set beside them never conflicts.
   */
  it('passes a run\'s graphs to the engine beside a named set', async () => {
    const setId = seedArgumentSet('urn:sqlib:argument-set:table-for-graph', { table: true });

    const res = await run({
      targetId: GROUP,
      argumentSetIds: [setId],
      dataGraphs: [{ dataGraphVersionId: GRAPH_VERSION }],
    });

    expect(res.statusCode).toBe(200);
    expect(engineOptions()?.dataGraphs).toHaveLength(1);
  });

  /*
   * A query given graphs runs over them alone, in a store made for the request.
   * Naming a real backend beside them is refused rather than ignored: the
   * query would not see that backend, and silently not using it answers a
   * different question from the one asked.
   */
  it('refuses a dataGraphs entry on a query target that also names a backend', async () => {
    const res = await run({
      targetId: QUERY,
      backendId: backend.$id,
      dataGraphs: [{ dataGraphVersionId: GRAPH_VERSION }],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/runs over those graphs alone/);
  });

  it('runs a query over its dataGraphs in an ephemeral store, with no backend named', async () => {
    const res = await run({
      targetId: QUERY,
      dataGraphs: [{ dataGraphVersionId: GRAPH_VERSION }],
    });

    expect(res.statusCode, res.payload).toBe(200);
    expect(res.json().results.bindings).toEqual([{
      s: { type: 'uri', value: 'http://ex/a' },
      p: { type: 'uri', value: 'http://ex/p' },
      o: { type: 'uri', value: 'http://ex/b' },
    }]);
    // The named backend's executor is never asked for.
    expect(executorFactoryInstance.getExecutorForNode).not.toHaveBeenCalled();
  });

  it('loads every graph it is given, inline ones included, and accepts the ephemeral backend by name', async () => {
    const res = await run({
      targetId: QUERY_VERSION,
      backendId: 'urn:sparql-query-lib:backend:ephemeral',
      dataGraphs: [
        { dataGraphVersionId: GRAPH_VERSION },
        { dataGraphInline: '<http://ex/c> <http://ex/p> <http://ex/d> .', dataGraphInlineFormat: 'application/n-triples' },
      ],
    });

    expect(res.statusCode, res.payload).toBe(200);
    expect(res.json().results.bindings).toHaveLength(2);
  });

  it('says what is wrong with a graph that does not parse', async () => {
    const res = await run({
      targetId: QUERY,
      dataGraphs: [{ dataGraphInline: 'this is not turtle', dataGraphInlineFormat: 'text/turtle' }],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });
});
