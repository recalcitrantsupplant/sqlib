import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useQueryGroupBenchmark } from '../../src/composables/useQueryGroupBenchmark';

const VERSION = 'urn:sqlib:group-version:v1';
const NODE_A = 'urn:sqlib:node:a';
const NODE_B = 'urn:sqlib:node:b';

const observation = (durationMs: number, extra: Record<string, unknown> = {}) => ({
  durationMs, resultCount: 3, success: true, ...extra,
});

function makeFixture(overrides: Partial<Record<string, any>> = {}) {
  const api = {
    listBenchmarkExperiments: vi.fn().mockResolvedValue([]),
    createBenchmarkExperiment: vi.fn().mockResolvedValue({ id: 'urn:sqlib:benchmark-experiment:1' }),
    createBenchmarkVersion: vi.fn().mockResolvedValue({ version: 1 }),
    executeBenchmarkRun: vi.fn().mockResolvedValue({
      observations: [observation(30), observation(50)],
      nodeObservations: [
        observation(5, { node: NODE_A }),
        observation(15, { node: NODE_A }),
        observation(25, { node: NODE_B }),
        observation(35, { node: NODE_B }),
      ],
    }),
    ...overrides,
  };
  const benchmark = useQueryGroupBenchmark({
    api: api as any,
    versionId: ref<string | null>(VERSION),
    groupName: ref('Cities'),
    nodeLabel: (id: string) => (id === NODE_A ? 'Fetch cities' : 'Enrich'),
  });
  return { api, benchmark };
}

describe('useQueryGroupBenchmark', () => {
  it('summarises whole-group and per-node timings, slowest node first', async () => {
    const { benchmark } = makeFixture();
    await benchmark.run();

    const summary = benchmark.summary.value!;
    expect(summary.runs).toBe(2);
    expect(summary.meanMs).toBe(40);
    expect(summary.minMs).toBe(30);
    expect(summary.maxMs).toBe(50);

    // Ordered by mean descending: the point of the table is to find the slow node.
    expect(summary.nodes.map(node => node.label)).toEqual(['Enrich', 'Fetch cities']);
    expect(summary.nodes[0]).toMatchObject({ nodeId: NODE_B, meanMs: 30, minMs: 25, maxMs: 35, runs: 2 });
    expect(summary.nodes[1]).toMatchObject({ nodeId: NODE_A, meanMs: 10 });
  });

  it('benchmarks the saved version, and refuses when there is none', async () => {
    const api = {
      listBenchmarkExperiments: vi.fn().mockResolvedValue([]),
      createBenchmarkExperiment: vi.fn(),
      createBenchmarkVersion: vi.fn(),
      executeBenchmarkRun: vi.fn(),
    };
    const benchmark = useQueryGroupBenchmark({
      api: api as any,
      versionId: ref<string | null>(null),
      groupName: ref('Cities'),
      nodeLabel: (id: string) => id,
    });

    expect(benchmark.canRun.value).toBe(false);
    await benchmark.run();
    expect(benchmark.error.value).toContain('Save the query group');
    // Nothing was created: a refusal must not leave a stray experiment behind.
    expect(api.createBenchmarkExperiment).not.toHaveBeenCalled();
  });

  it('reuses one experiment per group instead of creating one per run', async () => {
    const { api, benchmark } = makeFixture({
      listBenchmarkExperiments: vi.fn().mockResolvedValue([
        { id: 'urn:sqlib:benchmark-experiment:existing', name: 'Query group: Cities' },
      ]),
    });

    await benchmark.run();

    expect(api.createBenchmarkExperiment).not.toHaveBeenCalled();
    expect(api.createBenchmarkVersion).toHaveBeenCalledWith(
      'urn:sqlib:benchmark-experiment:existing',
      { subjectSpecs: [{ subject: VERSION }], repeats: 3 },
    );
  });

  it('reports a disabled benchmarks feature as such rather than as "not found"', async () => {
    const { benchmark } = makeFixture({
      listBenchmarkExperiments: vi.fn().mockRejectedValue(new Error('Request failed: 404 Not Found')),
    });

    await benchmark.run();
    expect(benchmark.error.value).toContain('FEATURE_BENCHMARKS');
    expect(benchmark.isRunning.value).toBe(false);
  });

  it('surfaces failed runs with the first error', async () => {
    const { benchmark } = makeFixture({
      executeBenchmarkRun: vi.fn().mockResolvedValue({
        observations: [
          observation(30),
          { durationMs: 0, resultCount: 0, success: false, errorMessage: 'backend unreachable' },
        ],
        nodeObservations: [],
      }),
    });

    await benchmark.run();
    const summary = benchmark.summary.value!;
    expect(summary.failed).toBe(1);
    expect(summary.firstError).toBe('backend unreachable');
    // The successful run still counts towards the timing.
    expect(summary.runs).toBe(2);
  });
});
