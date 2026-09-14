import { computed, ref, type Ref } from 'vue';

/**
 * Runs a benchmark for the query group currently on screen and summarises it.
 *
 * The benchmark API is generic - an experiment holds a version, a version holds
 * subject specs, a run produces observations - which is the right shape for
 * comparing several subjects across backends, and far more than the group screen
 * needs. This composable collapses it to the one question that screen asks: "how
 * long does this group take, and which node is the slow one?"
 *
 * It benchmarks the *saved* version, not the canvas. Benchmarking unsaved edits
 * would mean either persisting them silently or measuring something the user
 * cannot point at afterwards.
 */

export interface BenchmarkNodeSummary {
  nodeId: string;
  label: string;
  runs: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  /** Rows or triples, whichever the node produced. */
  resultCount: number;
  failed: number;
}

export interface BenchmarkSummary {
  repeats: number;
  runs: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  failed: number;
  firstError: string | null;
  nodes: BenchmarkNodeSummary[];
}

type ObservationLike = {
  durationMs?: unknown;
  resultCount?: unknown;
  success?: unknown;
  errorMessage?: unknown;
  node?: unknown;
  nodeIndex?: unknown;
};

type ApiClient = {
  listBenchmarkExperiments: () => Promise<Array<{ id: string; name?: string | null }>>;
  createBenchmarkExperiment: (input: { name: string; description?: string | null }) => Promise<{ id: string }>;
  createBenchmarkVersion: (experimentId: string, input: Record<string, unknown>) => Promise<{ version: number }>;
  executeBenchmarkRun: (experimentId: string, version: number) => Promise<{
    observations: ObservationLike[];
    nodeObservations: ObservationLike[];
  }>;
};

type Options = {
  api: ApiClient;
  /** Saved group version to benchmark; null while nothing is saved. */
  versionId: Ref<string | null | undefined>;
  groupName: Ref<string | undefined>;
  /** Human label for a node IRI, for the per-node table. */
  nodeLabel: (nodeId: string) => string;
};

const numeric = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Mean/min/max over a set of durations, or zeroes when there are none. */
const summarise = (durations: number[]) => ({
  runs: durations.length,
  meanMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
  minMs: durations.length ? Math.min(...durations) : 0,
  maxMs: durations.length ? Math.max(...durations) : 0,
});

export function useQueryGroupBenchmark({ api, versionId, groupName, nodeLabel }: Options) {
  const isRunning = ref(false);
  const error = ref<string | null>(null);
  const summary = ref<BenchmarkSummary | null>(null);
  const repeats = ref(3);

  const canRun = computed(() => Boolean(versionId.value) && !isRunning.value);

  /**
   * One experiment per group, reused across runs so the versions accumulate as a
   * history instead of littering the list with a new experiment each time.
   */
  const findOrCreateExperiment = async (): Promise<string> => {
    const name = `Query group: ${groupName.value ?? 'untitled'}`;
    const existing = await api.listBenchmarkExperiments();
    const match = existing.find(experiment => experiment.name === name);
    if (match) return match.id;
    const created = await api.createBenchmarkExperiment({
      name,
      description: 'Created from the query group screen.',
    });
    return created.id;
  };

  const run = async () => {
    const subject = versionId.value;
    if (!subject) {
      error.value = 'Save the query group before benchmarking it.';
      return;
    }

    isRunning.value = true;
    error.value = null;
    summary.value = null;

    try {
      const experimentId = await findOrCreateExperiment();
      const version = await api.createBenchmarkVersion(experimentId, {
        subjectSpecs: [{ subject }],
        repeats: repeats.value,
      });
      const result = await api.executeBenchmarkRun(experimentId, version.version);

      const groupDurations = result.observations
        .map(observation => numeric(observation.durationMs))
        .filter((value): value is number => value !== null);
      const failed = result.observations.filter(observation => observation.success === false).length;
      const firstFailure = result.observations.find(observation => observation.success === false);

      // Node observations arrive one per node per repeat, so they group by node.
      const byNode = new Map<string, { durations: number[]; resultCount: number; failed: number }>();
      for (const observation of result.nodeObservations) {
        const nodeId = typeof observation.node === 'string' ? observation.node : null;
        if (!nodeId) continue;
        const entry = byNode.get(nodeId) ?? { durations: [], resultCount: 0, failed: 0 };
        const duration = numeric(observation.durationMs);
        if (duration !== null) entry.durations.push(duration);
        entry.resultCount = numeric(observation.resultCount) ?? entry.resultCount;
        if (observation.success === false) entry.failed += 1;
        byNode.set(nodeId, entry);
      }

      const nodes: BenchmarkNodeSummary[] = [...byNode.entries()]
        .map(([nodeId, entry]) => ({
          nodeId,
          label: nodeLabel(nodeId),
          resultCount: entry.resultCount,
          failed: entry.failed,
          ...summarise(entry.durations),
        }))
        // Slowest first: the reason to open this dialog is to find the slow node.
        .sort((a, b) => b.meanMs - a.meanMs);

      summary.value = {
        repeats: repeats.value,
        failed,
        firstError: typeof firstFailure?.errorMessage === 'string' ? firstFailure.errorMessage : null,
        nodes,
        ...summarise(groupDurations),
      };
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : String(caught);
      // The benchmark routes are behind FEATURE_BENCHMARKS; a 404 here means the
      // feature is off, which is worth saying plainly rather than as "not found".
      error.value = /404|not found/i.test(message)
        ? 'Benchmarks are disabled on this server (FEATURE_BENCHMARKS).'
        : message;
    } finally {
      isRunning.value = false;
    }
  };

  return { isRunning, error, summary, repeats, canRun, run };
}
