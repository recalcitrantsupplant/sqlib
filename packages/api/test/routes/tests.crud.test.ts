import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import testRoutes from '../../src/routes/tests.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  test: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  testVersion: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  testCase: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  coordinatorGet: vi.fn(),
  createVersion: vi.fn(),
  updateVersion: vi.fn(),
  runTestVersion: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({ Test: hoisted.test, TestVersion: hoisted.testVersion, TestCase: hoisted.testCase }),
  getCacheCoordinator: () => ({ get: hoisted.coordinatorGet }),
}));

vi.mock('../../src/lib/TestVersionWriter.js', () => ({
  createTestVersion: hoisted.createVersion,
  updateTestVersion: hoisted.updateVersion,
  TestVersionError: class TestVersionError extends Error {},
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

const LIBRARY_ID = 'urn:sqlib:library:lib1';
const RULE_SET_ID = 'urn:sqlib:ruleset:rs1';
const TEST_ID = 'urn:sqlib:test:t1';
const ETL_JOB_ID = 'urn:sqlib:etl-job:job1';

describe('Tests Routes (/tests)', () => {
  let app: FastifyInstance;

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
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(testRoutes, { prefix: '/tests' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.coordinatorGet.mockImplementation((iri: string) => {
      if (iri === LIBRARY_ID) return { $id: LIBRARY_ID, '@type': 'Library', name: 'Lib' };
      if (iri === RULE_SET_ID) return { $id: RULE_SET_ID, '@type': 'RuleSet', name: 'RS' };
      return null;
    });
    hoisted.test.create.mockImplementation(async (entity: Record<string, unknown>) => entity);
    hoisted.testCase.list.mockReturnValue([]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a test pointing at a callable', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tests',
      payload: { name: 'Reaches b', subject: RULE_SET_ID, subjectKind: 'ruleSet', isPartOf: [LIBRARY_ID] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ subject: RULE_SET_ID, subjectKind: 'ruleSet' });
  });

  it('creates a test over an ETL job, which is a callable like any other', async () => {
    // Nothing in the route knows about ETL: the kind and the entity type it
    // requires come from `subjectKinds`, which is the point of that table.
    hoisted.coordinatorGet.mockImplementation((iri: string) => {
      if (iri === LIBRARY_ID) return { $id: LIBRARY_ID, '@type': 'Library', name: 'Lib' };
      if (iri === ETL_JOB_ID) return { $id: ETL_JOB_ID, '@type': 'EtlJob', name: 'People' };
      return null;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/tests',
      payload: { name: 'People load', subject: ETL_JOB_ID, subjectKind: 'etlJob', isPartOf: [LIBRARY_ID] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ subject: ETL_JOB_ID, subjectKind: 'etlJob' });
  });

  it('rejects a subject kind that disagrees with the subject it names', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tests',
      payload: { name: 'Wrong kind', subject: RULE_SET_ID, subjectKind: 'query', isPartOf: [LIBRARY_ID] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/is a RuleSet, but subjectKind says query/);
  });

  it('rejects a subject that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tests',
      payload: { name: 'Ghost', subject: 'urn:sqlib:ruleset:gone', subjectKind: 'ruleSet', isPartOf: [LIBRARY_ID] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/does not exist/);
  });

  it('filters the list by subject, which is what the Tests tab is', async () => {
    hoisted.test.list.mockReturnValue([
      { $id: TEST_ID, '@type': 'Test', name: 'A', subject: RULE_SET_ID, subjectKind: 'ruleSet', isPartOf: [LIBRARY_ID] },
      { $id: 'urn:sqlib:test:t2', '@type': 'Test', name: 'B', subject: 'urn:sqlib:query:q1', subjectKind: 'query', isPartOf: [LIBRARY_ID] },
    ]);

    const all = await app.inject({ method: 'GET', url: '/tests' });
    expect(all.json()).toHaveLength(2);

    const filtered = await app.inject({ method: 'GET', url: `/tests?subject=${encodeURIComponent(RULE_SET_ID)}` });
    expect(filtered.json()).toHaveLength(1);
    expect(filtered.json()[0].name).toBe('A');
  });

  it('refuses to repoint a test at a different subject', async () => {
    hoisted.test.get.mockReturnValue({
      $id: TEST_ID, '@type': 'Test', name: 'A', subject: RULE_SET_ID, subjectKind: 'ruleSet', isPartOf: [LIBRARY_ID],
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/tests/${encodeURIComponent(TEST_ID)}`,
      payload: { subject: 'urn:sqlib:query:q1' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/subject cannot be changed/);
    expect(hoisted.test.update).not.toHaveBeenCalled();
  });

  it('still allows a rename', async () => {
    hoisted.test.get.mockReturnValue({
      $id: TEST_ID, '@type': 'Test', name: 'A', subject: RULE_SET_ID, subjectKind: 'ruleSet', isPartOf: [LIBRARY_ID],
    });
    hoisted.test.update.mockImplementation(async (id: string, updates: Record<string, unknown>) => ({
      $id: id, '@type': 'Test', subject: RULE_SET_ID, subjectKind: 'ruleSet', isPartOf: [LIBRARY_ID], name: 'A', ...updates,
    }));

    const res = await app.inject({
      method: 'PUT',
      url: `/tests/${encodeURIComponent(TEST_ID)}`,
      payload: { name: 'Reaches b, renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Reaches b, renamed');
  });

  it('creates a version through the writer', async () => {
    hoisted.test.get.mockReturnValue({ $id: TEST_ID, '@type': 'Test', name: 'A' });
    hoisted.createVersion.mockResolvedValue({
      $id: 'urn:sqlib:test-version:tv1',
      '@type': 'TestVersion',
      isPartOf: TEST_ID,
      version: 1,
      expectationKind: 'graph',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/tests/${encodeURIComponent(TEST_ID)}/versions`,
      payload: {
        expectationKind: 'graph',
        cases: [{ expected: '<http://ex/a> <http://ex/p> <http://ex/b> .' }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ version: 1, expectationKind: 'graph' });
    expect(hoisted.createVersion.mock.calls[0][1].cases).toHaveLength(1);
  });

  /*
   * Cases come back inlined rather than as IRIs. A case has no endpoint of its
   * own, so ids would oblige every caller to fetch N more times to draw one
   * table — and the position order is the API's job, not the caller's.
   */
  it('returns a version with its cases expanded, in position order', async () => {
    hoisted.test.get.mockReturnValue({ $id: TEST_ID, '@type': 'Test', name: 'A' });
    hoisted.testVersion.list.mockReturnValue([
      { $id: 'urn:sqlib:test-version:tv1', isPartOf: TEST_ID, version: 1, expectationKind: 'bindings' },
    ]);
    hoisted.testCase.list.mockReturnValue([
      { $id: 'urn:sqlib:test-case:c2', '@type': 'TestCase', isPartOf: 'urn:sqlib:test-version:tv1', position: 1, name: 'second' },
      { $id: 'urn:sqlib:test-case:c1', '@type': 'TestCase', isPartOf: 'urn:sqlib:test-version:tv1', position: 0, name: 'first' },
      { $id: 'urn:sqlib:test-case:other', '@type': 'TestCase', isPartOf: 'urn:sqlib:test-version:tvX', position: 0 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/tests/${encodeURIComponent(TEST_ID)}/versions/1` });

    expect(res.statusCode).toBe(200);
    expect(res.json().cases.map((c: { name: string }) => c.name)).toEqual(['first', 'second']);
  });

  it('rejects an expectation kind the comparators do not implement', async () => {
    hoisted.test.get.mockReturnValue({ $id: TEST_ID, '@type': 'Test', name: 'A' });

    const res = await app.inject({
      method: 'POST',
      url: `/tests/${encodeURIComponent(TEST_ID)}/versions`,
      payload: { expectationKind: 'isomorphic' },
    });

    expect(res.statusCode).toBe(400);
    expect(hoisted.createVersion).not.toHaveBeenCalled();
  });

  it('turns a writer rejection into a 400', async () => {
    hoisted.test.get.mockReturnValue({ $id: TEST_ID, '@type': 'Test', name: 'A' });
    hoisted.createVersion.mockRejectedValue(new Error('A graph expectation needs an expected result.'));

    const res = await app.inject({
      method: 'POST',
      url: `/tests/${encodeURIComponent(TEST_ID)}/versions`,
      payload: { expectationKind: 'graph' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/needs an expected result/);
  });

  it('runs the current version and reports the verdict', async () => {
    hoisted.test.get.mockReturnValue({
      $id: TEST_ID, '@type': 'Test', name: 'A', currentVersion: 'urn:sqlib:test-version:tv2',
    });
    hoisted.testVersion.list.mockReturnValue([
      { $id: 'urn:sqlib:test-version:tv1', isPartOf: TEST_ID, version: 1, expectationKind: 'graph' },
      { $id: 'urn:sqlib:test-version:tv2', isPartOf: TEST_ID, version: 2, expectationKind: 'graph' },
    ]);
    hoisted.runTestVersion.mockResolvedValue({
      testId: TEST_ID,
      testVersionId: 'urn:sqlib:test-version:tv2',
      passed: true,
      message: '',
      expectationKind: 'graph',
      hermetic: true,
      durationMs: 4,
      subjectVersionId: 'urn:sqlib:ruleset-version:v1',
      ranAt: new Date().toISOString(),
      cases: [{ caseId: 'urn:sqlib:test-case:c1', name: 'Case 1', position: 0, passed: true, message: '', durationMs: 4 }],
      passedCount: 1,
      failedCount: 0,
    });

    const res = await app.inject({ method: 'POST', url: `/tests/${encodeURIComponent(TEST_ID)}/run`, payload: {} });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ passed: true, hermetic: true });
    expect(hoisted.runTestVersion).toHaveBeenCalledWith('urn:sqlib:test-version:tv2');
  });

  it('runs a specific version when one is asked for', async () => {
    hoisted.test.get.mockReturnValue({
      $id: TEST_ID, '@type': 'Test', name: 'A', currentVersion: 'urn:sqlib:test-version:tv2',
    });
    hoisted.testVersion.list.mockReturnValue([
      { $id: 'urn:sqlib:test-version:tv1', isPartOf: TEST_ID, version: 1, expectationKind: 'graph' },
      { $id: 'urn:sqlib:test-version:tv2', isPartOf: TEST_ID, version: 2, expectationKind: 'graph' },
    ]);
    hoisted.runTestVersion.mockResolvedValue({
      testId: TEST_ID,
      testVersionId: 'urn:sqlib:test-version:tv1',
      passed: false,
      message: 'Graphs are not isomorphic: 1 missing, 0 unexpected',
      expectationKind: 'graph',
      hermetic: true,
      durationMs: 4,
      subjectVersionId: null,
      ranAt: new Date().toISOString(),
      cases: [{ caseId: 'urn:sqlib:test-case:c1', name: 'Case 1', position: 0, passed: false, message: 'Graphs are not isomorphic: 1 missing, 0 unexpected', durationMs: 4 }],
      passedCount: 0,
      failedCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/tests/${encodeURIComponent(TEST_ID)}/run`,
      payload: { version: 1 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().passed).toBe(false);
    expect(hoisted.runTestVersion).toHaveBeenCalledWith('urn:sqlib:test-version:tv1');
  });

  it('separates "cannot run" from "did not pass"', async () => {
    const { TestNotRunnableError } = await import('../../src/lib/TestRunner.js');
    hoisted.test.get.mockReturnValue({
      $id: TEST_ID, '@type': 'Test', name: 'A', currentVersion: 'urn:sqlib:test-version:tv1',
    });
    hoisted.testVersion.list.mockReturnValue([
      { $id: 'urn:sqlib:test-version:tv1', isPartOf: TEST_ID, version: 1, expectationKind: 'smoke' },
    ]);
    hoisted.runTestVersion.mockRejectedValue(new TestNotRunnableError('Data graph version gone not found'));

    const res = await app.inject({ method: 'POST', url: `/tests/${encodeURIComponent(TEST_ID)}/run`, payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not found/);
  });

  it('cascades version and case deletes when the test goes', async () => {
    hoisted.test.get.mockReturnValue({ $id: TEST_ID, '@type': 'Test', name: 'A' });
    hoisted.testVersion.list.mockReturnValue([
      { $id: 'urn:sqlib:test-version:tv1', isPartOf: TEST_ID, version: 1 },
      { $id: 'urn:sqlib:test-version:tv2', isPartOf: TEST_ID, version: 2 },
      { $id: 'urn:sqlib:test-version:other', isPartOf: 'urn:sqlib:test:t2', version: 1 },
    ]);
    // A case is reachable only through its version, so an orphaned one is
    // unreachable rather than merely untidy.
    hoisted.testCase.list.mockReturnValue([
      { $id: 'urn:sqlib:test-case:c1', isPartOf: 'urn:sqlib:test-version:tv1', position: 0 },
      { $id: 'urn:sqlib:test-case:c2', isPartOf: 'urn:sqlib:test-version:tv1', position: 1 },
      { $id: 'urn:sqlib:test-case:c3', isPartOf: 'urn:sqlib:test-version:tv2', position: 0 },
      { $id: 'urn:sqlib:test-case:keep', isPartOf: 'urn:sqlib:test-version:other', position: 0 },
    ]);

    const res = await app.inject({ method: 'DELETE', url: `/tests/${encodeURIComponent(TEST_ID)}` });

    expect(res.statusCode).toBe(204);
    expect(hoisted.testVersion.delete).toHaveBeenCalledTimes(2);
    expect(hoisted.testCase.delete.mock.calls.map(call => call[0])).toEqual([
      'urn:sqlib:test-case:c1',
      'urn:sqlib:test-case:c2',
      'urn:sqlib:test-case:c3',
    ]);
  });
});
