/**
 * Selecting tests by tag, and running the selection in one request.
 *
 * The two halves are one feature and are tested together on purpose: a tag is
 * only a suite if the list you can see and the set that runs are the same set,
 * and that equality is exactly what `parseTagList`/`matchesTags` serving both
 * routes is for.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import testRoutes from '../../src/routes/tests.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  test: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  testVersion: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  testCase: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  backend: { list: vi.fn(), get: vi.fn() },
  coordinatorGet: vi.fn(),
  runTestVersion: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    Test: hoisted.test,
    TestVersion: hoisted.testVersion,
    TestCase: hoisted.testCase,
    Backend: hoisted.backend,
  }),
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

const LIBRARY_ID = 'urn:sqlib:library:lib1';
const RULE_SET_ID = 'urn:sqlib:ruleset:rs1';
const NEGATION = 'urn:sqlib:tag:negation';
const MUST_REJECT = 'urn:sqlib:tag:must-reject';

/** Three tests: one tagged both, one tagged negation only, one untagged. */
const TESTS = [
  {
    $id: 'urn:sqlib:test:both', '@type': 'Test', name: 'both', subject: RULE_SET_ID, subjectKind: 'ruleSet',
    isPartOf: [LIBRARY_ID], tags: [NEGATION, MUST_REJECT], currentVersion: 'urn:sqlib:test-version:both-1',
  },
  {
    $id: 'urn:sqlib:test:one', '@type': 'Test', name: 'one', subject: RULE_SET_ID, subjectKind: 'ruleSet',
    isPartOf: [LIBRARY_ID], tags: [NEGATION], currentVersion: 'urn:sqlib:test-version:one-1',
  },
  {
    $id: 'urn:sqlib:test:none', '@type': 'Test', name: 'none', subject: RULE_SET_ID, subjectKind: 'ruleSet',
    isPartOf: [LIBRARY_ID], tags: [],
  },
];

const VERSIONS = [
  { $id: 'urn:sqlib:test-version:both-1', isPartOf: 'urn:sqlib:test:both', version: 1, expectationKind: 'analysis' },
  { $id: 'urn:sqlib:test-version:one-1', isPartOf: 'urn:sqlib:test:one', version: 1, expectationKind: 'graph' },
];

function verdict(testId: string, testVersionId: string, passed: boolean) {
  return {
    testId,
    testVersionId,
    passed,
    message: passed ? '' : 'differs',
    expectationKind: 'graph',
    hermetic: true,
    durationMs: 1,
    subjectVersionId: null,
    ranAt: new Date().toISOString(),
    cases: [],
    passedCount: passed ? 1 : 0,
    failedCount: passed ? 0 : 1,
  };
}

describe('Tests by tag (/tests?tags=…, POST /tests/run)', () => {
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
    hoisted.test.list.mockReturnValue(TESTS);
    hoisted.testVersion.list.mockReturnValue(VERSIONS);
    hoisted.testCase.list.mockReturnValue([]);
    hoisted.coordinatorGet.mockImplementation((iri: string) => {
      if (iri === LIBRARY_ID) return { $id: LIBRARY_ID, '@type': 'Library', name: 'Lib' };
      if (iri === RULE_SET_ID) return { $id: RULE_SET_ID, '@type': 'RuleSet', name: 'RS' };
      if (iri === NEGATION) return { $id: NEGATION, '@type': 'Tag', name: 'negation', isPartOf: LIBRARY_ID };
      if (iri === MUST_REJECT) return { $id: MUST_REJECT, '@type': 'Tag', name: 'must reject', isPartOf: LIBRARY_ID };
      return null;
    });
    hoisted.runTestVersion.mockImplementation(async (versionId: string) =>
      verdict(versionId.includes('both') ? 'urn:sqlib:test:both' : 'urn:sqlib:test:one', versionId, versionId.includes('both')),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('narrows the list to one tag', async () => {
    const res = await app.inject({ method: 'GET', url: `/tests?tags=${encodeURIComponent(MUST_REJECT)}` });
    expect(res.json().map((t: { name: string }) => t.name)).toEqual(['both']);
  });

  it('reads two tags as a union, and as an intersection when asked', async () => {
    const tags = `${encodeURIComponent(NEGATION)},${encodeURIComponent(MUST_REJECT)}`;

    const any = await app.inject({ method: 'GET', url: `/tests?tags=${tags}` });
    expect(any.json().map((t: { name: string }) => t.name)).toEqual(['both', 'one']);

    const all = await app.inject({ method: 'GET', url: `/tests?tags=${tags}&match=all` });
    expect(all.json().map((t: { name: string }) => t.name)).toEqual(['both']);
  });

  it('runs every test carrying a tag and answers with the tally', async () => {
    const res = await app.inject({ method: 'POST', url: '/tests/run', payload: { tags: [NEGATION] } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ match: 'any', requested: 2, passed: 1, failed: 1 });
    expect(body.results.map((r: { testId: string }) => r.testId)).toEqual([
      'urn:sqlib:test:both',
      'urn:sqlib:test:one',
    ]);
    expect(hoisted.runTestVersion).toHaveBeenCalledTimes(2);
  });

  it('intersects when match is all', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tests/run',
      payload: { tags: [NEGATION, MUST_REJECT], match: 'all' },
    });

    expect(res.json()).toMatchObject({ match: 'all', requested: 1, passed: 1, failed: 0 });
  });

  it('reports a test that cannot run as a failed verdict, and keeps going', async () => {
    // `none` carries no tags, so add it to the selection by tagging it here.
    hoisted.test.list.mockReturnValue([
      { ...TESTS[2], tags: [NEGATION] },
      TESTS[1],
    ]);

    const res = await app.inject({ method: 'POST', url: '/tests/run', payload: { tags: [NEGATION] } });

    const body = res.json();
    expect(body).toMatchObject({ requested: 2, passed: 0, failed: 2 });
    expect(body.results[0]).toMatchObject({
      testId: 'urn:sqlib:test:none',
      passed: false,
      message: 'Test has no version to run',
      cases: [],
    });
    // The unrunnable one did not stop the runnable one from being reached.
    expect(hoisted.runTestVersion).toHaveBeenCalledTimes(1);
  });

  it('turns a runner refusal into a verdict rather than a 400', async () => {
    const { TestNotRunnableError } = await import('../../src/lib/TestRunner.js');
    hoisted.runTestVersion.mockRejectedValue(new TestNotRunnableError('subject has no version'));

    const res = await app.inject({ method: 'POST', url: '/tests/run', payload: { tags: [MUST_REJECT] } });

    expect(res.statusCode).toBe(200);
    expect(res.json().results[0]).toMatchObject({ passed: false, message: 'subject has no version' });
  });

  it('says so when a tag does not exist, rather than running nothing', async () => {
    const res = await app.inject({ method: 'POST', url: '/tests/run', payload: { tags: ['urn:sqlib:tag:ghost'] } });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/does not exist/);
    expect(hoisted.runTestVersion).not.toHaveBeenCalled();
  });

  it('refuses an IRI that is not a tag', async () => {
    const res = await app.inject({ method: 'POST', url: '/tests/run', payload: { tags: [RULE_SET_ID] } });

    expect(res.statusCode).toBe(400);
    expect(hoisted.runTestVersion).not.toHaveBeenCalled();
  });

  /*
   * The other half of the route: a suite only the caller can select. `all
   * tests`, one heading of the list and the failures of the last run are all
   * this shape — none of them is a tag, and before this they could be run but
   * not reported on.
   */
  describe('naming the tests instead of a tag', () => {
    it('runs exactly the tests it was given, in the order it was given them', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tests/run',
        payload: { tests: ['urn:sqlib:test:one', 'urn:sqlib:test:both'] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ tags: [], requested: 2, passed: 1, failed: 1 });
      expect(body.results.map((r: { testId: string }) => r.testId)).toEqual([
        'urn:sqlib:test:one',
        'urn:sqlib:test:both',
      ]);
    });

    it('reaches a test no tag describes', async () => {
      // `none` carries no tags at all: by tag it is unreachable, and running the
      // whole list has to reach it anyway.
      const res = await app.inject({
        method: 'POST',
        url: '/tests/run',
        payload: { tests: ['urn:sqlib:test:none'] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ requested: 1, failed: 1 });
    });

    it('exports the named selection, naming it as one suite', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tests/run',
        payload: { tests: ['urn:sqlib:test:both', 'urn:sqlib:test:one'] },
        headers: { accept: 'text/turtle' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/turtle; charset=utf-8');
      // One report over the whole selection, not one file per test.
      expect(res.body.match(/a earl:Assertion/g)).toHaveLength(2);
    });

    it('says so when a named test does not exist, rather than running a shorter suite', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tests/run',
        payload: { tests: ['urn:sqlib:test:one', 'urn:sqlib:test:ghost'] },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatch(/does not exist/);
      expect(hoisted.runTestVersion).not.toHaveBeenCalled();
    });

    it('refuses a body that selects both ways, and one that selects neither', async () => {
      const both = await app.inject({
        method: 'POST',
        url: '/tests/run',
        payload: { tags: [NEGATION], tests: ['urn:sqlib:test:one'] },
      });
      expect(both.statusCode).toBe(400);

      const neither = await app.inject({ method: 'POST', url: '/tests/run', payload: {} });
      expect(neither.statusCode).toBe(400);

      expect(hoisted.runTestVersion).not.toHaveBeenCalled();
    });
  });

  it('runs nothing, successfully, when the tag selects nothing', async () => {
    hoisted.test.list.mockReturnValue([TESTS[2]]);

    const res = await app.inject({ method: 'POST', url: '/tests/run', payload: { tags: [NEGATION] } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ requested: 0, passed: 0, failed: 0, results: [] });
  });
});
