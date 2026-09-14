import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import testRoutes from '../../src/routes/tests.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

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
const TAG_ID = 'urn:sqlib:tag:negation';
const LIBRARY_ID = 'urn:sqlib:library:lib1';

const RUN_RESULT = {
  testId: TEST_ID,
  testVersionId: VERSION_ID,
  passed: false,
  message: '1 of 2 cases failed',
  expectationKind: 'bindings',
  hermetic: true,
  durationMs: 12,
  subjectVersionId: 'urn:sqlib:query-version:7',
  ranAt: '2026-08-14T09:32:11.000Z',
  cases: [
    {
      caseId: `${VERSION_ID}#case-0`,
      name: 'Paris',
      position: 0,
      passed: true,
      message: '',
      inputs: { argumentSetVersion: 'urn:sqlib:argument-set-version:a1', dataGraphVersion: null },
      durationMs: 5,
    },
    {
      caseId: `${VERSION_ID}#case-1`,
      name: 'Berlin',
      position: 1,
      passed: false,
      message: '1 missing row',
      detail: { missing: [{ city: 'Berlin' }] },
      inputs: { argumentSetVersion: 'urn:sqlib:argument-set-version:a1', dataGraphVersion: null },
      durationMs: 7,
    },
  ],
  passedCount: 1,
  failedCount: 1,
};

const RUN_URL = `/tests/${encodeURIComponent(TEST_ID)}/run`;

describe('test run export formats', () => {
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
      if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
    }
    await app.register(testRoutes, { prefix: '/tests' });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    vi.clearAllMocks();
    const test = {
      $id: TEST_ID,
      '@type': 'Test',
      name: 'T',
      subject: 'urn:sqlib:query:q1',
      subjectKind: 'query',
      currentVersion: VERSION_ID,
      isPartOf: [LIBRARY_ID],
      tags: [TAG_ID],
    };
    hoisted.test.get.mockReturnValue(test);
    hoisted.test.list.mockReturnValue([test]);
    hoisted.testVersion.list.mockReturnValue([{
      $id: VERSION_ID,
      '@type': 'TestVersion',
      isPartOf: TEST_ID,
      version: 1,
      expectationKind: 'bindings',
      backend: 'urn:sqlib:backend:b1',
    }]);
    hoisted.coordinatorGet.mockReturnValue({ $id: TAG_ID, '@type': 'Tag', name: 'negation' });
    hoisted.runTestVersion.mockResolvedValue(RUN_RESULT);
  });

  describe('POST /tests/:id/run', () => {
    it('still answers with the run response when nothing is negotiated', async () => {
      // The default must not move: everything reading this route today sends no
      // Accept, or sends `application/json`.
      for (const headers of [{}, { accept: 'application/json' }, { accept: '*/*' }]) {
        const res = await app.inject({ method: 'POST', url: RUN_URL, payload: {}, headers });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('application/json');
        expect(res.json().cases).toHaveLength(2);
      }
    });

    it('renders JUnit XML for Accept: application/xml', async () => {
      const res = await app.inject({
        method: 'POST', url: RUN_URL, payload: {}, headers: { accept: 'application/xml' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/xml; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="test-results.xml"');
      expect(res.body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(res.body).toContain('<testcase name="Berlin"');
      expect(res.body).toContain('<failure message="1 missing row" type="failed">');
      // The response schema describes the JSON body; the XML must reach the
      // caller untouched by it, rather than being pushed through
      // fast-json-stringify on the way out.
      expect(res.body.trimStart().startsWith('<')).toBe(true);
    });

    it('renders CSV, Markdown and the JSON export from the same run', async () => {
      const csv = await app.inject({
        method: 'POST', url: RUN_URL, payload: {}, headers: { accept: 'text/csv' },
      });
      expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(csv.body.split('\r\n')[0]).toContain('testId,testVersionId,caseId');

      const markdown = await app.inject({
        method: 'POST', url: RUN_URL, payload: {}, headers: { accept: 'text/markdown' },
      });
      expect(markdown.headers['content-type']).toBe('text/markdown; charset=utf-8');
      expect(markdown.body).toContain('## ❌ sqlib test results');

      const json = await app.inject({
        method: 'POST',
        url: RUN_URL,
        payload: {},
        headers: { accept: 'application/vnd.sqlib.test-report+json' },
      });
      expect(json.headers['content-type']).toBe('application/vnd.sqlib.test-report+json; charset=utf-8');
      expect(JSON.parse(json.body)).toMatchObject({
        format: 'sqlib-test-report',
        version: 1,
        totals: { cases: 2, casesPassed: 1, casesFailed: 1 },
      });
    });

    it('answers 406 rather than quietly returning JSON', async () => {
      const res = await app.inject({
        method: 'POST', url: RUN_URL, payload: {}, headers: { accept: 'application/pdf' },
      });
      expect(res.statusCode).toBe(406);
      expect(res.json().error).toContain('application/pdf');
      // Rejected before the run, not after: nothing was executed to say no.
      expect(hoisted.runTestVersion).not.toHaveBeenCalled();
    });

    it('renders the EARL report for Accept: text/turtle', async () => {
      const res = await app.inject({
        method: 'POST', url: RUN_URL, payload: {}, headers: { accept: 'text/turtle' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/turtle; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="test-results.ttl"');
      expect(res.body).toContain('@prefix earl: <http://www.w3.org/ns/earl#> .');
      expect(res.body.match(/a earl:Assertion/g)).toHaveLength(2);
    });

    it('renders the conformance profile when the Accept asks for it', async () => {
      const res = await app.inject({
        method: 'POST', url: RUN_URL, payload: {}, headers: { accept: 'text/turtle;profile="earl"' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/turtle; charset=utf-8; profile="earl"');
      expect(res.headers['content-disposition']).toBe('attachment; filename="earl-report.ttl"');
      // One assertion for the test, not one per case, and no term from our own
      // vocabulary — the `urn:sqlib:` id below is an identifier, not a term.
      expect(res.body.match(/a earl:Assertion/g)).toHaveLength(1);
      expect(res.body).not.toContain('https://sparql-query-lib/');
      expect(res.body).not.toContain('@prefix sqlib:');
      // The test carries no criterion here, so the report says so rather than
      // passing our own id off as one.
      expect(res.body).toContain('declare no external criterion');
    });

    it('cites the criterion the test declares', async () => {
      hoisted.test.get.mockReturnValue({
        $id: TEST_ID,
        '@type': 'Test',
        name: 'T',
        subject: 'urn:sqlib:query:q1',
        subjectKind: 'query',
        criterion: 'https://w3c.github.io/rdf-tests/shacl/shacl12/eval-basic-01',
        currentVersion: VERSION_ID,
        isPartOf: [LIBRARY_ID],
      });

      const res = await app.inject({
        method: 'POST', url: RUN_URL, payload: {}, headers: { accept: 'text/turtle;profile=w3c' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(
        'earl:test <https://w3c.github.io/rdf-tests/shacl/shacl12/eval-basic-01>',
      );
      expect(res.body).not.toContain('declare no external criterion');
    });

    it('answers 406 for a profile it does not offer', async () => {
      const res = await app.inject({
        method: 'POST', url: RUN_URL, payload: {}, headers: { accept: 'text/turtle;profile=earl-strict' },
      });
      expect(res.statusCode).toBe(406);
      expect(hoisted.runTestVersion).not.toHaveBeenCalled();
    });
  });

  describe('POST /tests/run', () => {
    it('renders the whole suite, naming the tags as the suite', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tests/run',
        payload: { tags: [TAG_ID] },
        headers: { accept: 'application/xml' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(`<testsuites name="${TAG_ID}" tests="2" failures="1" errors="0"`);
      expect(res.body).toContain(`<testsuite name="${TEST_ID}"`);
    });

    it('exports a test that could not run as an error, keeping it in the tally', async () => {
      // The by-tag route turns an unrunnable member into a verdict rather than
      // ending the run; the export has to carry that through as `<error>`, or CI
      // reads a suite that silently shrank as a suite that passed.
      hoisted.runTestVersion.mockRejectedValue(
        new (await import('../../src/lib/TestRunner.js')).TestNotRunnableError('TestVersion has no subject'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/tests/run',
        payload: { tags: [TAG_ID] },
        headers: { accept: 'application/xml' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('errors="1"');
      expect(res.body).toContain('<error message="TestVersion has no subject" type="cantTell">');
      expect(res.body).toContain('<testcase name="(test did not run)"');
    });

    it('exports the suite as EARL, cantTell and all', async () => {
      hoisted.runTestVersion.mockRejectedValue(
        new (await import('../../src/lib/TestRunner.js')).TestNotRunnableError('TestVersion has no subject'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/tests/run',
        payload: { tags: [TAG_ID] },
        headers: { accept: 'text/turtle' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('earl:outcome earl:cantTell');
      // The member that could not run still appears, named by its version.
      expect(res.body).toContain(`<${VERSION_ID}>`);
    });

    it('leaves the JSON summary alone when nothing is negotiated', async () => {
      const res = await app.inject({ method: 'POST', url: '/tests/run', payload: { tags: [TAG_ID] } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ requested: 1, passed: 0, failed: 1 });
      expect(res.json().results).toHaveLength(1);
    });

    it('answers 406 before running anything', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tests/run',
        payload: { tags: [TAG_ID] },
        headers: { accept: 'image/png' },
      });
      expect(res.statusCode).toBe(406);
      expect(hoisted.runTestVersion).not.toHaveBeenCalled();
    });
  });
});
