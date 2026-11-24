/**
 * Running part of a benchmark version, and reading a pass back (issue #251).
 *
 * The route, coordinator, repositories and runner are real, over the in-memory
 * store. Only the SPARQL endpoint the benchmark times is stood in for.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { BENCHMARK_NO_ARGUMENTS_IRI } from '../../src/constants/benchmarks.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { caseIdFor, MAX_RUN_CONTEXT_BYTES } from '../../src/lib/benchmarkCases.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

vi.mock('../../src/lib/orchestration/ExecutorFactory.js', () => ({
  ExecutorFactory: class {
    async getExecutorForBackendId() {
      return {
        selectQueryParsed: async () => ({ result: { results: { bindings: [] } } }),
        askQuery: async () => ({ result: true }),
        update: async () => {},
        constructQueryParsed: async () => ({ result: { results: { bindings: [] } } }),
      };
    }
  },
}));

const libraryId = 'urn:sqlib:library:seg';
const backendA = 'urn:sqlib:backend:seg-a';
const backendB = 'urn:sqlib:backend:seg-b';
const queryVersionId = 'urn:sqlib:query-version:seg';
const experimentId = 'urn:sqlib:benchmark-experiment:seg';
const base = `/benchmark-experiments/${encodeURIComponent(experimentId)}/versions`;

const caseA = caseIdFor(queryVersionId, backendA, BENCHMARK_NO_ARGUMENTS_IRI, null);
const caseB = caseIdFor(queryVersionId, backendB, BENCHMARK_NO_ARGUMENTS_IRI, null);

function backend(id: string) {
  return {
    $id: id,
    '@type': 'Backend',
    name: id,
    backendType: BackendTypeIri.http,
    endpoint: 'http://example.com/sparql',
    dateCreated: '2026-01-01T00:00:00.000Z',
    dateModified: '2026-01-01T00:00:00.000Z',
  };
}

describe('Benchmark runs of selected cases', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    if (!globalThis.File) {
      globalThis.File = class FileStub {} as unknown as typeof File;
    }
    const benchmarkRoutes = (await import('../../src/routes/benchmarks.js')).default;
    app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(benchmarkRoutes, { prefix: '/benchmark-experiments' });
    await app.ready();
  });

  afterEach(() => store.restore());

  afterAll(async () => {
    await app?.close();
  });

  /** An experiment with one frozen version: one query on two backends, two repeats. */
  async function frozenVersion(specOverrides: Record<string, unknown> = {}) {
    store = await installFakePersistenceAdapter([
      { type: 'Library', entity: { $id: libraryId, '@type': 'Library', name: 'Segments' } },
      { type: 'Backend', entity: backend(backendA) },
      { type: 'Backend', entity: backend(backendB) },
      {
        type: 'QueryVersion',
        entity: {
          $id: queryVersionId,
          '@type': 'QueryVersion',
          isPartOf: 'urn:sqlib:query:seg',
          version: 1,
          queryString: 'SELECT * WHERE { ?s ?p ?o }',
          queryType: QueryTypeIri.select,
          immutable: true,
          dateCreated: '2026-01-01T00:00:00.000Z',
          dateModified: '2026-01-01T00:00:00.000Z',
        },
      },
    ]);
    const experimentRes = await app.inject({
      method: 'POST',
      url: '/benchmark-experiments',
      payload: { id: experimentId, name: 'Segments', status: 'Active', isPartOf: libraryId },
    });
    expect(experimentRes.statusCode).toBe(201);
    const versionRes = await app.inject({
      method: 'POST',
      url: base,
      payload: {
        subjectSpecs: [{ subject: queryVersionId, backends: [backendA, backendB], caseId: 'scan', ...specOverrides }],
        repeats: 2,
        executionStrategy: 'Sequential',
      },
    });
    expect(versionRes.statusCode).toBe(201);
    return app.inject({ method: 'POST', url: `${base}/1/freeze` });
  }

  function run(payload?: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: `${base}/1/run`, ...(payload ? { payload } : {}) });
  }

  it('lists every case of a version with its id and spec label', async () => {
    expect((await frozenVersion()).statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: `${base}/1/cases` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { caseId: caseA, specCaseId: 'scan', subject: queryVersionId, backend: backendA, input: BENCHMARK_NO_ARGUMENTS_IRI, dataGraph: null },
      { caseId: caseB, specCaseId: 'scan', subject: queryVersionId, backend: backendB, input: BENCHMARK_NO_ARGUMENTS_IRI, dataGraph: null },
    ]);
  });

  it('runs one case per call, and reads the pass back with its missing cases', async () => {
    await frozenVersion();
    const context = { pageCache: 'dropped', peakCpuC: 61.5, storeBuild: 'oxigraph 0.5.2', throttled: false };

    const first = await run({ cases: [caseA], pass: 'cold-1', context });
    expect(first.statusCode).toBe(200);
    const firstRun = first.json().run;
    expect(firstRun).toMatchObject({ runStatus: 'Completed', tasksTotal: 2, tasksCompleted: 2, caseIds: [caseA], pass: 'cold-1' });
    expect(firstRun.context).toEqual(context);
    expect(first.json().observations.map((obs: { backend: string }) => obs.backend)).toEqual([backendA, backendA]);

    const partial = await app.inject({ method: 'GET', url: `${base}/1/passes/cold-1` });
    expect(partial.statusCode).toBe(200);
    expect(partial.json()).toMatchObject({
      pass: 'cold-1',
      casesTotal: 2,
      casesRun: [caseA],
      casesFailed: [],
      casesMissing: [expect.objectContaining({ caseId: caseB, backend: backendB })],
    });
    expect(partial.json().runs.map((r: { id: string }) => r.id)).toEqual([firstRun.id]);

    const second = await run({ cases: [caseB], pass: 'cold-1' });
    expect(second.statusCode).toBe(200);
    const complete = (await app.inject({ method: 'GET', url: `${base}/1/passes/cold-1` })).json();
    expect(complete.casesRun).toEqual([caseA, caseB]);
    expect(complete.casesMissing).toEqual([]);
    expect(complete.runs).toHaveLength(2);

    const stored = await app.inject({ method: 'GET', url: `/benchmark-experiments/runs/${encodeURIComponent(firstRun.id)}` });
    expect(stored.json()).toMatchObject({ caseIds: [caseA], pass: 'cold-1', context });
  });

  it('selects every case of a spec by its label', async () => {
    await frozenVersion();
    const res = await run({ cases: ['scan'] });
    expect(res.statusCode).toBe(200);
    expect(res.json().run).toMatchObject({ tasksTotal: 4, caseIds: [caseA, caseB] });
  });

  it('runs every case and records no selection when the body is empty', async () => {
    await frozenVersion();
    const res = await run({});
    expect(res.statusCode).toBe(200);
    expect(res.json().run.tasksTotal).toBe(4);
    expect(res.json().run.caseIds).toBeUndefined();
  });

  it('refuses a selector that names no case, and records no run', async () => {
    await frozenVersion();
    const res = await run({ cases: [caseA, 'no-such-case'] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Unknown case: no-such-case', unknownCases: ['no-such-case'] });
    expect(store.all('BenchmarkRun')).toEqual([]);
  });

  it('refuses a context over the caps or with a nested value', async () => {
    await frozenVersion();
    const tooManyKeys = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i]));
    expect((await run({ context: tooManyKeys })).statusCode).toBe(400);
    const tooLarge = await run({ context: { note: 'x'.repeat(MAX_RUN_CONTEXT_BYTES) } });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json().error).toMatch(/bytes as JSON/);
    expect((await run({ context: { nested: { a: 1 } } })).statusCode).toBe(400);
    expect(store.all('BenchmarkRun')).toEqual([]);
  });

  it('answers 404 for a pass with no runs', async () => {
    await frozenVersion();
    await run({ cases: [caseA], pass: 'p1' });
    const res = await app.inject({ method: 'GET', url: `${base}/1/passes/p2` });
    expect(res.statusCode).toBe(404);
  });

  it('refuses to freeze a version whose label equals a case id', async () => {
    const res = await frozenVersion({ caseId: caseA });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/is also the id of a case/);
  });

  it('refuses a label with characters outside the pattern', async () => {
    store = await installFakePersistenceAdapter([
      { type: 'Library', entity: { $id: libraryId, '@type': 'Library', name: 'Segments' } },
    ]);
    await app.inject({
      method: 'POST',
      url: '/benchmark-experiments',
      payload: { id: experimentId, name: 'Segments', status: 'Active', isPartOf: libraryId },
    });
    const res = await app.inject({
      method: 'POST',
      url: base,
      payload: { subjectSpecs: [{ subject: queryVersionId, backends: [backendA], caseId: 'has space' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  /*
   * The create and update bodies listed no `dataGraphs` on a spec, and the
   * graph axis of a rule-set spec was lost on save. The axis is checked
   * against the subject kind at freeze.
   */
  it('accepts dataGraphs on a spec in the create body', async () => {
    store = await installFakePersistenceAdapter([
      { type: 'Library', entity: { $id: libraryId, '@type': 'Library', name: 'Segments' } },
    ]);
    await app.inject({
      method: 'POST',
      url: '/benchmark-experiments',
      payload: { id: experimentId, name: 'Segments', status: 'Active', isPartOf: libraryId },
    });
    const res = await app.inject({
      method: 'POST',
      url: base,
      payload: { subjectSpecs: [{ subject: 'urn:sqlib:rule-set-version:seg', dataGraphs: ['urn:sqlib:data-graph:seg'] }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().subjectSpecs[0].dataGraphs).toEqual(['urn:sqlib:data-graph:seg']);
  });
});
