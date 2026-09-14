import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { BENCHMARK_NO_ARGUMENTS_IRI } from '../../src/constants/benchmarks.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';

const hoisted = vi.hoisted(() => ({
  entities: new Map<string, any>(),
  entitiesByType: new Map<string, Set<string>>(),
  runs: [] as any[],
  observations: [] as any[],
  nodeRuns: [] as any[],
  nodeObservations: [] as any[],
  iterationRuns: [] as StoredEntity[],
  iterationObservations: [] as StoredEntity[],
}));

/**
 * What the fake store holds: an entity, addressed by its id.
 *
 * The older buckets above are `any[]`, which the `any` ratchet only tolerates
 * because they predate it. New ones need not inherit that.
 */
type StoredEntity = Record<string, unknown> & { $id: string };

const addToTypeIndex = (type: string, id: string) => {
  const bucket = hoisted.entitiesByType.get(type) ?? new Set<string>();
  bucket.add(id);
  hoisted.entitiesByType.set(type, bucket);
};

const removeFromTypeIndex = (type: string, id: string) => {
  const bucket = hoisted.entitiesByType.get(type);
  if (!bucket) return;
  bucket.delete(id);
  if (bucket.size === 0) hoisted.entitiesByType.delete(type);
};

const resetStore = () => {
  hoisted.entities.clear();
  hoisted.entitiesByType.clear();
  hoisted.runs.length = 0;
  hoisted.observations.length = 0;
  hoisted.nodeRuns.length = 0;
  hoisted.nodeObservations.length = 0;
  hoisted.iterationRuns.length = 0;
  hoisted.iterationObservations.length = 0;
};

const cacheCoordinator = {
  list: (type: string) => {
    const ids = hoisted.entitiesByType.get(type);
    if (!ids) return [];
    return Array.from(ids).map((id) => hoisted.entities.get(id));
  },
  get: (id: string) => hoisted.entities.get(id) ?? null,
  create: async (type: string, entity: any) => {
    const now = new Date().toISOString();
    const toStore = {
      ...entity,
      '@type': type,
      dateCreated: entity.dateCreated ?? now,
      dateModified: entity.dateModified ?? now,
    };
    hoisted.entities.set(toStore.$id, toStore);
    addToTypeIndex(type, toStore.$id);
    return toStore;
  },
  update: async (type: string, id: string, updates: any) => {
    const existing = hoisted.entities.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const next = {
      ...existing,
      ...updates,
      dateModified: Object.prototype.hasOwnProperty.call(updates, 'dateModified')
        ? updates.dateModified
        : now,
    };
    hoisted.entities.set(id, next);
    addToTypeIndex(type, id);
    return next;
  },
  delete: async (type: string, id: string) => {
    hoisted.entities.delete(id);
    removeFromTypeIndex(type, id);
  },
  addEphemeral: vi.fn(),
  removeEphemeral: vi.fn(),
  isReady: vi.fn(() => true),
  getStats: vi.fn(() => ({})),
};

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => cacheCoordinator,
  getEntityRepositories: () => ({}),
}));

vi.mock('../../src/persistence/utils/BenchmarkRunUtils.js', () => ({
  BenchmarkRuns: {
    insert: vi.fn(async (run: any) => {
      hoisted.runs.push(run);
      return run;
    }),
  },
  updateBenchmarkRun: vi.fn(async (id: string, updates: any) => {
    const run = hoisted.runs.find((item) => item.$id === id);
    if (!run) return null;
    Object.assign(run, updates);
    return run;
  }),
  findAllBenchmarkRuns: vi.fn(async () => hoisted.runs),
  findBenchmarkRunById: vi.fn(async (id: string) => hoisted.runs.find((item) => item.$id === id) ?? null),
}));

vi.mock('../../src/persistence/utils/BenchmarkObservationUtils.js', () => ({
  BenchmarkObservations: {
    insert: vi.fn(async (observation: any) => {
      hoisted.observations.push(observation);
      return observation;
    }),
  },
  findAllBenchmarkObservations: vi.fn(async () => hoisted.observations),
}));

vi.mock('../../src/persistence/utils/BenchmarkNodeObservationUtils.js', () => ({
  BenchmarkNodeObservations: {
    insert: vi.fn(async (observation: any) => {
      hoisted.nodeObservations.push(observation);
      return observation;
    }),
  },
  findAllBenchmarkNodeObservations: vi.fn(async () => hoisted.nodeObservations),
}));

vi.mock('../../src/persistence/utils/BenchmarkNodeRunUtils.js', () => ({
  BenchmarkNodeRuns: {
    insert: vi.fn(async (nodeRun: any) => {
      hoisted.nodeRuns.push(nodeRun);
      return nodeRun;
    }),
  },
  updateBenchmarkNodeRun: vi.fn(async (id: string, updates: any) => {
    const nodeRun = hoisted.nodeRuns.find((item) => item.$id === id);
    if (!nodeRun) return null;
    Object.assign(nodeRun, updates);
    return nodeRun;
  }),
  findAllBenchmarkNodeRuns: vi.fn(async () => hoisted.nodeRuns),
}));

vi.mock('../../src/persistence/utils/BenchmarkIterationObservationUtils.js', () => ({
  BenchmarkIterationObservations: {
    insert: vi.fn(async (observation: StoredEntity) => {
      hoisted.iterationObservations.push(observation);
      return observation;
    }),
  },
  findAllBenchmarkIterationObservations: vi.fn(async () => hoisted.iterationObservations),
}));

vi.mock('../../src/persistence/utils/BenchmarkIterationRunUtils.js', () => ({
  BenchmarkIterationRuns: {
    insert: vi.fn(async (iterationRun: StoredEntity) => {
      hoisted.iterationRuns.push(iterationRun);
      return iterationRun;
    }),
  },
  updateBenchmarkIterationRun: vi.fn(async (id: string, updates: Partial<StoredEntity>) => {
    const iterationRun = hoisted.iterationRuns.find((item) => item.$id === id);
    if (!iterationRun) return null;
    Object.assign(iterationRun, updates);
    return iterationRun;
  }),
  findAllBenchmarkIterationRuns: vi.fn(async () => hoisted.iterationRuns),
}));

vi.mock('../../src/lib/orchestration/ExecutorFactory.js', () => ({
  ExecutorFactory: class {
    async getExecutorForNode() {
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

  beforeEach(() => {
    resetStore();
  });

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

    hoisted.entities.set(backendId, backendEntity);
    addToTypeIndex('Backend', backendId);
    hoisted.entities.set(queryVersionId, queryVersionEntity);
    addToTypeIndex('QueryVersion', queryVersionId);

    const experimentRes = await app.inject({
      method: 'POST',
      url: '/benchmark-experiments',
      payload: {
        id: experimentId,
        name: 'E2E Benchmark',
        status: 'Active',
      },
    });
    expect(experimentRes.statusCode).toBe(201);

    const versionRes = await app.inject({
      method: 'POST',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/v`,
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
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/v/1/freeze`,
    });
    expect(freezeRes.statusCode).toBe(200);
    const frozen = freezeRes.json();
    expect(frozen.immutable).toBe(true);

    const runRes = await app.inject({
      method: 'POST',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/v/1/run`,
    });
    expect(runRes.statusCode).toBe(200);
    const runPayload = runRes.json();
    expect(runPayload.run.runStatus).toBe('Completed');
    expect(runPayload.observations).toHaveLength(1);

    const runId = runPayload.run.id;
    const runsRes = await app.inject({
      method: 'GET',
      url: `/benchmark-experiments/${encodeURIComponent(experimentId)}/v/1/runs`,
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
