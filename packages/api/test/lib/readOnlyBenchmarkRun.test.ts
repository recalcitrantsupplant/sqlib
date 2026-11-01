/**
 * A benchmark run on a read-only deployment: a frozen, seeded version, run
 * within the deployment's caps, keeping nothing.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type * as RunnerModule from '../../src/lib/BenchmarkRunner.js';
import type * as ReadOnlyModule from '../../src/lib/readOnlyBenchmarkRun.js';
import { BENCHMARK_NO_ARGUMENTS_IRI } from '../../src/constants/benchmarks.js';
import { overrideRepositoryLenses } from '../../src/persistence/utils/entityRepository.js';
import { FakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

const mockGet = vi.fn();

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: mockGet }),
}));

let runner: typeof RunnerModule;
let readOnly: typeof ReadOnlyModule;

const versionId = 'urn:sqlib:benchmark-experiment-version:ro';
const queryVersionId = 'urn:sqlib:query-version:ro';
const backendId = 'urn:sqlib:backend:ro';

function seedVersion(overrides: Record<string, unknown> = {}) {
  mockGet.mockImplementation((id: string) => {
    if (id === versionId) {
      return {
        $id: versionId,
        '@type': 'BenchmarkExperimentVersion',
        immutable: true,
        subjectSpecs: JSON.stringify([{ subject: queryVersionId, backends: [backendId], inputs: [BENCHMARK_NO_ARGUMENTS_IRI] }]),
        repeats: 3,
        warmupRuns: 1,
        ...overrides,
      };
    }
    if (id === queryVersionId) {
      return { $id: queryVersionId, '@type': 'QueryVersion', immutable: true, queryString: 'SELECT * WHERE { ?s ?p ?o }', queryType: null };
    }
    if (id === backendId) return { $id: backendId, '@type': 'Backend' };
    return null;
  });
}

function executorSelecting(select: (...args: unknown[]) => Promise<unknown>) {
  const executorFactory = {
    getExecutorForBackendId: vi.fn().mockResolvedValue({
      selectQueryParsed: select,
      askQuery: vi.fn(),
      update: vi.fn(),
      constructQueryParsed: vi.fn(),
    }),
  };
  return () => new runner.BenchmarkRunner(
    { internal: true },
    {} as never,
    undefined,
    {} as never,
    undefined,
    () => executorFactory as never,
  );
}

const request = {} as FastifyRequest;
let store: FakePersistenceAdapter;
const envBefore = { ...process.env };

beforeAll(async () => {
  if (!globalThis.File) globalThis.File = class FileStub {} as never;
  runner = await import('../../src/lib/BenchmarkRunner.js');
  readOnly = await import('../../src/lib/readOnlyBenchmarkRun.js');
});

beforeEach(() => {
  vi.clearAllMocks();
  store = new FakePersistenceAdapter();
  overrideRepositoryLenses((schema) => store.lens(schema));
  readOnly.resetReadOnlyBenchmarkSlots();
});

afterEach(() => {
  overrideRepositoryLenses(null);
  process.env = { ...envBefore };
});

const empty = { result: { results: { bindings: [] } } };

describe('countPlannedRequests', () => {
  it('counts every measured task and one warmup set per distinct request', () => {
    const task = { subjectId: 's', backendId: 'b', argumentSetId: 'a', dataGraphId: null };
    expect(runner.countPlannedRequests([task, task, task], 2)).toBe(5);
    expect(runner.countPlannedRequests([task, { ...task, backendId: 'c' }], 1)).toBe(4);
  });
});

describe('the transient sink', () => {
  it('returns the observations and stores none of them', async () => {
    seedVersion();
    const make = executorSelecting(vi.fn().mockResolvedValue(empty));
    const result = await make().runExperimentVersion(versionId, { sink: runner.transientBenchmarkSink });

    expect(result.observations).toHaveLength(3);
    expect(result.run.runStatus).toBe('Completed');
    expect(store.all('BenchmarkRun')).toHaveLength(0);
    expect(store.all('BenchmarkObservation')).toHaveLength(0);
  });
});

describe('the run deadline', () => {
  it('stops the run and reports it Aborted', async () => {
    seedVersion({ repeats: 5, warmupRuns: 0 });
    const hang = vi.fn(() => new Promise(() => {}));
    const make = executorSelecting(hang);
    const result = await make().runExperimentVersion(versionId, {
      sink: runner.transientBenchmarkSink,
      deadlineMs: 50,
    });

    expect(result.run.runStatus).toBe('Aborted');
    expect(hang).toHaveBeenCalledTimes(1);
    expect(result.observations.every((o) => !o.success)).toBe(true);
  });
});

describe('runBenchmarkReadOnly', () => {
  it('runs a frozen version and keeps nothing', async () => {
    seedVersion();
    const select = vi.fn().mockResolvedValue(empty);
    const result = await readOnly.runBenchmarkReadOnly(request, versionId, executorSelecting(select));

    expect(result.observations).toHaveLength(3);
    expect(select).toHaveBeenCalledTimes(4);
    expect(store.all('BenchmarkRun')).toHaveLength(0);
  });

  it('refuses a version that is not frozen, with 409', async () => {
    seedVersion({ immutable: false });
    const select = vi.fn();
    await expect(readOnly.runBenchmarkReadOnly(request, versionId, executorSelecting(select)))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(select).not.toHaveBeenCalled();
  });

  it('refuses a plan over the request cap before any request goes out', async () => {
    process.env.SQLIB_READ_ONLY_BENCH_MAX_REQUESTS = '10';
    seedVersion({ repeats: 999999 });
    const select = vi.fn();
    await expect(readOnly.runBenchmarkReadOnly(request, versionId, executorSelecting(select)))
      .rejects.toMatchObject({ statusCode: 422, details: { cap: 'benchMaxRequests', limit: 10, planned: 1000000 } });
    expect(select).not.toHaveBeenCalled();
  });

  it('refuses a second run while one is in flight, with 429', async () => {
    seedVersion({ repeats: 1, warmupRuns: 0 });
    let release: (value: unknown) => void = () => {};
    const slow = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const first = readOnly.runBenchmarkReadOnly(request, versionId, executorSelecting(slow));
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());

    await expect(readOnly.runBenchmarkReadOnly(request, versionId, executorSelecting(vi.fn())))
      .rejects.toMatchObject({ statusCode: 429 });

    release(empty);
    await first;
    // The slot is free again once the first run ends.
    await expect(readOnly.runBenchmarkReadOnly(request, versionId, executorSelecting(vi.fn().mockResolvedValue(empty))))
      .resolves.toBeTruthy();
  });

  it('holds the run to the concurrency cap', async () => {
    process.env.SQLIB_READ_ONLY_BENCH_MAX_CONCURRENCY = '1';
    seedVersion({ repeats: 4, warmupRuns: 0, maxConcurrency: 8 });
    let running = 0;
    let peak = 0;
    const select = vi.fn(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return empty;
    });
    await readOnly.runBenchmarkReadOnly(request, versionId, executorSelecting(select));
    expect(peak).toBe(1);
  });
});
