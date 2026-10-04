import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

/**
 * Deadlines, cancellation and caps (WP16).
 *
 * The backend that hangs is a real HTTP server that accepts a request and never
 * answers, because the property worth holding is that the deadline reaches the
 * socket — that the run stops *and* the request it was waiting on is torn
 * down — not merely that a promise stopped being awaited.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) ?? null }),
});

const { ExecutionEngine, ExecutionNodeError } = await import('../../src/lib/orchestration/ExecutionEngine.js');
const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');
const { HttpSparqlExecutor } = await import('../../src/server/HttpSparqlExecutor.js');
const { ExecutionAbortedError, abortOnDisconnect, clientDisconnected } = await import('../../src/lib/cancellation.js');
const { QueryTypeIri } = await import('../../src/constants/queryTypes.js');
type ExecutionGraph = import('../../src/lib/orchestration/types.js').ExecutionGraph;
type ResolvedNode = import('../../src/lib/orchestration/types.js').ResolvedNode;
type ResolvedEdge = import('../../src/lib/orchestration/types.js').ResolvedEdge;
type ExecutorFactory = import('../../src/lib/orchestration/ExecutorFactory.js').ExecutorFactory;

/** A SPARQL endpoint that takes every request and answers none. */
async function hangingEndpoint() {
  const closed: Promise<void>[] = [];
  const server = http.createServer((request) => {
    closed.push(new Promise(resolve => request.socket.once('close', () => resolve())));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/sparql`,
    /** Resolves once every connection the server saw has been closed. */
    allClosed: () => Promise.all(closed),
    requests: () => closed.length,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

function groupOver(executor: unknown): { graph: ExecutionGraph; factory: ExecutorFactory } {
  const node = (id: string, raw: Record<string, unknown>, rest: Partial<ResolvedNode> = {}): ResolvedNode => ({
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
  });
  const query = node('remote', { '@type': 'QueryNode', name: 'Remote leg' }, {
    backendId: 'urn:sqlib:backend:remote',
    queryVersionId: 'urn:qv:remote',
    queryString: 'SELECT * WHERE { ?s ?p ?o }',
    queryType: QueryTypeIri.select,
    outputTupleIds: ['urn:io:out'],
  });
  const end = node('end', { '@type': 'EndNode', inputs: ['urn:io:out'] });
  const edge: ResolvedEdge = {
    id: 'e1', raw: {} as ResolvedEdge['raw'], sourceNodeId: 'remote', targetNodeId: 'end',
    dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: 'urn:io:out', targetInputId: 'urn:io:out',
  };
  return {
    graph: {
      groupVersion: {} as ExecutionGraph['groupVersion'],
      nodes: new Map([['remote', query], ['end', end]]),
      edges: [edge],
      incomingEdges: new Map([['end', [edge]]]),
      outgoingEdges: new Map([['remote', [edge]]]),
      startNodeIds: ['remote'],
      endNodeIds: ['end'],
    },
    factory: { getExecutorForNode: vi.fn().mockResolvedValue(executor) } as unknown as ExecutorFactory,
  };
}

describe('a group run against a backend that never answers', () => {
  let endpoint: Awaited<ReturnType<typeof hangingEndpoint>>;
  beforeEach(async () => { endpoint = await hangingEndpoint(); });
  afterEach(async () => { await endpoint.close(); });

  it('is aborted at its deadline, naming the node, and the request is torn down', async () => {
    const { graph, factory } = groupOver(new HttpSparqlExecutor({ queryUrl: endpoint.url }));

    const started = performance.now();
    const failure = await new ExecutionEngine(factory).execute(graph, [], undefined, { deadlineMs: 200 })
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(ExecutionNodeError);
    expect((failure as InstanceType<typeof ExecutionNodeError>).nodeId).toBe('remote');
    const cause = (failure as Error).cause;
    expect(cause).toBeInstanceOf(ExecutionAbortedError);
    expect((cause as InstanceType<typeof ExecutionAbortedError>).statusCode).toBe(504);
    expect(performance.now() - started).toBeLessThan(5000);

    // The signal reached undici: the connection is closed, not left open.
    expect(endpoint.requests()).toBe(1);
    await endpoint.allClosed();
  });

  it('is cancelled when its caller goes away', async () => {
    const { graph, factory } = groupOver(new HttpSparqlExecutor({ queryUrl: endpoint.url }));
    const caller = new AbortController();

    const running = new ExecutionEngine(factory).execute(graph, [], undefined, { signal: caller.signal, deadlineMs: 0 });
    setTimeout(() => caller.abort(clientDisconnected()), 50);

    await expect(running).rejects.toMatchObject({
      name: 'ExecutionNodeError',
      nodeId: 'remote',
      cause: { statusCode: 499 },
    });
    await endpoint.allClosed();
  });
});

describe('rule set runs', () => {
  const PREFIX = 'PREFIX : <http://ex/>';
  const rule = (id: string, ruleString: string) => {
    const $id = `urn:test:rule-version:${id}`;
    hoisted.entities.set($id, {
      $id, '@type': 'RuleVersion', isPartOf: `urn:test:rule:${id}`, version: 1,
      ruleString: `${PREFIX}\n${ruleString}`, grammarValid: true,
    });
    return $id;
  };
  const ruleSetVersion = (hasRule: string[]) => ({
    $id: 'urn:test:rule-set-version:1', '@type': 'RuleSetVersion', isPartOf: 'urn:test:rule-set:1',
    version: 1, hasRule, hasDataBlock: [],
  }) as never;
  // Transitive closure over a six-link chain: several passes to converge.
  const chain = ['a', 'b', 'c', 'd', 'e', 'f']
    .map((from, index) => `<http://ex/${from}> <http://ex/parent> <http://ex/${'abcdefg'[index + 1]}> .`)
    .join('\n');
  const closure = () => [
    rule('anc-base', 'RULE { ?x :anc ?z } WHERE { ?x :parent ?z }'),
    rule('anc-step', 'RULE { ?x :anc ?z } WHERE { ?x :anc ?y . ?y :parent ?z }'),
  ];

  beforeEach(() => { hoisted.entities.clear(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('stop at the deployment iteration cap whatever the request asks for', async () => {
    vi.stubEnv('SQLIB_MAX_RULE_ITERATIONS', '2');

    const result = await new RuleSetExecutor().execute(ruleSetVersion(closure()), {
      initialGraph: chain,
      maxIterations: 10_000,
    });

    expect(result.status).toBe('maxIterations');
    expect(result.maxIterations).toBe(2);
    expect(result.iterations).toHaveLength(2);
  });

  it('start no rule once stopped, and say why', async () => {
    const caller = new AbortController();
    caller.abort(clientDisconnected());

    const result = await new RuleSetExecutor().execute(ruleSetVersion(closure()), {
      initialGraph: chain,
      signal: caller.signal,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Execution cancelled: the client disconnected');
    expect(result.iterations).toHaveLength(0);
  });

  it('report each rule\'s quads only under trace', async () => {
    const ids = closure();
    const plain = await new RuleSetExecutor().execute(ruleSetVersion(ids), { initialGraph: chain, maxIterations: 25 });
    const traced = await new RuleSetExecutor().execute(ruleSetVersion(ids), { initialGraph: chain, maxIterations: 25, trace: true });

    // The same inferred graph and the same passes either way.
    expect(plain.status).toBe('converged');
    expect(plain.finalGraphNQuads).toBe(traced.finalGraphNQuads);
    expect(plain.iterations.map(i => i.tripleCount)).toEqual(traced.iterations.map(i => i.tripleCount));

    const firstRule = (result: typeof plain) => result.iterations[0]!.rules[0]!;
    expect(firstRule(traced).insertedQuads.length).toBeGreaterThan(0);
    expect(firstRule(plain).insertedQuads).toEqual([]);
    // The count survives without the quads: a monotone rule's net delta is
    // exactly what it inserted.
    expect(firstRule(plain).triplesInserted).toBe(firstRule(traced).triplesInserted);
  });
});

describe('abortOnDisconnect', () => {
  const response = (finished: boolean) => Object.assign(new EventEmitter(), { writableFinished: finished });

  it('fires when the response closes before it was written', () => {
    const res = response(false);
    const { signal } = abortOnDisconnect(res);
    res.emit('close');
    expect(signal.aborted).toBe(true);
    expect((signal.reason as InstanceType<typeof ExecutionAbortedError>).statusCode).toBe(499);
  });

  it('does not fire for a response that finished normally', () => {
    const res = response(true);
    const { signal } = abortOnDisconnect(res);
    res.emit('close');
    expect(signal.aborted).toBe(false);
  });
});
