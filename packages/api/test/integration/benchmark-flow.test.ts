import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { BENCHMARK_NO_ARGUMENTS_IRI } from '../../src/constants/benchmarks.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

// The route, coordinator, repositories and runner are real, over the in-memory
// store; only the SPARQL endpoint the benchmark times is stood in for.
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

describe('Benchmark flow integration', () => {
  let app: FastifyInstance;
  let benchmarkRoutes: typeof import('../../src/routes/benchmarks.js').default;

  beforeAll(async () => {
    if (!globalThis.File) {
      globalThis.File = class FileStub {} as any;
    }
    benchmarkRoutes = (await import('../../src/routes/benchmarks.js')).default;
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
    if (app) {
      await app.close();
    }
  });

  it('creates, freezes, and runs a benchmark version', async () => {
    const backendId = 'urn:sqlib:backend:e2e';
    const queryVersionId = 'urn:sqlib:query-version:e2e';
    const experimentId = 'urn:sqlib:benchmark-experiment:e2e';

    const backendEntity = {
      $id: backendId,
      '@type': 'Backend',
      name: 'E2E Backend',
      backendType: BackendTypeIri.http,
      endpoint: 'http://example.com/sparql',
      dateCreated: '2026-01-01T00:00:00.000Z',
      dateModified: '2026-01-01T00:00:00.000Z',
    };
    const queryVersionEntity = {
      $id: queryVersionId,
      '@type': 'QueryVersion',
      isPartOf: 'urn:sqlib:query:e2e',
      version: 1,
      queryString: 'SELECT * WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.select,
      immutable: true,
      dateCreated: '2026-01-01T00:00:00.000Z',
      dateModified: '2026-01-01T00:00:00.000Z',
    };

    const libraryId = 'urn:sqlib:library:e2e';
    store = await installFakePersistenceAdapter([
      { type: 'Library', entity: { $id: libraryId, '@type': 'Library', name: 'E2E Library' } },
      { type: 'Backend', entity: backendEntity },
      { type: 'QueryVersion', entity: queryVersionEntity },
    ]);

    const experimentRes = await app.inject({
      method: 'POST',
      url: '/benchmark-experiments',
      payload: {
        id: experimentId,
        name: 'E2E Benchmark',
        status: 'Active',
        isPartOf: libraryId,
      },
    });
    expect(experimentRes.statusCode).toBe(201);

    const versionRes = await app.inject({
      method: 'POST',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/versions`,
      payload: {
        subjectSpecs: [
          {
            subject: queryVersionId,
            backends: [backendId],
            inputs: [BENCHMARK_NO_ARGUMENTS_IRI],
          },
        ],
        repeats: 1,
        executionStrategy: 'Sequential',
      },
    });
    expect(versionRes.statusCode).toBe(201);
    const version = versionRes.json();
    expect(version.version).toBe(1);

    const freezeRes = await app.inject({
      method: 'POST',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/versions/1/freeze`,
    });
    expect(freezeRes.statusCode).toBe(200);
    const frozen = freezeRes.json();
    expect(frozen.immutable).toBe(true);

    const runRes = await app.inject({
      method: 'POST',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/versions/1/run`,
    });
    expect(runRes.statusCode).toBe(200);
    const runPayload = runRes.json();
    expect(runPayload.run.runStatus).toBe('Completed');
    expect(runPayload.observations).toHaveLength(1);

    const runId = runPayload.run.id;
    // What was stored: the experiment, its now-frozen version, the run and its one observation
    expect(store.get(experimentId)).toMatchObject({ name: 'E2E Benchmark', isPartOf: libraryId });
    expect(store.get(version.id)).toMatchObject({ isPartOf: experimentId, immutable: true });
    expect(store.get(runId)).toMatchObject({ runStatus: 'Completed', tasksCompleted: 1 });
    expect(store.all('BenchmarkObservation')).toEqual([expect.objectContaining({ dataSet: runId })]);
    const runsRes = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/versions/1/runs`,
    });
    const runs = runsRes.json();
    expect(runs.some((run: any) => run.id === runId)).toBe(true);

    const observationsRes = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/runs/${encodeURIComponent(runId)}/observations`,
    });
    expect(observationsRes.statusCode).toBe(200);
    expect(observationsRes.json()).toHaveLength(1);

    const nodeObsRes = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/runs/${encodeURIComponent(runId)}/node-observations`,
    });
    expect(nodeObsRes.statusCode).toBe(200);
    expect(nodeObsRes.json()).toEqual([]);

    /*
     * A query subject has no fixpoint loop, so both second-level tables are
     * empty — but they have to *arrive* empty rather than be dropped by the
     * response schema, which closes its property list.
     */
    expect(runPayload.iterationRun).toBeNull();
    expect(runPayload.iterationObservations).toEqual([]);

    const iterationObsRes = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/runs/${encodeURIComponent(runId)}/iteration-observations`,
    });
    expect(iterationObsRes.statusCode).toBe(200);
    expect(iterationObsRes.json()).toEqual([]);
  });
});
