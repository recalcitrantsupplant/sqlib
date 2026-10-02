import { computed, reactive } from 'vue';
import type {
  BenchmarkExperiment,
  BenchmarkExperimentCreate,
  BenchmarkExperimentUpdate,
  BenchmarkExperimentVersion,
  BenchmarkExperimentVersionCreate,
  BenchmarkExperimentVersionUpdate,
  BenchmarkRun,
} from '@sparql-query-lib/contracts';
import { useApiClient } from './useApiClient.js';
import { createVersionedEntityStore, deriveIfMatchToken } from './createVersionedEntityStore';

type BenchmarkState = {
  selectedExperiment: BenchmarkExperiment | null;
  selectedVersion: BenchmarkExperimentVersion | null;
  runs: BenchmarkRun[];
  /** The runs list's own load, beside the experiments list's. */
  runsLoading: boolean;
  runsError: string | null;
};

const useExperimentEntities = createVersionedEntityStore<
  BenchmarkExperiment,
  BenchmarkExperimentCreate,
  BenchmarkExperimentUpdate
>({
  noun: 'benchmark experiment',
  nounPlural: 'benchmark experiments',
  api: () => {
    const client = useApiClient();
    return {
      list: client.listBenchmarkExperiments,
      get: client.getBenchmarkExperiment,
      create: client.createBenchmarkExperiment,
      update: client.updateBenchmarkExperiment,
      remove: client.deleteBenchmarkExperiment,
    };
  },
});

const state = reactive<BenchmarkState>({
  selectedExperiment: null,
  selectedVersion: null,
  runs: [],
  runsLoading: false,
  runsError: null,
});

export function useBenchmarksStore() {
  const apiClient = useApiClient();
  const entities = useExperimentEntities();
  // Version tokens are kept beside the experiments', keyed `<id>/v/<n>`.
  const concurrency = entities.concurrency;

  const experiments = entities.items;
  const selectedExperiment = computed(() => state.selectedExperiment);
  const selectedVersion = computed(() => state.selectedVersion);
  const runs = computed(() => state.runs);
  const loading = computed(() => entities.loading.value || state.runsLoading);
  const error = computed(() => state.runsError ?? entities.error.value);

  const loadExperiments = entities.load;

  const fetchExperiment = async (id: string) => {
    const { data, ifMatch } = await entities.fetch(id);
    state.selectedExperiment = data;
    return { experiment: data, ifMatch };
  };

  const fetchVersion = async (experimentId: string, version: number) => {
    const result = await apiClient.getBenchmarkVersion(experimentId, version);
    const versionKey = `${experimentId}/v/${version}`;
    concurrency[versionKey] = deriveIfMatchToken(result.etag, result.data);
    state.selectedVersion = result.data;
    return {
      version: result.data,
      ifMatch: concurrency[versionKey],
    };
  };

  const loadRunsForVersion = async (experimentId: string, version: number) => {
    state.runsLoading = true;
    state.runsError = null;
    try {
      state.runs = await apiClient.listBenchmarkRuns(experimentId, version);
    } catch (err: unknown) {
      state.runsError = err instanceof Error ? err.message : 'Failed to load benchmark runs';
      state.runs = [];
    } finally {
      state.runsLoading = false;
    }
  };

  const createExperiment = entities.create;
  const updateExperiment = entities.update;
  const deleteExperiment = entities.remove;

  const createVersion = async (experimentId: string, input: BenchmarkExperimentVersionCreate) => {
    const result = await apiClient.createBenchmarkVersion(experimentId, input);
    const versionKey = `${experimentId}/v/${result.data.version}`;
    concurrency[versionKey] = deriveIfMatchToken(result.etag, result.data);
    return result.data;
  };

  const updateVersion = async (
    experimentId: string,
    version: number,
    input: BenchmarkExperimentVersionUpdate,
    explicitIfMatch?: string | null
  ) => {
    const versionKey = `${experimentId}/v/${version}`;
    const ifMatch = explicitIfMatch ?? concurrency[versionKey] ?? null;
    const result = await apiClient.updateBenchmarkVersion(experimentId, version, input, { ifMatch });
    concurrency[versionKey] = deriveIfMatchToken(result.etag, result.data);
    return result.data;
  };

  const freezeVersion = async (experimentId: string, version: number) => {
    const result = await apiClient.freezeBenchmarkVersion(experimentId, version);
    const versionKey = `${experimentId}/v/${version}`;
    concurrency[versionKey] = deriveIfMatchToken(result.etag, result.data);
    state.selectedVersion = result.data;
    return result.data;
  };

  const executeRun = async (experimentId: string, version: number) => {
    const response = await apiClient.executeBenchmarkRun(experimentId, version);
    // Add the new run to the runs list
    if (response.run) {
      state.runs = [response.run as BenchmarkRun, ...state.runs];
    }
    return response;
  };

  const listVersions = async (experimentId: string) => {
    return apiClient.listBenchmarkVersions(experimentId);
  };

  /*
   * The request rows and both second-level tables in one call, because the
   * views draw them together: a pass is only readable beside the request it
   * belongs to, and fetching it separately would leave the panel briefly
   * claiming a rules request had none.
   */
  const getRunObservations = async (runId: string) => {
    const [observations, nodeObservations, iterationObservations] = await Promise.all([
      apiClient.listBenchmarkRunObservations(runId),
      apiClient.listBenchmarkRunNodeObservations(runId),
      apiClient.listBenchmarkRunIterationObservations(runId),
    ]);
    return { observations, nodeObservations, iterationObservations };
  };

  return {
    experiments,
    selectedExperiment,
    selectedVersion,
    runs,
    loading,
    error,
    concurrency,
    loadExperiments,
    fetchExperiment,
    fetchVersion,
    listVersions,
    loadRunsForVersion,
    createExperiment,
    updateExperiment,
    deleteExperiment,
    createVersion,
    updateVersion,
    freezeVersion,
    executeRun,
    getRunObservations,
  };
}
