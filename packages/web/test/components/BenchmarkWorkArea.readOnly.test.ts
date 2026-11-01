/**
 * The Bench screen on a read-only deployment: the plan cannot be edited, Run
 * is offered only on a frozen version and never freezes one, and a run's
 * result comes back whole and stays on the page, because the server keeps
 * none of it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed } from 'vue';
import { NO_ARGUMENTS_IRI } from '@/lib/benchmarkPlan';

const EXPERIMENT_ID = 'urn:sqlib:benchmark:e1';
const QUERY_ID = 'urn:sqlib:query:q1';
const BACKEND_ID = 'urn:sqlib:backend:b1';

const VERSION = {
  id: 'urn:sqlib:benchmark-version:v1',
  version: 1,
  immutable: false,
  subjectSpecs: [{ subject: QUERY_ID, backends: [BACKEND_ID], inputs: [NO_ARGUMENTS_IRI] }],
  repeats: 1,
  executionStrategy: 'Sequential',
};

const api = vi.hoisted(() => ({
  listArgumentSets: vi.fn(),
  getArgumentSet: vi.fn(),
}));
const store = vi.hoisted(() => ({
  loading: { value: false },
  runs: { value: [] as unknown[] },
  selectedExperiment: { value: null as unknown },
  selectedVersion: { value: null as unknown },
  loadExperiments: vi.fn(),
  fetchExperiment: vi.fn(),
  listVersions: vi.fn(),
  fetchVersion: vi.fn(),
  loadRunsForVersion: vi.fn(),
  clearRuns: vi.fn(),
  getRunObservations: vi.fn(),
  createExperiment: vi.fn(),
  updateExperiment: vi.fn(),
  createVersion: vi.fn(),
  freezeVersion: vi.fn(),
}));
const execution = vi.hoisted(() => ({ executeRun: vi.fn() }));
const mode = vi.hoisted(() => ({ readOnly: true }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useBenchmarksStore', () => ({ useBenchmarksStore: () => store }));
vi.mock('@/composables/useBenchmarkExecution', () => ({
  useBenchmarkExecution: () => ({ isExecuting: ref(false), executeRun: execution.executeRun }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: () => ({
    isScratch: ref(false),
    hydrating: ref(false),
    savedAt: ref(null),
    flush: vi.fn(),
  }),
}));
vi.mock('@/composables/useQueriesStore', () => ({
  useQueriesStore: () => ({
    queries: { value: [{ id: QUERY_ID, name: 'Reachable pairs' }] },
    loadQueries: vi.fn(),
    loadQueryVersions: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock('@/composables/useQueryGroupsStore', () => ({
  useQueryGroupsStore: () => ({
    queryGroups: { value: [] },
    loadQueryGroups: vi.fn(),
    loadQueryGroupVersions: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({
    backends: { value: [{ id: BACKEND_ID, name: 'Live' }] },
    loadBackends: vi.fn(),
  }),
}));
vi.mock('@/composables/useCallableDrafts', () => ({
  useCallableDrafts: () => ({
    save: vi.fn(),
    remove: vi.fn(),
    draftFor: () => null,
    allDrafts: computed(() => []),
  }),
  UNASSIGNED_LIBRARY_ID: 'unassigned',
}));
vi.mock('vue-sonner', () => ({ toast }));
vi.mock('@/composables/useDeploymentMode', async () => {
  const { computed } = await import('vue');
  return {
    useDeploymentMode: () => ({
      isReadOnly: computed(() => mode.readOnly),
      isResolved: computed(() => true),
      runLimits: computed(() => (mode.readOnly
        ? { benchMaxRequests: 200, benchMaxConcurrency: 2, benchDeadlineMs: 60000, etlMaxRows: 100000 }
        : null)),
      ensureLoaded: async () => {},
    }),
  };
});

async function mountSaved() {
  const BenchmarkWorkArea = (await import('@/components/BenchmarkWorkArea.vue')).default;
  const area = mount(BenchmarkWorkArea, {
    props: { experimentId: EXPERIMENT_ID, scratchId: null },
  });
  await flushPromises();
  return area;
}

function useVersion(version: typeof VERSION) {
  store.selectedVersion.value = version;
  store.listVersions.mockResolvedValue([version]);
}

const RUN_RESPONSE = {
  run: { id: 'urn:sqlib:benchmark-run:transient', runStatus: 'Completed', tasksTotal: 1, tasksCompleted: 1, startedAt: '2026-11-01T00:00:00Z', endedAt: '2026-11-01T00:00:01Z' },
  nodeRun: null,
  iterationRun: null,
  observations: [{ id: 'urn:o1', subject: QUERY_ID, backend: BACKEND_ID, argumentSet: NO_ARGUMENTS_IRI, runIndex: 1, durationMs: 12, resultCount: 3, success: true }],
  nodeObservations: [],
  iterationObservations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mode.readOnly = true;
  store.selectedExperiment.value = { id: EXPERIMENT_ID, name: 'Reachability', status: 'Active' };
  store.fetchExperiment.mockResolvedValue(undefined);
  store.fetchVersion.mockResolvedValue(undefined);
  store.loadRunsForVersion.mockResolvedValue(undefined);
  store.loadExperiments.mockResolvedValue(undefined);
  execution.executeRun.mockResolvedValue(RUN_RESPONSE);
  api.listArgumentSets.mockResolvedValue([]);
});

describe('BenchmarkWorkArea on a read-only deployment', () => {
  it('runs a frozen version without freezing it, and shows the run it got back', async () => {
    useVersion({ ...VERSION, immutable: true });
    const area = await mountSaved();
    const reloadsBefore = store.loadRunsForVersion.mock.calls.length;

    await area.get('[data-testid="run-bar-run"]').trigger('click');
    await flushPromises();

    expect(store.freezeVersion).not.toHaveBeenCalled();
    expect(execution.executeRun).toHaveBeenCalledWith(EXPERIMENT_ID, 1);
    // The run is read from the response, not reloaded from a server that kept none.
    expect(store.loadRunsForVersion.mock.calls.length).toBe(reloadsBefore);
    expect(store.getRunObservations).not.toHaveBeenCalledWith(RUN_RESPONSE.run.id);
    expect(area.text()).toContain('not kept');
  });

  it('offers no Run on a version that is not frozen', async () => {
    useVersion(VERSION);
    const area = await mountSaved();

    const run = area.get('[data-testid="run-bar-run"]');
    expect(run.attributes('disabled')).toBeDefined();
    await run.trigger('click');
    await flushPromises();
    expect(execution.executeRun).not.toHaveBeenCalled();
    expect(store.freezeVersion).not.toHaveBeenCalled();
  });

  it('says the deployment is read-only, and offers no way to add to the plan', async () => {
    useVersion({ ...VERSION, immutable: true });
    const area = await mountSaved();

    expect(area.find('[data-testid="benchmark-read-only-note"]').exists()).toBe(true);
    expect(area.find('[data-testid="benchmark-add-cases"]').exists()).toBe(false);
  });

  it('offers adding to the plan on a deployment that writes', async () => {
    mode.readOnly = false;
    useVersion({ ...VERSION, immutable: true });
    const area = await mountSaved();

    expect(area.find('[data-testid="benchmark-read-only-note"]').exists()).toBe(false);
    expect(area.find('[data-testid="benchmark-add-cases"]').exists()).toBe(true);
  });
});
