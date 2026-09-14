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

type BenchmarkState = {
  experiments: BenchmarkExperiment[];
  selectedExperiment: BenchmarkExperiment | null;
  selectedVersion: BenchmarkExperimentVersion | null;
  runs: BenchmarkRun[];
  loading: boolean;
  error: string | null;
  concurrency: Record<string, string | null>;
};

const state = reactive<BenchmarkState>({
  experiments: [],
  selectedExperiment: null,
  selectedVersion: null,
  runs: [],
  loading: false,
  error: null,
  concurrency: {},
});

function deriveIfMatchToken(etag: string | null, entity: BenchmarkExperiment | BenchmarkExperimentVersion | null): string | null {
  if (etag && typeof etag === 'string' && etag.trim().length > 0) {
    return etag;
  }
  if (!entity) {
    return null;
  }
  return entity.dateModified ?? entity.dateCreated ?? null;
}

export function useBenchmarksStore() {
  const apiClient = useApiClient();

  const experiments = computed(() => state.experiments);
  const selectedExperiment = computed(() => state.selectedExperiment);
  const selectedVersion = computed(() => state.selectedVersion);
  const runs = computed(() => state.runs);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  const loadExperiments = async () => {
    state.loading = true;
    state.error = null;
    try {
      state.experiments = await apiClient.listBenchmarkExperiments();
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : 'Failed to load benchmark experiments';
      state.experiments = [];
    } finally {
      state.loading = false;
    }
  };

  const fetchExperiment = async (id: string) => {
    const result = await apiClient.getBenchmarkExperiment(id);
    state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
    state.selectedExperiment = result.data;
    return {
      experiment: result.data,
      ifMatch: state.concurrency[id],
    };
  };

  const fetchVersion = async (experimentId: string, version: number) => {
    const result = await apiClient.getBenchmarkVersion(experimentId, version);
    const versionKey = `${experimentId}/v/${version}`;
    state.concurrency[versionKey] = deriveIfMatchToken(result.etag, result.data);
    state.selectedVersion = result.data;
    return {
      version: result.data,
      ifMatch: state.concurrency[versionKey],
    };
  };

  const loadRunsForVersion = async (experimentId: string, version: number) => {
    state.loading = true;
    state.error = null;
    try {
      state.runs = await apiClient.listBenchmarkRuns(experimentId, version);
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : 'Failed to load benchmark runs';
      state.runs = [];
    } finally {
      state.loading = false;
    }
  };

  const createExperiment = async (input: BenchmarkExperimentCreate) => {
    const result = await apiClient.createBenchmarkExperiment(input);
    state.concurrency[result.data.id] = deriveIfMatchToken(result.etag, result.data);
    await loadExperiments();
    return result.data;
  };

  const updateExperiment = async (
    id: string,
    input: BenchmarkExperimentUpdate,
    explicitIfMatch?: string | null
  ) => {
    const ifMatch = explicitIfMatch ?? state.concurrency[id] ?? null;
    const result = await apiClient.updateBenchmarkExperiment(id, input, { ifMatch });
    state.concurrency[id] = deriveIfMatchToken(result.etag, result.data);
    await loadExperiments();
    return result.data;
  };

  const deleteExperiment = async (id: string) => {
    await apiClient.deleteBenchmarkExperiment(id);
    delete state.concurrency[id];
    await loadExperiments();
  };

  const createVersion = async (experimentId: string, input: BenchmarkExperimentVersionCreate) => {
    const result = await apiClient.createBenchmarkVersion(experimentId, input);
    const versionKey = `${experimentId}/v/${result.data.version}`;
    state.concurrency[versionKey] = deriveIfMatchToken(result.etag, result.data);
    return result.data;
  };

  const updateVersion = async (
    experimentId: string,
    version: number,
    input: BenchmarkExperimentVersionUpdate,
    explicitIfMatch?: string | null
  ) => {
    const versionKey = `${experimentId}/v/${version}`;
    const ifMatch = explicitIfMatch ?? state.concurrency[versionKey] ?? null;
    const result = await apiClient.updateBenchmarkVersion(experimentId, version, input, { ifMatch });
    state.concurrency[versionKey] = deriveIfMatchToken(result.etag, result.data);
    return result.data;
  };

  const freezeVersion = async (experimentId: string, version: number) => {
    const result = await apiClient.freezeBenchmarkVersion(experimentId, version);
    const versionKey = `${experimentId}/v/${version}`;
    state.concurrency[versionKey] = deriveIfMatchToken(result.etag, result.data);
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
    concurrency: state.concurrency,
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
