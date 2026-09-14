/**
 * The library's data graphs, and the versions under each.
 *
 * Versions are cached per graph rather than globally because that is how they
 * are read: a record page shows one graph's history, and the strip in the rules
 * editor wants one version per graph. Nothing needs every version in the
 * library at once.
 */
import { computed, reactive } from 'vue';
import type { DataGraph } from '@sparql-query-lib/contracts';
import { useApiClient, type DataGraphVersion } from './useApiClient.js';

type DataGraphsState = {
  dataGraphs: DataGraph[];
  versionsByGraph: Record<string, DataGraphVersion[]>;
  loading: boolean;
  error: string | null;
  concurrency: Record<string, string | null>;
};

const state = reactive<DataGraphsState>({
  dataGraphs: [],
  versionsByGraph: {},
  loading: false,
  error: null,
  concurrency: {},
});

export function useDataGraphsStore() {
  const apiClient = useApiClient();

  const dataGraphs = computed(() => state.dataGraphs);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  const loadDataGraphs = async () => {
    state.loading = true;
    state.error = null;
    try {
      state.dataGraphs = await apiClient.listDataGraphs();
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : 'Failed to load data graphs';
      state.dataGraphs = [];
    } finally {
      state.loading = false;
    }
  };

  const versionsFor = (graphId: string) => computed(() => state.versionsByGraph[graphId] ?? []);

  const loadVersions = async (graphId: string) => {
    const versions = await apiClient.listDataGraphVersions(graphId);
    state.versionsByGraph[graphId] = versions;
    return versions;
  };

  const getDataGraph = async (graphId: string) => {
    const { data, etag } = await apiClient.getDataGraph(graphId);
    state.concurrency[graphId] = etag ?? data.dateModified ?? null;
    return data;
  };

  const createDataGraph = async (input: Parameters<typeof apiClient.createDataGraph>[0]) => {
    const { data } = await apiClient.createDataGraph(input);
    state.dataGraphs = [...state.dataGraphs, data];
    return data;
  };

  const updateDataGraph = async (
    graphId: string,
    input: Parameters<typeof apiClient.updateDataGraph>[1],
  ) => {
    const { data, etag } = await apiClient.updateDataGraph(graphId, input, {
      ifMatch: state.concurrency[graphId] ?? null,
    });
    state.concurrency[graphId] = etag ?? data.dateModified ?? null;
    state.dataGraphs = state.dataGraphs.map(graph => (graph.id === graphId ? data : graph));
    return data;
  };

  const createVersion = async (
    graphId: string,
    input: { contentString: string; contentFormat?: string | null; comment?: string | null },
  ) => {
    const { data } = await apiClient.createDataGraphVersion(graphId, input);
    state.versionsByGraph[graphId] = [...(state.versionsByGraph[graphId] ?? []), data];
    // The server repoints the graph at the new version; mirroring it here keeps
    // a listing's "v3" from lagging a save by one refresh.
    state.dataGraphs = state.dataGraphs.map(graph =>
      graph.id === graphId ? { ...graph, currentVersion: data.id } : graph,
    );
    return data;
  };

  /**
   * Write (or clear) a version's note. The cached list is updated in place so
   * the Details row shows what was typed without a refetch.
   */
  const annotateVersion = async (graphId: string, version: number, comment: string | null) => {
    const { data } = await apiClient.annotateDataGraphVersion(graphId, version, comment);
    state.versionsByGraph[graphId] = (state.versionsByGraph[graphId] ?? []).map(entry =>
      entry.id === data.id ? data : entry,
    );
    return data;
  };

  const deleteDataGraph = async (graphId: string) => {
    await apiClient.deleteDataGraph(graphId);
    state.dataGraphs = state.dataGraphs.filter(graph => graph.id !== graphId);
    delete state.versionsByGraph[graphId];
    delete state.concurrency[graphId];
  };

  return {
    dataGraphs,
    loading,
    error,
    loadDataGraphs,
    versionsFor,
    loadVersions,
    getDataGraph,
    createDataGraph,
    updateDataGraph,
    createVersion,
    annotateVersion,
    deleteDataGraph,
  };
}
