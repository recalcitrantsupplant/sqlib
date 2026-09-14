import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import testRoutes from '../../src/routes/tests.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import * as oxigraph from 'oxigraph';

const hoisted = vi.hoisted(() => ({
  test: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  testVersion: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  backend: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  coordinatorGet: vi.fn(),
  runTestVersion: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    Test: hoisted.test,
    TestVersion: hoisted.testVersion,
    Backend: hoisted.backend,
  }),
  getCacheCoordinator: () => ({ get: hoisted.coordinatorGet }),
}));

vi.mock('../../src/lib/TestRunner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/TestRunner.js')>();
  return { ...actual, TestRunner: class { runTestVersion = hoisted.runTestVersion; } };
});

const TEST_ID = 'urn:sqlib:test:t1';
const VERSION_ID = 'urn:sqlib:test-version:tv1';

function testCase(overrides: Record<string, unknown> = {}) {
  return {
    caseId: `${VERSION_ID}#case-0`,
    name: 'Case 1',
    position: 0,
    passed: true,
    message: '',
    inputs: {
      argumentSetVersion: 'urn:sqlib:argument-set-version:a1',
      dataGraphVersion: 'urn:sqlib:data-graph-version:d1',
    },
    durationMs: 5,
    ...overrides,
  };
}

const RUN_RESULT = {
  testId: TEST_ID,
  testVersionId: VERSION_ID,
  passed: true,
  message: '',
  expectationKind: 'bindings',
  hermetic: true,
  durationMs: 12,
  subjectVersionId: 'urn:sqlib:query-version:7',
  ranAt: '2026-08-14T09:32:11.000Z',
  cases: [testCase()],
  passedCount: 1,
  failedCount: 0,
};

describe('POST /tests/:id/run — the EARL report', () => {
  let app: FastifyInstance;

  const RUN_URL = `/tests/${encodeURIComponent(TEST_ID)}/run`;
  const EARL = 'http://www.w3.org/ns/earl#';
  const SQLIB = 'https://sparql-query-lib/';

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
      if (error.validation && Array.isArray(error.validation)) {
        return reply.status(statusCode).send({ error: error.validation[0]?.message ?? 'Validation failed' });
      }
      reply.status(statusCode).send({ error: error.message || 'An unexpected error occurred' });
    });
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
    }
    await app.register(testRoutes, { prefix: '/tests' });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.test.get.mockReturnValue({
      $id: TEST_ID,
      '@type': 'Test',
      name: 'T',
      subject: 'urn:sqlib:query:q1',
      subjectKind: 'query',
      currentVersion: VERSION_ID,
      isPartOf: ['urn:sqlib:library:lib1'],
    });
    hoisted.testVersion.list.mockReturnValue([{
      $id: VERSION_ID,
      '@type': 'TestVersion',
      isPartOf: TEST_ID,
      version: 1,
      expectationKind: 'bindings',
      argumentSetVersion: 'urn:sqlib:argument-set-version:a1',
      dataGraphVersion: 'urn:sqlib:data-graph-version:d1',
      backend: null,
    }]);
    hoisted.runTestVersion.mockResolvedValue(RUN_RESULT);
  });

  /** The report as the caller receives it: parsed from the response body. */
  async function report(payload: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST', url: RUN_URL, payload, headers: { accept: 'text/turtle' },
    });
    expect(res.statusCode).toBe(200);
    const store = new oxigraph.Store();
    store.load(res.body, { format: 'text/turtle' });
    return { res, store };
  }

  const objectsOf = (store: oxigraph.Store, predicate: string) =>
    store.match(null, oxigraph.namedNode(predicate), null, null).map(quad => quad.object.value);

  it('answers the run with the report itself', async () => {
    const { res } = await report();

    expect(res.headers['content-type']).toBe('text/turtle; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="test-results.ttl"');
    // Nothing was persisted and nothing had to be nominated: the report is the
    // response, which is the whole point of it being a format.
    expect(res.body).toContain('a earl:Assertion');
  });

  it('leaves the JSON run response alone when EARL was not asked for', async () => {
    const res = await app.inject({ method: 'POST', url: RUN_URL, payload: {} });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json().passed).toBe(true);
  });

  it('asserts once per case, each naming its own case as the criterion', async () => {
    // A parametrised run has one verdict per case. Reporting the run's summary
    // verdict instead would throw away every case but the one it agrees with.
    hoisted.runTestVersion.mockResolvedValue({
      ...RUN_RESULT,
      passed: false,
      message: '1 of 2 cases failed',
      cases: [
        testCase(),
        testCase({
          caseId: `${VERSION_ID}#case-1`,
          name: 'Berlin',
          position: 1,
          passed: false,
          message: '1 missing row',
        }),
      ],
      passedCount: 1,
      failedCount: 1,
    });

    const { store } = await report();

    expect(objectsOf(store, `${EARL}test`).sort()).toEqual([
      `${VERSION_ID}#case-0`,
      `${VERSION_ID}#case-1`,
    ]);
    expect(objectsOf(store, `${EARL}outcome`).sort()).toEqual([`${EARL}failed`, `${EARL}passed`]);
    // Both assertions still say which version they came from.
    expect(objectsOf(store, `${SQLIB}testVersion`)).toEqual([VERSION_ID, VERSION_ID]);
  });

  it('carries the pinned inputs into the report as dimensions', async () => {
    const { store } = await report();

    expect(objectsOf(store, `${SQLIB}refSubject`)).toEqual(['urn:sqlib:query:q1']);
    expect(objectsOf(store, `${SQLIB}refArgumentSet`)).toEqual(['urn:sqlib:argument-set-version:a1']);
    expect(objectsOf(store, `${SQLIB}dataGraphVersion`)).toEqual(['urn:sqlib:data-graph-version:d1']);
    // The test pinned no backend, so no refBackend triple should be invented.
    expect(objectsOf(store, `${SQLIB}refBackend`)).toEqual([]);
  });

  it('names the software that asserted the verdicts', async () => {
    const { store } = await report();

    expect(objectsOf(store, `${EARL}assertedBy`)).toEqual(['urn:sqlib:software']);
    expect(objectsOf(store, 'https://schema.org/name')).toEqual(['sqlib']);
  });

  it('reports a test that cannot run as a 400, not as an empty report', async () => {
    // Unchanged by the requested format: there is no run to export, and a
    // report of zero assertions reads to CI as a pass.
    const { TestNotRunnableError } = await import('../../src/lib/TestRunner.js');
    hoisted.runTestVersion.mockRejectedValue(new TestNotRunnableError('TestVersion has no subject'));

    const res = await app.inject({
      method: 'POST', url: RUN_URL, payload: {}, headers: { accept: 'text/turtle' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('TestVersion has no subject');
  });

  it('rejects a request that still names a sink', async () => {
    // `reportTo` is gone: a run answers to its caller, and a body that still
    // asks for a graph write is a request written against an API that no longer
    // exists — better a 400 than a silently ignored field.
    const res = await app.inject({
      method: 'POST',
      url: RUN_URL,
      payload: { reportTo: { backendId: 'urn:sqlib:backend:sink' } },
    });

    expect(res.statusCode).toBe(400);
  });
});
