/**
 * `/execute` answers a SELECT in the results format the caller's Accept names.
 *
 * It used to send SPARQL JSON whenever the backend did: always for Oxigraph,
 * always for a query group (whose nodes chain JSON), and for any HTTP endpoint
 * that ignored the Accept it was forwarded. The format is now rendered from
 * that JSON. A string the endpoint already rendered is passed through.
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

const backend = {
  $id: 'urn:sqlib:backend:svc', '@type': 'Backend', name: 'B',
  backendType: BackendTypeIri.http, endpoint: 'http://example.org/sparql',
};

const ROWS = {
  head: { vars: ['city', 'pop'] },
  results: {
    bindings: [
      {
        city: { type: 'uri', value: 'http://example.org/Perth' },
        pop: { type: 'literal', value: '2000000', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
      },
      { city: { type: 'literal', value: 'Hobart, TAS' } },
    ],
  },
};

function seed() {
  store.clear();
  store.set(LIBRARY, { $id: LIBRARY, '@type': 'Library', name: 'Lib' });
  store.set(backend.$id, backend);
  store.set(GROUP_VERSION, { $id: GROUP_VERSION, '@type': 'QueryGroupVersion', isPartOf: GROUP, executionNodes: [] });
  store.set(GROUP, { $id: GROUP, '@type': 'QueryGroup', name: 'G', isPartOf: LIBRARY, currentVersion: GROUP_VERSION });
  store.set(QUERY_VERSION, {
    $id: QUERY_VERSION, '@type': 'QueryVersion', isPartOf: QUERY, version: 1,
    queryString: 'SELECT * WHERE { ?city ?p ?pop }', queryType: QueryTypeIri.select,
  });
  store.set(QUERY, { $id: QUERY, '@type': 'Query', name: 'Q', isPartOf: LIBRARY, currentVersion: QUERY_VERSION });
}

describe('POST /execute — SELECT results formats', () => {
  let app: FastifyInstance;
  let selectQueryParsed: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    seed();
    vi.clearAllMocks();
    hoisted.mockGet.mockImplementation((id: string) => store.get(id) ?? null);
    groupExecution.buildFromGroupVersion.mockReturnValue({ nodes: new Map(), endNodeIds: [] });
    groupExecution.execute.mockResolvedValue({ result: ROWS, resultNodeId: null });
    // The backend ignores the Accept it is sent, as Oxigraph always does.
    selectQueryParsed = vi.fn().mockResolvedValue({
      result: ROWS, duration: 1, contentType: 'application/sparql-results+json',
    });
    executorFactoryInstance.getExecutorForNode.mockResolvedValue({
      selectQueryParsed, constructQueryParsed: vi.fn(), askQuery: vi.fn(), update: vi.fn(),
    });
    app = Fastify({ logger: false });
    setupValidator(app);
    await app.register(executeRoutes, { prefix: '/execute' });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  const run = (targetId: string, accept?: string) =>
    app.inject({
      method: 'POST',
      url: '/execute/',
      payload: targetId === GROUP ? { targetId } : { targetId, backendId: backend.$id },
      headers: accept ? { accept } : {},
    });

  const CSV = 'city,pop\r\nhttp://example.org/Perth,2000000\r\n"Hobart, TAS",\r\n';

  describe.each([
    ['a query', QUERY],
    ['a query group', GROUP],
  ])('for %s', (_label, targetId) => {
    it('answers CSV to Accept: text/csv', async () => {
      const res = await run(targetId, 'text/csv');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.body).toBe(CSV);
    });

    it('answers TSV to Accept: text/tab-separated-values', async () => {
      const res = await run(targetId, 'text/tab-separated-values');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/tab-separated-values; charset=utf-8');
      expect(res.body.split('\n')[0]).toBe('?city\t?pop');
      expect(res.body).toContain('<http://example.org/Perth>\t"2000000"^^<http://www.w3.org/2001/XMLSchema#integer>');
    });

    it('answers SPARQL XML to Accept: application/sparql-results+xml', async () => {
      const res = await run(targetId, 'application/sparql-results+xml');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/sparql-results+xml; charset=utf-8');
      expect(res.body).toContain('<binding name="city"><uri>http://example.org/Perth</uri></binding>');
    });

    it('still answers SPARQL JSON with no Accept, a wildcard, or JSON asked for', async () => {
      for (const accept of [undefined, '*/*', 'application/sparql-results+json']) {
        const res = await run(targetId, accept);
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('application/sparql-results+json');
        expect(res.json()).toEqual(ROWS);
      }
    });
  });

  it('forwards the Accept to the backend and passes through what it rendered', async () => {
    const endpointCsv = 'city\r\nhttp://example.org/Sydney\r\n';
    selectQueryParsed.mockResolvedValue({ result: endpointCsv, duration: 1, contentType: 'text/csv' });

    const res = await run(QUERY, 'text/csv');

    expect(selectQueryParsed.mock.calls[0]?.[1]?.acceptHeader).toBe('text/csv');
    expect(res.headers['content-type']).toBe('text/csv');
    expect(res.body).toBe(endpointCsv);
  });
});
