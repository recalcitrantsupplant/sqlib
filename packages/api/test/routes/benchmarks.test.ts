import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import benchmarkRoutes from '../../src/routes/benchmarks.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockRun: vi.fn(),
  mockFindAllRuns: vi.fn(),
  mockFindRunById: vi.fn(),
  mockFindAllObservations: vi.fn(),
  mockFindAllNodeObservations: vi.fn(),
  mockFindAllNodeRuns: vi.fn(),
  mockFindAllIterationObservations: vi.fn(),
  mockFindAllIterationRuns: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    list: hoisted.mockList,
    get: hoisted.mockGet,
    create: hoisted.mockCreate,
    update: hoisted.mockUpdate,
    delete: hoisted.mockDelete,
  }),
  getEntityRepositories: () => ({}),
}));

vi.mock('../../src/lib/BenchmarkRunner.js', () => ({
  BenchmarkRunner: vi.fn().mockImplementation(function () {
    return {
      runExperimentVersion: hoisted.mockRun,
    };
  }),
}));

vi.mock('../../src/persistence/utils/BenchmarkRunUtils.js', () => ({
  findAllBenchmarkRuns: hoisted.mockFindAllRuns,
  findBenchmarkRunById: hoisted.mockFindRunById,
}));

vi.mock('../../src/persistence/utils/BenchmarkObservationUtils.js', () => ({
  findAllBenchmarkObservations: hoisted.mockFindAllObservations,
}));

vi.mock('../../src/persistence/utils/BenchmarkNodeObservationUtils.js', () => ({
  findAllBenchmarkNodeObservations: hoisted.mockFindAllNodeObservations,
}));

vi.mock('../../src/persistence/utils/BenchmarkNodeRunUtils.js', () => ({
  findAllBenchmarkNodeRuns: hoisted.mockFindAllNodeRuns,
}));

vi.mock('../../src/persistence/utils/BenchmarkIterationObservationUtils.js', () => ({
  findAllBenchmarkIterationObservations: hoisted.mockFindAllIterationObservations,
}));

vi.mock('../../src/persistence/utils/BenchmarkIterationRunUtils.js', () => ({
  findAllBenchmarkIterationRuns: hoisted.mockFindAllIterationRuns,
}));

describe('Benchmark Routes (/benchmark-experiments)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);

    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
      if (error.validation && Array.isArray(error.validation)) {
        const validationErrors = error.validation.map((err: any) => {
          if (err.keyword === 'required') {
            return `${err.params?.missingProperty || 'Field'} is required`;
          }
          return err.message || 'Validation error';
        });
        const errorMessage = validationErrors.length > 0 ? validationErrors[0] : 'Validation failed';
        return reply.status(statusCode).send({ error: errorMessage });
      }
      reply.status(statusCode).send({ error: error.message || 'An unexpected error occurred' });
    });

    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }

    await app.register(benchmarkRoutes, { prefix: '/benchmark-experiments' });
    await app.ready();
  });

  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await app.close(); });

  it('POST /benchmark-experiments creates a benchmark experiment', async () => {
    const created = {
      $id: 'urn:sqlib:benchmark-experiment:1',
      name: 'Benchmark A',
      description: null,
      status: 'Draft',
      dateCreated: '2024-01-01T00:00:00.000Z',
      dateModified: '2024-01-01T00:00:00.000Z',
      '@type': 'BenchmarkExperiment',
    };
    hoisted.mockCreate.mockResolvedValue(created);

    const res = await app.inject({
      method: 'POST',
      url: '/benchmark-experiments',
      payload: { name: 'Benchmark A', status: 'Draft' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: created.$id,
      name: 'Benchmark A',
      status: 'Draft',
    });
  });

  it('GET /benchmark-experiments/:id returns the experiment', async () => {
    const entity = {
      $id: 'urn:sqlib:benchmark-experiment:1',
      name: 'Benchmark A',
      description: null,
      status: 'Draft',
      dateModified: '2024-01-02T00:00:00.000Z',
      '@type': 'BenchmarkExperiment',
    };
    hoisted.mockGet.mockReturnValue(entity);

    const res = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/${encodeURIComponent(entity.$id)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: entity.$id, name: 'Benchmark A' });
  });

  it('PUT /benchmark-experiments/:id updates metadata with If-Match', async () => {
    const id = 'urn:sqlib:benchmark-experiment:1';
    const existing = {
      $id: id,
      name: 'Benchmark A',
      description: null,
      status: 'Draft',
      dateModified: '2024-01-01T00:00:00.000Z',
      '@type': 'BenchmarkExperiment',
    };
    const updated = {
      $id: id,
      name: 'Benchmark A2',
      description: null,
      status: 'Active',
      dateModified: '2024-01-03T00:00:00.000Z',
      '@type': 'BenchmarkExperiment',
    };
    hoisted.mockGet.mockReturnValue(existing);
    hoisted.mockUpdate.mockResolvedValue(updated);

    const res = await app.inject({
      method: 'PUT',
      url: `/benchmark-experiments/${encodeURIComponent(id)}`,
      payload: { name: 'Benchmark A2', status: 'Active' },
      headers: { 'if-match': existing.dateModified },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, name: 'Benchmark A2', status: 'Active' });
    expect(res.headers.etag).toBe('"2024-01-03T00:00:00.000Z"');
  });

  it('POST /benchmark-experiments/:id/v creates a version', async () => {
    const experimentId = 'urn:sqlib:benchmark-experiment:1';
    hoisted.mockGet.mockReturnValue({
      $id: experimentId,
      name: 'Benchmark A',
      '@type': 'BenchmarkExperiment',
    });
    hoisted.mockList.mockReturnValue([]);
    hoisted.mockCreate.mockResolvedValue({
      $id: 'urn:sqlib:benchmark-experiment-version:1',
      '@type': 'BenchmarkExperimentVersion',
      isPartOf: experimentId,
      version: 1,
      subjectSpecs: JSON.stringify([{ subject: 'urn:sqlib:query-version:1', inputs: [], backends: ['urn:sqlib:backend:1'] }]),
      dateModified: '2024-01-04T00:00:00.000Z',
    });
    hoisted.mockUpdate.mockResolvedValue({ $id: experimentId });

    const res = await app.inject({
      method: 'POST',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/v`,
      payload: {
        subjectSpecs: [{ subject: 'urn:sqlib:query-version:1', backends: ['urn:sqlib:backend:1'] }],
        repeats: 2,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.isPartOf).toBe(experimentId);
    expect(body.version).toBe(1);
    expect(body.subjectSpecs).toHaveLength(1);
  });

  it('PATCH /benchmark-experiments/:id/v/:version updates a version with If-Match', async () => {
    const experimentId = 'urn:sqlib:benchmark-experiment:1';
    const versionEntity = {
      $id: 'urn:sqlib:benchmark-experiment-version:1',
      '@type': 'BenchmarkExperimentVersion',
      isPartOf: experimentId,
      version: 1,
      subjectSpecs: JSON.stringify([]),
      dateModified: '2024-01-05T00:00:00.000Z',
    };
    hoisted.mockList.mockReturnValue([versionEntity]);
    hoisted.mockUpdate.mockResolvedValue({
      ...versionEntity,
      repeats: 5,
      dateModified: '2024-01-06T00:00:00.000Z',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/v/1`,
      payload: { repeats: 5 },
      headers: { 'if-match': versionEntity.dateModified },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: 1, repeats: 5 });
    expect(res.headers.etag).toBe('"2024-01-06T00:00:00.000Z"');
  });

  it('PATCH /benchmark-experiments/:id/v/:version rejects updates when immutable', async () => {
    const experimentId = 'urn:sqlib:benchmark-experiment:1';
    const versionEntity = {
      $id: 'urn:sqlib:benchmark-experiment-version:1',
      '@type': 'BenchmarkExperimentVersion',
      isPartOf: experimentId,
      version: 1,
      subjectSpecs: JSON.stringify([]),
      immutable: true,
      dateModified: '2024-01-06T00:00:00.000Z',
    };
    hoisted.mockList.mockReturnValue([versionEntity]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/v/1`,
      payload: { repeats: 3 },
      headers: { 'if-match': versionEntity.dateModified },
    });

    expect(res.statusCode).toBe(409);
    expect(hoisted.mockUpdate).not.toHaveBeenCalled();
  });

  it('POST /benchmark-experiments/:id/v/:version/run executes a benchmark', async () => {
    const experimentId = 'urn:sqlib:benchmark-experiment:1';
    const versionEntity = {
      $id: 'urn:sqlib:benchmark-experiment-version:1',
      '@type': 'BenchmarkExperimentVersion',
      isPartOf: experimentId,
      version: 1,
      subjectSpecs: JSON.stringify([]),
    };
    hoisted.mockList.mockReturnValue([versionEntity]);
    hoisted.mockRun.mockResolvedValue({
      run: {
        $id: 'urn:sqlib:benchmark-run:1',
        runStatus: 'Completed',
        tasksTotal: 1,
        tasksCompleted: 1,
      },
      nodeRun: null,
      iterationRun: null,
      observations: [],
      nodeObservations: [],
      iterationObservations: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/v/1/run`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      run: {
        id: 'urn:sqlib:benchmark-run:1',
        runStatus: 'Completed',
        tasksTotal: 1,
        tasksCompleted: 1,
      },
      observations: [],
      nodeObservations: [],
      iterationObservations: [],
    });
    expect(hoisted.mockRun).toHaveBeenCalledWith(versionEntity.$id);
  });

  it('POST /benchmark-experiments/:id/v/:version/freeze validates dependencies', async () => {
    const experimentId = 'urn:sqlib:benchmark-experiment:1';
    const versionEntity = {
      $id: 'urn:sqlib:benchmark-experiment-version:1',
      '@type': 'BenchmarkExperimentVersion',
      isPartOf: experimentId,
      version: 1,
      subjectSpecs: JSON.stringify([
        {
          subject: 'urn:sqlib:query-version:1',
          backends: ['urn:sqlib:backend:1'],
          inputs: ['https://sparql-query-lib/NoArguments'],
        },
      ]),
    };
    hoisted.mockList.mockReturnValue([versionEntity]);
    hoisted.mockGet.mockImplementation((id: string) => {
      if (id === 'urn:sqlib:query-version:1') {
        return { $id: id, '@type': 'QueryVersion', immutable: false };
      }
      if (id === 'urn:sqlib:backend:1') {
        return { $id: id, '@type': 'Backend' };
      }
      return null;
    });

    const res = await app.inject({
      method: 'POST',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/v/1/freeze`,
    });

    expect(res.statusCode).toBe(409);
  });

  it('GET /benchmark-experiments/:id/v/:version/runs lists runs', async () => {
    const experimentId = 'urn:sqlib:benchmark-experiment:1';
    const versionEntity = {
      $id: 'urn:sqlib:benchmark-experiment-version:1',
      '@type': 'BenchmarkExperimentVersion',
      isPartOf: experimentId,
      version: 1,
      subjectSpecs: JSON.stringify([]),
    };
    hoisted.mockList.mockReturnValue([versionEntity]);
    hoisted.mockFindAllRuns.mockResolvedValue([
      {
        $id: 'urn:sqlib:benchmark-run:1',
        '@type': 'BenchmarkRun',
        structure: 'https://sparql-query-lib/BenchmarkObservationDSD',
        definedBy: versionEntity.$id,
        runStatus: 'Completed',
        tasksTotal: 1,
        tasksCompleted: 1,
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/v/1/runs`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject([
      {
        id: 'urn:sqlib:benchmark-run:1',
        runStatus: 'Completed',
        tasksTotal: 1,
        tasksCompleted: 1,
        // The fixture has always set `structure` and nothing asserted it. It
        // passes today and passed before the benchmark documents were collapsed
        // onto the entity model — which is the point: the entity document was
        // already winning the duplicate `$id`, by boot order alone. Pinning the
        // property means a future ordering change cannot quietly drop the DSD
        // pointer that makes the observations interpretable (issue #65).
        structure: 'https://sparql-query-lib/BenchmarkObservationDSD',
      },
    ]);
  });

  it('GET /benchmark-runs/:id returns run detail', async () => {
    const runId = 'urn:sqlib:benchmark-run:1';
    hoisted.mockFindRunById.mockResolvedValue({
      $id: runId,
      '@type': 'BenchmarkRun',
      structure: 'https://sparql-query-lib/BenchmarkObservationDSD',
      definedBy: 'urn:sqlib:benchmark-experiment-version:1',
      runStatus: 'Completed',
      tasksTotal: 1,
      tasksCompleted: 1,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/runs/${encodeURIComponent(runId)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: runId,
      runStatus: 'Completed',
      tasksTotal: 1,
      tasksCompleted: 1,
      structure: 'https://sparql-query-lib/BenchmarkObservationDSD',
    });
  });

  it('GET /benchmark-runs/:id/observations returns observations', async () => {
    const runId = 'urn:sqlib:benchmark-run:1';
    hoisted.mockFindRunById.mockResolvedValue({
      $id: runId,
      '@type': 'BenchmarkRun',
      structure: 'https://sparql-query-lib/BenchmarkObservationDSD',
      definedBy: 'urn:sqlib:benchmark-experiment-version:1',
      runStatus: 'Completed',
      tasksTotal: 1,
      tasksCompleted: 1,
    });
    hoisted.mockFindAllObservations.mockResolvedValue([
      {
        $id: 'urn:sqlib:benchmark-observation:1',
        '@type': 'BenchmarkObservation',
        dataSet: runId,
        subject: 'urn:sqlib:query-version:1',
        backend: 'urn:sqlib:backend:1',
        argumentSet: 'https://sparql-query-lib/NoArguments',
        runIndex: 1,
        durationMs: 12,
        resultCount: 10,
        success: true,
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/runs/${encodeURIComponent(runId)}/observations`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject([
      { id: 'urn:sqlib:benchmark-observation:1', dataSet: runId, success: true },
    ]);
  });

  it('GET /benchmark-runs/:id/node-observations returns node observations', async () => {
    const runId = 'urn:sqlib:benchmark-run:1';
    hoisted.mockFindRunById.mockResolvedValue({
      $id: runId,
      '@type': 'BenchmarkRun',
      structure: 'https://sparql-query-lib/BenchmarkObservationDSD',
      definedBy: 'urn:sqlib:benchmark-experiment-version:1',
      runStatus: 'Completed',
      tasksTotal: 1,
      tasksCompleted: 1,
    });
    hoisted.mockFindAllNodeRuns.mockResolvedValue([
      {
        $id: 'urn:sqlib:benchmark-node-run:1',
        '@type': 'BenchmarkNodeRun',
        definedBy: 'urn:sqlib:benchmark-experiment-version:1',
        isPartOf: runId,
        structure: 'https://sparql-query-lib/BenchmarkNodeObservationDSD',
      },
    ]);
    hoisted.mockFindAllNodeObservations.mockResolvedValue([
      {
        $id: 'urn:sqlib:benchmark-node-observation:1',
        '@type': 'BenchmarkNodeObservation',
        dataSet: 'urn:sqlib:benchmark-node-run:1',
        groupObservation: 'urn:sqlib:benchmark-observation:1',
        node: 'urn:sqlib:query-node:1',
        backend: 'urn:sqlib:backend:1',
        runIndex: 1,
        durationMs: 5,
        resultCount: 1,
        success: true,
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/runs/${encodeURIComponent(runId)}/node-observations`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject([
      { id: 'urn:sqlib:benchmark-node-observation:1', dataSet: 'urn:sqlib:benchmark-node-run:1', success: true },
    ]);
  });

  /*
   * The passes of one rule-set request, in the order the loop ran them and
   * grouped by the request that ran them — a sequence read out of order says
   * nothing about where the time went. The row from another run's dataset is
   * here to prove the filter, since every iteration run in the store is read
   * before one is chosen.
   */
  it('GET /benchmark-runs/:id/iteration-observations returns one row per pass, in loop order', async () => {
    const runId = 'urn:sqlib:benchmark-run:2';
    hoisted.mockFindRunById.mockResolvedValue({
      $id: runId,
      '@type': 'BenchmarkRun',
      definedBy: 'urn:sqlib:benchmark-experiment-version:1',
      runStatus: 'Completed',
      tasksTotal: 1,
      tasksCompleted: 1,
    });
    hoisted.mockFindAllIterationRuns.mockResolvedValue([
      {
        $id: 'urn:sqlib:benchmark-iteration-run:1',
        '@type': 'BenchmarkIterationRun',
        definedBy: 'urn:sqlib:benchmark-experiment-version:1',
        isPartOf: runId,
        structure: 'https://sparql-query-lib/BenchmarkIterationObservationDSD',
      },
      {
        $id: 'urn:sqlib:benchmark-iteration-run:9',
        '@type': 'BenchmarkIterationRun',
        definedBy: 'urn:sqlib:benchmark-experiment-version:1',
        isPartOf: 'urn:sqlib:benchmark-run:99',
        structure: 'https://sparql-query-lib/BenchmarkIterationObservationDSD',
      },
    ]);
    const pass = (id: string, iterationIndex: number, dataSet = 'urn:sqlib:benchmark-iteration-run:1') => ({
      $id: id,
      '@type': 'BenchmarkIterationObservation',
      dataSet,
      subjectObservation: 'urn:sqlib:benchmark-observation:1',
      runIndex: 1,
      iterationIndex,
      stratum: 0,
      durationMs: iterationIndex,
      resultCount: 3,
      tripleCount: 10 + iterationIndex,
      tupleCount: 0,
      rulesEvaluated: 2,
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    hoisted.mockFindAllIterationObservations.mockResolvedValue([
      pass('urn:sqlib:benchmark-iteration-observation:2', 2),
      pass('urn:sqlib:benchmark-iteration-observation:1', 1),
      pass('urn:sqlib:benchmark-iteration-observation:9', 1, 'urn:sqlib:benchmark-iteration-run:9'),
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/runs/${encodeURIComponent(runId)}/iteration-observations`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject([
      { id: 'urn:sqlib:benchmark-iteration-observation:1', iterationIndex: 1, resultCount: 3, rulesEvaluated: 2 },
      { id: 'urn:sqlib:benchmark-iteration-observation:2', iterationIndex: 2, tripleCount: 12 },
    ]);
  });

  /*
   * A plan with no rule-set subject writes no iteration dataset, so the answer
   * is an empty list rather than every iteration observation in the store.
   */
  it('GET /benchmark-runs/:id/iteration-observations returns [] for a run with no iteration dataset', async () => {
    const runId = 'urn:sqlib:benchmark-run:3';
    hoisted.mockFindRunById.mockResolvedValue({
      $id: runId,
      '@type': 'BenchmarkRun',
      definedBy: 'urn:sqlib:benchmark-experiment-version:1',
      runStatus: 'Completed',
      tasksTotal: 1,
      tasksCompleted: 1,
    });
    hoisted.mockFindAllIterationRuns.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/runs/${encodeURIComponent(runId)}/iteration-observations`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(hoisted.mockFindAllIterationObservations).not.toHaveBeenCalled();
  });

  it('GET /benchmark-runs/:id/iteration-observations 404s for an unknown run', async () => {
    hoisted.mockFindRunById.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/benchmark-experiments/runs/urn%3Asqlib%3Abenchmark-run%3Amissing/iteration-observations',
    });

    expect(res.statusCode).toBe(404);
  });
});
