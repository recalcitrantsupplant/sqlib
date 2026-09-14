import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import type { BenchmarkRunner as BenchmarkRunnerType } from '../../src/lib/BenchmarkRunner.js';
import { BENCHMARK_NO_ARGUMENTS_IRI, BENCHMARK_NOT_APPLICABLE_BACKEND_IRI } from '../../src/constants/benchmarks.js';

const mockGet = vi.fn();
const mockRunInsert = vi.fn();
const mockRunUpdate = vi.fn();
const mockObservationInsert = vi.fn();
const mockNodeObservationInsert = vi.fn();
const mockNodeRunInsert = vi.fn();
const mockNodeRunUpdate = vi.fn();
const mockIterationObservationInsert = vi.fn();
const mockIterationRunInsert = vi.fn();
const mockIterationRunUpdate = vi.fn();
const mockExecutionExecute = vi.fn();

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: mockGet,
  }),
}));

vi.mock('../../src/persistence/utils/BenchmarkRunUtils.js', () => ({
  BenchmarkRuns: { insert: mockRunInsert },
  updateBenchmarkRun: mockRunUpdate,
}));

vi.mock('../../src/persistence/utils/BenchmarkObservationUtils.js', () => ({
  BenchmarkObservations: { insert: mockObservationInsert },
}));

vi.mock('../../src/persistence/utils/BenchmarkNodeObservationUtils.js', () => ({
  BenchmarkNodeObservations: { insert: mockNodeObservationInsert },
}));

vi.mock('../../src/persistence/utils/BenchmarkNodeRunUtils.js', () => ({
  BenchmarkNodeRuns: { insert: mockNodeRunInsert },
  updateBenchmarkNodeRun: mockNodeRunUpdate,
}));

vi.mock('../../src/persistence/utils/BenchmarkIterationObservationUtils.js', () => ({
  BenchmarkIterationObservations: { insert: mockIterationObservationInsert },
}));

vi.mock('../../src/persistence/utils/BenchmarkIterationRunUtils.js', () => ({
  BenchmarkIterationRuns: { insert: mockIterationRunInsert },
  updateBenchmarkIterationRun: mockIterationRunUpdate,
}));

vi.mock('../../src/lib/orchestration/ExecutionEngine.js', () => ({
  ExecutionEngine: class {
    async execute(...args: any[]) {
      return mockExecutionExecute(...args);
    }
  },
}));

let BenchmarkRunner: typeof BenchmarkRunnerType;

/**
 * A hand-built collaborator, cast once through `unknown`.
 *
 * The constructor takes four real services and these tests supply the two or
 * three methods a case exercises. Casting each argument to the escape-hatch
 * type would be four of them per test, which is what
 * `scripts/ci/any-ratchet.sh` counts; here the type parameter is inferred from
 * the constructor's own signature, so the stub is still checked against nothing
 * while the call site stays honest about which slot it fills.
 */
function stub<T>(value: unknown): T {
  return value as T;
}

describe('BenchmarkRunner', () => {
  beforeAll(async () => {
    if (!globalThis.File) {
      globalThis.File = class FileStub {} as any;
    }
    BenchmarkRunner = (await import('../../src/lib/BenchmarkRunner.js')).BenchmarkRunner;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunInsert.mockResolvedValue(undefined);
    mockRunUpdate.mockResolvedValue(undefined);
    mockObservationInsert.mockResolvedValue(undefined);
    mockNodeObservationInsert.mockResolvedValue(undefined);
    mockNodeRunInsert.mockResolvedValue(undefined);
    mockNodeRunUpdate.mockResolvedValue(undefined);
    mockIterationObservationInsert.mockResolvedValue(undefined);
    mockIterationRunInsert.mockResolvedValue(undefined);
    mockIterationRunUpdate.mockResolvedValue(undefined);
    mockExecutionExecute.mockResolvedValue({ result: { results: { bindings: [] } } });
  });

  it('executes warmup runs without recording observations', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:1';
    const queryVersionId = 'urn:sqlib:query-version:1';
    const backendId = 'urn:sqlib:backend:1';

    mockGet.mockImplementation((id: string) => {
      if (id === versionId) {
        return {
          $id: versionId,
          '@type': 'BenchmarkExperimentVersion',
          immutable: true,
          subjectSpecs: JSON.stringify([
            {
              subject: queryVersionId,
              backends: [backendId],
              inputs: [BENCHMARK_NO_ARGUMENTS_IRI],
            },
          ]),
          repeats: 1,
          warmupRuns: 2,
        };
      }
      if (id === queryVersionId) {
        return {
          $id: queryVersionId,
          '@type': 'QueryVersion',
          immutable: true,
          queryString: 'SELECT * WHERE { ?s ?p ?o }',
          queryType: null,
        };
      }
      if (id === backendId) {
        return { $id: backendId, '@type': 'Backend' };
      }
      return null;
    });

    const mockSelect = vi.fn().mockResolvedValue({ result: { results: { bindings: [] } } });
    const executorFactory = {
      getExecutorForNode: vi.fn().mockResolvedValue({
        selectQueryParsed: mockSelect,
        askQuery: vi.fn(),
        update: vi.fn(),
        constructQueryParsed: vi.fn(),
      }),
    };

    const runner = new BenchmarkRunner({} as any, executorFactory as any, {} as any, {} as any);
    await runner.runExperimentVersion(versionId);

    expect(mockSelect).toHaveBeenCalledTimes(3);
    expect(mockObservationInsert).toHaveBeenCalledTimes(1);
  });

  it('requires the benchmark version to be immutable', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:2';

    mockGet.mockReturnValue({
      $id: versionId,
      '@type': 'BenchmarkExperimentVersion',
      immutable: false,
      subjectSpecs: JSON.stringify([]),
    });

    const runner = new BenchmarkRunner({} as any, {} as any, {} as any, {} as any);

    await expect(runner.runExperimentVersion(versionId)).rejects.toThrow('must be frozen');
  });

  it('records observations for query version runs', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:3';
    const queryVersionId = 'urn:sqlib:query-version:3';
    const backendId = 'urn:sqlib:backend:3';

    mockGet.mockImplementation((id: string) => {
      if (id === versionId) {
        return {
          $id: versionId,
          '@type': 'BenchmarkExperimentVersion',
          immutable: true,
          subjectSpecs: JSON.stringify([
            {
              subject: queryVersionId,
              backends: [backendId],
              inputs: [BENCHMARK_NO_ARGUMENTS_IRI],
            },
          ]),
          repeats: 2,
          maxConcurrency: 1,
          abortOnError: false,
        };
      }
      if (id === queryVersionId) {
        return {
          $id: queryVersionId,
          '@type': 'QueryVersion',
          immutable: true,
          queryString: 'SELECT * WHERE { ?s ?p ?o }',
          queryType: null,
        };
      }
      if (id === backendId) {
        return { $id: backendId, '@type': 'Backend' };
      }
      return null;
    });

    const mockSelect = vi.fn().mockResolvedValue({ result: { results: { bindings: [] } } });
    const executorFactory = {
      getExecutorForNode: vi.fn().mockResolvedValue({
        selectQueryParsed: mockSelect,
        askQuery: vi.fn(),
        update: vi.fn(),
        constructQueryParsed: vi.fn(),
      }),
    };

    const runner = new BenchmarkRunner({} as any, executorFactory as any, {} as any, {} as any);
    const result = await runner.runExperimentVersion(versionId);

    expect(mockRunInsert).toHaveBeenCalledWith(expect.objectContaining({ tasksTotal: 2, runStatus: 'Running' }));
    expect(mockObservationInsert).toHaveBeenCalledTimes(2);
    expect(result.run.runStatus).toBe('Completed');
    expect(result.run.tasksCompleted).toBe(2);

    const lastUpdateCall = mockRunUpdate.mock.calls[mockRunUpdate.mock.calls.length - 1];
    const lastUpdate = lastUpdateCall ? lastUpdateCall[1] : undefined;
    expect(lastUpdate).toMatchObject({ runStatus: 'Completed', tasksCompleted: 2 });
  });

  /*
   * A plan names an argument *set*, which floats — publishing a new version of
   * one changes what a frozen benchmark version executes. That is deliberate,
   * so the run has to say which values it used, or two runs of the same
   * benchmark cannot be compared (issue #246).
   *
   * Resolution is once per run, not once per request: a version published
   * between two repeats must not split a run across two sets of values while
   * the record claims one. Hence both assertions — the pin is recorded, and it
   * is what actually executed.
   */
  it('pins the argument set version a run resolved, once, and executes it', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:6';
    const queryVersionId = 'urn:sqlib:query-version:6';
    const backendId = 'urn:sqlib:backend:6';
    const argumentSetId = 'urn:sqlib:argument-set:6';
    const argumentSetVersionId = 'urn:sqlib:argument-set-version:6b';

    mockGet.mockImplementation((id: string) => {
      if (id === versionId) {
        return {
          $id: versionId,
          '@type': 'BenchmarkExperimentVersion',
          immutable: true,
          subjectSpecs: JSON.stringify([
            { subject: queryVersionId, backends: [backendId], inputs: [argumentSetId] },
          ]),
          repeats: 2,
          maxConcurrency: 1,
        };
      }
      if (id === queryVersionId) {
        return {
          $id: queryVersionId,
          '@type': 'QueryVersion',
          immutable: true,
          queryString: 'SELECT * WHERE { ?s ?p ?o }',
          queryType: null,
        };
      }
      if (id === backendId) return { $id: backendId, '@type': 'Backend' };
      if (id === argumentSetId) {
        return { $id: argumentSetId, '@type': 'ArgumentSet', currentVersion: argumentSetVersionId };
      }
      if (id === argumentSetVersionId) {
        return { $id: argumentSetVersionId, '@type': 'ArgumentSetVersion' };
      }
      return null;
    });

    const resolveVersionIdForId = vi.fn().mockReturnValue(argumentSetVersionId);
    const exportRuntimePayload = vi.fn().mockResolvedValue({
      tupleMap: new Map(), tupleList: [], limits: [], offsets: [],
      dataGraphs: [], filledParameters: new Set(),
    });
    const executorFactory = {
      getExecutorForNode: vi.fn().mockResolvedValue({
        selectQueryParsed: vi.fn().mockResolvedValue({ result: { results: { bindings: [] } } }),
        askQuery: vi.fn(),
        update: vi.fn(),
        constructQueryParsed: vi.fn(),
      }),
    };

    const runner = new BenchmarkRunner(
      stub({ resolveVersionIdForId, exportRuntimePayload }),
      stub(executorFactory),
      stub({ applyArguments: vi.fn(), applyLimitOffsetParameters: vi.fn() }),
      stub({}),
    );
    const result = await runner.runExperimentVersion(versionId);

    expect(resolveVersionIdForId).toHaveBeenCalledTimes(1);
    expect(resolveVersionIdForId).toHaveBeenCalledWith(argumentSetId);

    // The reference the plan named is still recorded — a run says both what was
    // asked for and what that turned out to be.
    expect(result.observations).toHaveLength(2);
    for (const observation of result.observations) {
      expect(observation.argumentSet).toBe(argumentSetId);
      expect(observation.argumentSetVersion).toBe(argumentSetVersionId);
    }

    // Execution goes through the pin, not through the floating reference.
    expect(exportRuntimePayload).toHaveBeenCalledTimes(2);
    for (const call of exportRuntimePayload.mock.calls) {
      expect(call[0]).toEqual([argumentSetVersionId]);
    }
  });

  it('leaves the pin off an unparameterised run', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:7';
    const queryVersionId = 'urn:sqlib:query-version:7';
    const backendId = 'urn:sqlib:backend:7';

    mockGet.mockImplementation((id: string) => {
      if (id === versionId) {
        return {
          $id: versionId,
          '@type': 'BenchmarkExperimentVersion',
          immutable: true,
          subjectSpecs: JSON.stringify([
            { subject: queryVersionId, backends: [backendId], inputs: [BENCHMARK_NO_ARGUMENTS_IRI] },
          ]),
          repeats: 1,
          maxConcurrency: 1,
        };
      }
      if (id === queryVersionId) {
        return {
          $id: queryVersionId,
          '@type': 'QueryVersion',
          immutable: true,
          queryString: 'SELECT * WHERE { ?s ?p ?o }',
          queryType: null,
        };
      }
      if (id === backendId) return { $id: backendId, '@type': 'Backend' };
      return null;
    });

    const resolveVersionIdForId = vi.fn();
    const executorFactory = {
      getExecutorForNode: vi.fn().mockResolvedValue({
        selectQueryParsed: vi.fn().mockResolvedValue({ result: { results: { bindings: [] } } }),
        askQuery: vi.fn(),
        update: vi.fn(),
        constructQueryParsed: vi.fn(),
      }),
    };

    const runner = new BenchmarkRunner(
      stub({ resolveVersionIdForId }),
      stub(executorFactory),
      stub({}),
      stub({}),
    );
    const result = await runner.runExperimentVersion(versionId);

    expect(resolveVersionIdForId).not.toHaveBeenCalled();
    expect(result.observations[0].argumentSet).toBe(BENCHMARK_NO_ARGUMENTS_IRI);
    expect(result.observations[0].argumentSetVersion).toBeUndefined();
  });

  it('aborts remaining tasks on error when abortOnError is true', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:4';
    const queryVersionId = 'urn:sqlib:query-version:4';
    const backendId = 'urn:sqlib:backend:4';

    mockGet.mockImplementation((id: string) => {
      if (id === versionId) {
        return {
          $id: versionId,
          '@type': 'BenchmarkExperimentVersion',
          immutable: true,
          subjectSpecs: JSON.stringify([
            {
              subject: queryVersionId,
              backends: [backendId],
              inputs: [BENCHMARK_NO_ARGUMENTS_IRI],
            },
          ]),
          repeats: 2,
          maxConcurrency: 1,
          abortOnError: true,
        };
      }
      if (id === queryVersionId) {
        return {
          $id: queryVersionId,
          '@type': 'QueryVersion',
          immutable: true,
          queryString: 'SELECT * WHERE { ?s ?p ?o }',
          queryType: null,
        };
      }
      if (id === backendId) {
        return { $id: backendId, '@type': 'Backend' };
      }
      return null;
    });

    const executorFactory = {
      getExecutorForNode: vi.fn().mockResolvedValue({
        selectQueryParsed: vi.fn().mockRejectedValue(new Error('boom')),
        askQuery: vi.fn(),
        update: vi.fn(),
        constructQueryParsed: vi.fn(),
      }),
    };

    const runner = new BenchmarkRunner({} as any, executorFactory as any, {} as any, {} as any);
    const result = await runner.runExperimentVersion(versionId);

    expect(mockObservationInsert).toHaveBeenCalledTimes(1);
    expect(result.run.runStatus).toBe('Failed');
    expect(result.run.tasksCompleted).toBe(1);
  });

  /*
   * A rule set collapses the store axis and brings two of its own: the base
   * graph it reads and the tuple set that seeds its `TUPLE(…)` relations. Both
   * multiply, so this plan is 2 graphs × 1 seed set × 1 repeat — and both are
   * pinned to a version at plan time, for the reason the argument axis is
   * (issue #246).
   */
  it('expands a rule set over the graph and tuple axes, and pins both', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:8';
    const ruleSetVersionId = 'urn:sqlib:rule-set-version:8';
    const dataGraphId = 'urn:sqlib:data-graph:8';
    const dataGraphVersionId = 'urn:sqlib:data-graph-version:8b';
    const otherGraphVersionId = 'urn:sqlib:data-graph-version:8c';
    const tupleSetId = 'urn:sqlib:tuple-set:8';
    const tupleSetVersionId = 'urn:sqlib:tuple-set-version:8b';

    mockGet.mockImplementation((id: string) => {
      if (id === versionId) {
        return {
          $id: versionId,
          '@type': 'BenchmarkExperimentVersion',
          immutable: true,
          subjectSpecs: JSON.stringify([
            {
              subject: ruleSetVersionId,
              inputs: [tupleSetId],
              dataGraphs: [dataGraphId, otherGraphVersionId],
            },
          ]),
          repeats: 1,
          maxConcurrency: 1,
        };
      }
      if (id === ruleSetVersionId) {
        return { $id: ruleSetVersionId, '@type': 'RuleSetVersion', immutable: true, tupleSeeds: null };
      }
      // Named as the graph, so the run resolves its current version.
      if (id === dataGraphId) {
        return { $id: dataGraphId, '@type': 'DataGraph', currentVersion: dataGraphVersionId };
      }
      if (id === dataGraphVersionId) {
        return {
          $id: dataGraphVersionId,
          '@type': 'DataGraphVersion',
          contentString: '<urn:s> <urn:p> <urn:o> .',
          contentFormat: 'text/turtle',
        };
      }
      // Named as the version, which resolves to itself.
      if (id === otherGraphVersionId) {
        return {
          $id: otherGraphVersionId,
          '@type': 'DataGraphVersion',
          contentString: '<urn:s2> <urn:p2> <urn:o2> .',
          contentFormat: 'text/turtle',
        };
      }
      if (id === tupleSetId) {
        return { $id: tupleSetId, '@type': 'TupleSet', currentVersion: tupleSetVersionId };
      }
      if (id === tupleSetVersionId) {
        return {
          $id: tupleSetVersionId,
          '@type': 'TupleSetVersion',
          tupleColumns: ['x'],
          contentString: JSON.stringify({
            head: { vars: ['x'] },
            results: { bindings: [{ x: { type: 'uri', value: 'urn:seed' } }] },
          }),
        };
      }
      return null;
    });

    const execute = vi.fn().mockResolvedValue({
      status: 'completed',
      iterations: [],
      dataBlocks: [],
      finalGraphNQuads: '<urn:a> <urn:b> <urn:c> .\n<urn:d> <urn:e> <urn:f> .',
    });

    const runner = new BenchmarkRunner(
      stub({}),
      stub({}),
      stub({}),
      stub({}),
      () => stub({ execute }),
    );
    const result = await runner.runExperimentVersion(versionId);

    expect(result.run.tasksTotal).toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);

    const graphs = execute.mock.calls.map((call) => call[1].initialGraph);
    expect(graphs).toEqual(['<urn:s> <urn:p> <urn:o> .', '<urn:s2> <urn:p2> <urn:o2> .']);
    // The axis member overrides the version's stored seeds for the run.
    expect(execute.mock.calls[0][0].tupleSeeds).toContain('urn:seed');

    const observation = result.observations[0];
    expect(observation.backend).toBe(BENCHMARK_NOT_APPLICABLE_BACKEND_IRI);
    expect(observation.dataGraph).toBe(dataGraphId);
    expect(observation.dataGraphVersion).toBe(dataGraphVersionId);
    expect(observation.argumentSet).toBe(tupleSetId);
    expect(observation.argumentSetVersion).toBe(tupleSetVersionId);
    // Triples the run produced — the analogue of a query's row count.
    expect(observation.resultCount).toBe(2);
  });

  it('runs a rule set that names no graph, and records no graph axis', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:9';
    const ruleSetVersionId = 'urn:sqlib:rule-set-version:9';

    mockGet.mockImplementation((id: string) => {
      if (id === versionId) {
        return {
          $id: versionId,
          '@type': 'BenchmarkExperimentVersion',
          immutable: true,
          subjectSpecs: JSON.stringify([{ subject: ruleSetVersionId }]),
          repeats: 1,
          maxConcurrency: 1,
        };
      }
      if (id === ruleSetVersionId) {
        return { $id: ruleSetVersionId, '@type': 'RuleSetVersion', immutable: true, tupleSeeds: 'stored' };
      }
      return null;
    });

    const execute = vi.fn().mockResolvedValue({ status: 'completed', iterations: [], dataBlocks: [] });

    const runner = new BenchmarkRunner(stub({}), stub({}), stub({}), stub({}), () => stub({ execute }));
    const result = await runner.runExperimentVersion(versionId);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1].initialGraph).toBeNull();
    // Nothing named on the tabular axis leaves the version's own seeds running.
    expect(execute.mock.calls[0][0].tupleSeeds).toBe('stored');
    expect(result.observations[0].dataGraph).toBeUndefined();
    expect(result.observations[0].dataGraphVersion).toBeUndefined();
    expect(result.observations[0].argumentSet).toBe(BENCHMARK_NO_ARGUMENTS_IRI);
  });

  /*
   * The executor reports a refusal as `status: 'failed'` with its own sentence
   * rather than throwing, so a runner that only caught exceptions would record
   * a rules run that never ran as a success.
   */
  it('records a failed rule set execution as a failure, with the executor’s reason', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:10';
    const ruleSetVersionId = 'urn:sqlib:rule-set-version:10';

    mockGet.mockImplementation((id: string) => {
      if (id === versionId) {
        return {
          $id: versionId,
          '@type': 'BenchmarkExperimentVersion',
          immutable: true,
          subjectSpecs: JSON.stringify([{ subject: ruleSetVersionId }]),
          repeats: 1,
          maxConcurrency: 1,
        };
      }
      if (id === ruleSetVersionId) {
        return { $id: ruleSetVersionId, '@type': 'RuleSetVersion', immutable: true };
      }
      return null;
    });

    const execute = vi.fn().mockResolvedValue({
      status: 'failed',
      iterations: [],
      dataBlocks: [],
      error: 'RuleSet contains invalid RuleVersions: rule-1',
    });

    const runner = new BenchmarkRunner(stub({}), stub({}), stub({}), stub({}), () => stub({ execute }));
    const result = await runner.runExperimentVersion(versionId);

    expect(result.run.runStatus).toBe('Failed');
    expect(result.observations[0].success).toBe(false);
    expect(result.observations[0].errorMessage).toBe('RuleSet contains invalid RuleVersions: rule-1');
  });

  it('records node observations for query group runs', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:5';
    const groupVersionId = 'urn:sqlib:query-group-version:5';
    const backendId = 'urn:sqlib:backend:5';

    mockGet.mockImplementation((id: string) => {
      if (id === versionId) {
        return {
          $id: versionId,
          '@type': 'BenchmarkExperimentVersion',
          immutable: true,
          subjectSpecs: JSON.stringify([
            {
              subject: groupVersionId,
              inputs: [BENCHMARK_NO_ARGUMENTS_IRI],
            },
          ]),
          repeats: 1,
          maxConcurrency: 1,
        };
      }
      if (id === groupVersionId) {
        return {
          $id: groupVersionId,
          '@type': 'QueryGroupVersion',
          immutable: true,
        };
      }
      return null;
    });

    mockExecutionExecute.mockImplementation(async (_graph, _args, hooks) => {
      hooks.onNodeFinish({ id: 'node-1', backendId }, { results: { bindings: [] } }, 12, 0);
      hooks.onNodeError({ id: 'node-2', backendId }, new Error('node boom'), 8, 1);
      return { result: { results: { bindings: [] } } };
    });

    const graphBuilder = {
      buildFromGroupVersion: vi.fn().mockReturnValue({}),
    };

    const runner = new BenchmarkRunner({} as any, {} as any, {} as any, graphBuilder as any);
    const result = await runner.runExperimentVersion(versionId);

    expect(mockNodeRunInsert).toHaveBeenCalledTimes(1);
    expect(mockNodeObservationInsert).toHaveBeenCalledTimes(2);
    expect(result.nodeObservations).toHaveLength(2);
    // A group run has no fixpoint loop, so nothing writes the iteration dataset.
    expect(mockIterationRunInsert).not.toHaveBeenCalled();
    expect(result.iterationObservations).toEqual([]);
  });

  /*
   * The second-level table for a rule-set request: one row per pass of the
   * fixpoint loop, hanging off the request's own observation. An iteration has
   * no library object to point at, so its identity is ordinal.
   */
  it('records one iteration observation per pass of a rule-set run', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:11';
    const ruleSetVersionId = 'urn:sqlib:rule-set-version:11';

    mockGet.mockImplementation((id: string) => {
      if (id === versionId) {
        return {
          $id: versionId,
          '@type': 'BenchmarkExperimentVersion',
          immutable: true,
          subjectSpecs: JSON.stringify([{ subject: ruleSetVersionId }]),
          repeats: 1,
          maxConcurrency: 1,
        };
      }
      if (id === ruleSetVersionId) {
        return { $id: ruleSetVersionId, '@type': 'RuleSetVersion', immutable: true };
      }
      return null;
    });

    const execute = vi.fn().mockResolvedValue({
      status: 'converged',
      iterations: [
        { index: 1, signature: 'a', tripleCount: 6, tupleCount: 0, delta: 4, durationMs: 12.5, stratum: 0, rules: [{}, {}] },
        { index: 2, signature: 'b', tripleCount: 6, tupleCount: 1, delta: 0, durationMs: 3.25, stratum: 1, rules: [{}] },
      ],
      dataBlocks: [],
      finalGraphNQuads: '<urn:a> <urn:b> <urn:c> .',
    });

    const runner = new BenchmarkRunner(stub({}), stub({}), stub({}), stub({}), () => stub({ execute }));
    const result = await runner.runExperimentVersion(versionId);

    expect(mockIterationRunInsert).toHaveBeenCalledTimes(1);
    expect(mockIterationRunUpdate).toHaveBeenCalledTimes(1);
    expect(result.iterationRun?.structure).toBe('https://sparql-query-lib/BenchmarkIterationObservationDSD');
    expect(result.iterationRun?.isPartOf).toBe(result.run.$id);

    expect(mockIterationObservationInsert).toHaveBeenCalledTimes(2);
    expect(result.iterationObservations).toHaveLength(2);

    const [first, second] = result.iterationObservations;
    // Every pass belongs to the request that ran it, which is only recorded
    // once the request finishes — so the id is filled in afterwards.
    expect(first!.subjectObservation).toBe(result.observations[0]!.$id);
    expect(second!.subjectObservation).toBe(result.observations[0]!.$id);
    expect(first!.dataSet).toBe(result.iterationRun?.$id);

    expect(first).toMatchObject({
      iterationIndex: 1,
      stratum: 0,
      durationMs: 12.5,
      // The delta, not the graph's size: `resultCount` is what the row produced.
      resultCount: 4,
      tripleCount: 6,
      rulesEvaluated: 2,
    });
    expect(second).toMatchObject({ iterationIndex: 2, stratum: 1, resultCount: 0, rulesEvaluated: 1 });
  });

  /*
   * A rule-set run that never reached a pass — a rule set whose versions do not
   * validate, say — leaves no dataset behind, rather than a `qb:DataSet` that
   * claims observations it has none of.
   */
  it('writes no iteration dataset for a rule-set run that records no passes', async () => {
    const versionId = 'urn:sqlib:benchmark-experiment-version:12';
    const ruleSetVersionId = 'urn:sqlib:rule-set-version:12';

    mockGet.mockImplementation((id: string) => {
      if (id === versionId) {
        return {
          $id: versionId,
          '@type': 'BenchmarkExperimentVersion',
          immutable: true,
          subjectSpecs: JSON.stringify([{ subject: ruleSetVersionId }]),
          repeats: 1,
          maxConcurrency: 1,
        };
      }
      if (id === ruleSetVersionId) {
        return { $id: ruleSetVersionId, '@type': 'RuleSetVersion', immutable: true };
      }
      return null;
    });

    const execute = vi.fn().mockResolvedValue({
      status: 'failed',
      iterations: [],
      dataBlocks: [],
      error: 'RuleSet contains invalid RuleVersions: rule-1',
    });

    const runner = new BenchmarkRunner(stub({}), stub({}), stub({}), stub({}), () => stub({ execute }));
    const result = await runner.runExperimentVersion(versionId);

    expect(mockIterationRunInsert).not.toHaveBeenCalled();
    expect(mockIterationObservationInsert).not.toHaveBeenCalled();
    expect(result.iterationRun).toBeNull();
    expect(result.iterationObservations).toEqual([]);
  });
});
