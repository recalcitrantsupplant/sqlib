import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import testRoutes from '../../src/routes/tests.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

/**
 * The run history routes: what a run leaves behind, and what can be asked of it
 * afterwards (issue #179).
 *
 * `TestRunStore` is mocked at its storage-facing functions only —
 * `toReportEntry` is the real one, because the point of the export case is that
 * a stored run renders through the same pure formatters a live one does, and a
 * stubbed reconstruction would test nothing.
 */

const hoisted = vi.hoisted(() => ({
  test: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  testVersion: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  testCase: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  coordinatorGet: vi.fn(),
  runTestVersion: vi.fn(),
  listTestRuns: vi.fn(),
  getTestRun: vi.fn(),
  recordTestRun: vi.fn(),
  recordTestRuns: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({ Test: hoisted.test, TestVersion: hoisted.testVersion, TestCase: hoisted.testCase }),
  getCacheCoordinator: () => ({ get: hoisted.coordinatorGet }),
}));

vi.mock('../../src/lib/TestRunner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/TestRunner.js')>();
  return {
    ...actual,
    TestRunner: class {
      runTestVersion = hoisted.runTestVersion;
    },
  };
});

vi.mock('../../src/lib/TestRunStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/TestRunStore.js')>();
  return {
    ...actual,
    listTestRuns: hoisted.listTestRuns,
    getTestRun: hoisted.getTestRun,
    recordTestRun: hoisted.recordTestRun,
    recordTestRuns: hoisted.recordTestRuns,
  };
});

const TEST_ID = 'urn:sqlib:test:t1';
const RUN_ID = 'urn:sqlib:test-run:r1';
const encoded = (id: string) => encodeURIComponent(id);

const storedRun = {
  $id: RUN_ID,
  '@type': 'TestRun',
  test: TEST_ID,
  testVersion: 'urn:sqlib:test-version:tv1',
  subject: 'urn:sqlib:query:q1',
  subjectVersion: 'urn:sqlib:query-version:qv1',
  backend: 'urn:sqlib:backend:b1',
  suite: TEST_ID,
  outcome: 'failed',
  expectationKind: 'bindings',
  hermetic: false,
  message: 'one row missing',
  durationMs: 12,
  passedCount: 0,
  failedCount: 1,
  ranAt: '2026-09-07T00:00:00.000Z',
};

const storedCase = {
  $id: 'urn:sqlib:test-run-case:rc1',
  '@type': 'TestRunCase',
  isPartOf: RUN_ID,
  testCase: 'urn:sqlib:test-case:c1',
  name: 'first',
  position: 0,
  outcome: 'failed',
  message: 'one row missing',
  detail: JSON.stringify({ missing: ['?s'], unexpected: [], matched: 2 }),
  durationMs: 12,
  argumentSetVersion: 'urn:sqlib:argument-set-version:as1',
  dataGraphVersion: null,
  dataGraphVersions: null,
};

describe('Test run history (/tests/:id/runs)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
      reply.status(statusCode).send({ error: error.message || 'An unexpected error occurred' });
    });
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(testRoutes, { prefix: '/tests' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.test.get.mockImplementation((id: string) =>
      id === TEST_ID ? { $id: TEST_ID, '@type': 'Test', name: 'A', subject: 'urn:sqlib:query:q1' } : null);
    hoisted.listTestRuns.mockResolvedValue([]);
    hoisted.getTestRun.mockResolvedValue(null);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists a test\'s runs', async () => {
    hoisted.listTestRuns.mockResolvedValue([storedRun]);

    const res = await app.inject({ method: 'GET', url: `/tests/${encoded(TEST_ID)}/runs` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({ id: RUN_ID, test: TEST_ID, outcome: 'failed', ranAt: storedRun.ranAt }),
    ]);
    expect(hoisted.listTestRuns).toHaveBeenCalledWith(TEST_ID, undefined);
  });

  it('passes a limit through rather than answering with everything', async () => {
    await app.inject({ method: 'GET', url: `/tests/${encoded(TEST_ID)}/runs?limit=5` });
    expect(hoisted.listTestRuns).toHaveBeenCalledWith(TEST_ID, 5);
  });

  it('separates a test that does not exist from one that has never run', async () => {
    const missing = await app.inject({ method: 'GET', url: '/tests/urn:sqlib:test:gone/runs' });
    expect(missing.statusCode).toBe(404);

    const neverRan = await app.inject({ method: 'GET', url: `/tests/${encoded(TEST_ID)}/runs` });
    expect(neverRan.statusCode).toBe(200);
    expect(neverRan.json()).toEqual([]);
  });

  it('returns a stored run with its case rows', async () => {
    hoisted.getTestRun.mockResolvedValue({ run: storedRun, cases: [storedCase] });

    const res = await app.inject({ method: 'GET', url: `/tests/${encoded(TEST_ID)}/runs/${encoded(RUN_ID)}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: RUN_ID,
      outcome: 'failed',
      cases: [expect.objectContaining({ id: storedCase.$id, outcome: 'failed', name: 'first' })],
    });
  });

  it('refuses a run reached through the wrong test', async () => {
    hoisted.getTestRun.mockResolvedValue({
      run: { ...storedRun, test: 'urn:sqlib:test:t2' },
      cases: [],
    });

    const res = await app.inject({ method: 'GET', url: `/tests/${encoded(TEST_ID)}/runs/${encoded(RUN_ID)}` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/Test run not found/);
  });

  it('exports a past run without running anything', async () => {
    hoisted.getTestRun.mockResolvedValue({ run: storedRun, cases: [storedCase] });

    const res = await app.inject({
      method: 'GET',
      url: `/tests/${encoded(TEST_ID)}/runs/${encoded(RUN_ID)}`,
      headers: { accept: 'text/csv' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    // The stored dimensions come back through the flattening, not from a re-run.
    expect(res.body).toContain('urn:sqlib:test-case:c1');
    expect(res.body).toContain('failed');
    expect(hoisted.runTestVersion).not.toHaveBeenCalled();
  });

  it('refuses an Accept it cannot satisfy', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/tests/${encoded(TEST_ID)}/runs/${encoded(RUN_ID)}`,
      headers: { accept: 'application/pdf' },
    });
    expect(res.statusCode).toBe(406);
  });
});

describe('running a test files it', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    app.setErrorHandler((error, request, reply) => {
      reply.status(error.statusCode || 500).send({ error: error.message });
    });
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
    }
    await app.register(testRoutes, { prefix: '/tests' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.recordTestRun.mockResolvedValue(null);
    hoisted.recordTestRuns.mockResolvedValue([]);
  });

  afterAll(async () => {
    await app.close();
  });

  const verdict = {
    testId: TEST_ID,
    testVersionId: 'urn:sqlib:test-version:tv1',
    passed: true,
    message: '',
    expectationKind: 'bindings',
    hermetic: true,
    durationMs: 4,
    subjectVersionId: 'urn:sqlib:query-version:qv1',
    ranAt: '2026-09-07T00:00:00.000Z',
    cases: [{ caseId: 'urn:sqlib:test-case:c1', name: 'Case 1', position: 0, passed: true, message: '', durationMs: 4 }],
    passedCount: 1,
    failedCount: 0,
  };

  it('records the verdict of a single-test run, under the test as its suite', async () => {
    hoisted.test.get.mockReturnValue({
      $id: TEST_ID, '@type': 'Test', name: 'A', subject: 'urn:sqlib:query:q1', currentVersion: 'urn:sqlib:test-version:tv1',
    });
    hoisted.testVersion.list.mockReturnValue([
      { $id: 'urn:sqlib:test-version:tv1', isPartOf: TEST_ID, version: 1, expectationKind: 'bindings', backend: 'urn:sqlib:backend:b1' },
    ]);
    hoisted.runTestVersion.mockResolvedValue(verdict);

    const res = await app.inject({ method: 'POST', url: `/tests/${encoded(TEST_ID)}/run`, payload: {} });

    expect(res.statusCode).toBe(200);
    expect(hoisted.recordTestRun).toHaveBeenCalledWith({
      result: verdict,
      subject: 'urn:sqlib:query:q1',
      backend: 'urn:sqlib:backend:b1',
      suite: TEST_ID,
    });
  });

  it('records a suite run as one batch, labelled with the tags it selected', async () => {
    const tag = 'urn:sqlib:tag:w3c';
    hoisted.coordinatorGet.mockImplementation((iri: string) =>
      iri === tag ? { $id: tag, '@type': 'Tag', name: 'w3c' } : null);
    hoisted.test.list.mockReturnValue([
      { $id: TEST_ID, '@type': 'Test', name: 'A', subject: 'urn:sqlib:query:q1', tags: [tag], isPartOf: ['urn:sqlib:library:l1'] },
    ]);
    hoisted.testVersion.list.mockReturnValue([
      { $id: 'urn:sqlib:test-version:tv1', isPartOf: TEST_ID, version: 1, expectationKind: 'bindings' },
    ]);
    hoisted.runTestVersion.mockResolvedValue(verdict);

    const res = await app.inject({ method: 'POST', url: '/tests/run', payload: { tags: [tag] } });

    expect(res.statusCode).toBe(200);
    expect(hoisted.recordTestRuns).toHaveBeenCalledTimes(1);
    expect(hoisted.recordTestRuns).toHaveBeenCalledWith([
      expect.objectContaining({ result: verdict, suite: tag }),
    ]);
  });
});
