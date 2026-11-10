/**
 * `/execute` hands every finished run to `recordQueryRun` (lib/slowQueryLog.ts),
 * which puts it on the request span and writes the slow query line. This checks
 * what the route passes: the version that ran, the backend, the row count and
 * the saved text, not the text with arguments bound.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import executeRoutes from '../../src/routes/execute.js';
import { setupValidator } from '../../src/lib/validator-setup.js';

const { executorFactoryInstance, recordQueryRun, mockGet } = vi.hoisted(() => ({
  executorFactoryInstance: { getExecutorForNode: vi.fn(), getExecutorForNodeSync: vi.fn() },
  recordQueryRun: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock('../../src/lib/orchestration/ExecutorFactory.js', () => ({
  ExecutorFactory: vi.fn(function () { return executorFactoryInstance; }),
}));
vi.mock('../../src/lib/slowQueryLog.js', () => ({ recordQueryRun }));
vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: mockGet }),
}));

const LIBRARY = 'urn:sqlib:library:lib1';
const QUERY = 'urn:sqlib:query:q1';
const QUERY_VERSION = 'urn:sqlib:query-version:qv1';
const QUERY_TEXT = 'SELECT ?s WHERE { VALUES ?s { UNDEF } ?s ?p ?o }';
const backend = {
  $id: 'urn:sqlib:backend:svc', '@type': 'Backend', name: 'B',
  backendType: BackendTypeIri.http, endpoint: 'http://example.org/sparql',
};
const ROWS = {
  head: { vars: ['s'] },
  results: { bindings: [{ s: { type: 'uri', value: 'http://ex/a' } }, { s: { type: 'uri', value: 'http://ex/b' } }] },
};
const ARGUMENTS = [{ head: { vars: ['s'] }, results: { bindings: [{ s: { type: 'uri', value: 'http://ex/a' } }] } }];

const store = new Map<string, Record<string, unknown>>([
  [LIBRARY, { $id: LIBRARY, '@type': 'Library', name: 'Lib' }],
  [backend.$id, backend],
  [QUERY_VERSION, {
    $id: QUERY_VERSION, '@type': 'QueryVersion', isPartOf: QUERY, version: 1,
    queryString: QUERY_TEXT, queryType: QueryTypeIri.select,
  }],
  [QUERY, { $id: QUERY, '@type': 'Query', name: 'Q', isPartOf: LIBRARY, currentVersion: QUERY_VERSION }],
]);

describe('POST /execute — run record for observability', () => {
  let app: FastifyInstance;
  let selectQueryParsed: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGet.mockImplementation((id: string) => store.get(id) ?? null);
    selectQueryParsed = vi.fn().mockResolvedValue({ result: ROWS, duration: 3, contentType: 'application/sparql-results+json' });
    executorFactoryInstance.getExecutorForNode.mockResolvedValue({
      selectQueryParsed, constructQueryParsed: vi.fn(), askQuery: vi.fn(), update: vi.fn(),
    });
    app = Fastify({ logger: false });
    setupValidator(app);
    await app.register(executeRoutes, { prefix: '/execute' });
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('records the version, backend, rows and saved text of a run', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: { targetId: QUERY, backendId: backend.$id, arguments: ARGUMENTS },
    });
    expect(response.statusCode, response.body).toBe(200);

    expect(recordQueryRun).toHaveBeenCalledTimes(1);
    const [, record] = recordQueryRun.mock.calls[0];
    expect(record).toMatchObject({
      targetId: QUERY,
      targetType: 'Query',
      versionId: QUERY_VERSION,
      environment: null,
      backendId: backend.$id,
      backendType: 'http',
      status: 'success',
      rowCount: 2,
      queryText: QUERY_TEXT,
      arguments: ARGUMENTS,
    });
    expect(record.durationMs).toBeGreaterThan(0);
    expect(record.backendDurationMs).toBe(3);
    // The backend got the text with the argument bound; the record keeps the
    // saved text, so it matches what the version IRI fetches.
    expect(selectQueryParsed.mock.calls[0][0]).not.toBe(QUERY_TEXT);
  });

  it('records a failed run as a failure', async () => {
    selectQueryParsed.mockRejectedValue(new Error('backend down'));
    await app.inject({ method: 'POST', url: '/execute/', payload: { targetId: QUERY, backendId: backend.$id } });
    expect(recordQueryRun.mock.calls[0][1]).toMatchObject({ status: 'failure', versionId: QUERY_VERSION });
  });
});
