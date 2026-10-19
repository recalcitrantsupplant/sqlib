/**
 * Pressing Run on a saved benchmark.
 *
 * Every spec of the Bench screen mocked the run, so nothing noticed that it
 * could never start against a real API. Two things stood in the way:
 *
 * - The runner refuses a version that is not frozen, and nothing on the screen
 *   froze one. A version is saved mutable, so the first Run always met a 409.
 * - The request said its body was JSON and sent none, which Fastify answers
 *   with a 400 before the route runs.
 *
 * The first is pinned here against the work area, the second against the
 * client.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

const calls = vi.hoisted(() => ({ order: [] as string[] }));
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
  getRunObservations: vi.fn(),
  createExperiment: vi.fn(),
  updateExperiment: vi.fn(),
  createVersion: vi.fn(),
  freezeVersion: vi.fn(),
}));
const execution = vi.hoisted(() => ({ executeRun: vi.fn() }));
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

beforeEach(() => {
  vi.clearAllMocks();
  calls.order = [];
  store.selectedExperiment.value = { id: EXPERIMENT_ID, name: 'Reachability', status: 'Active' };
  store.fetchExperiment.mockResolvedValue(undefined);
  store.fetchVersion.mockResolvedValue(undefined);
  store.loadRunsForVersion.mockResolvedValue(undefined);
  store.loadExperiments.mockResolvedValue(undefined);
  store.freezeVersion.mockImplementation(async () => {
    calls.order.push('freeze');
    return { ...VERSION, immutable: true };
  });
  execution.executeRun.mockImplementation(async () => {
    calls.order.push('run');
    return { run: { runStatus: 'Completed', tasksTotal: 1, tasksCompleted: 1 } };
  });
  api.listArgumentSets.mockResolvedValue([]);
});

describe('BenchmarkWorkArea — Run', () => {
  it('freezes a version that is not frozen yet, then runs it', async () => {
    useVersion(VERSION);
    const area = await mountSaved();

    await area.get('[data-testid="run-bar-run"]').trigger('click');
    await flushPromises();

    expect(store.freezeVersion).toHaveBeenCalledWith(EXPERIMENT_ID, 1);
    expect(execution.executeRun).toHaveBeenCalledWith(EXPERIMENT_ID, 1);
    expect(calls.order).toEqual(['freeze', 'run']);
  });

  it('runs a frozen version without freezing it again', async () => {
    useVersion({ ...VERSION, immutable: true });
    const area = await mountSaved();

    await area.get('[data-testid="run-bar-run"]').trigger('click');
    await flushPromises();

    expect(store.freezeVersion).not.toHaveBeenCalled();
    expect(execution.executeRun).toHaveBeenCalledWith(EXPERIMENT_ID, 1);
  });

  it('says why when the version cannot be frozen, and does not run it', async () => {
    useVersion(VERSION);
    store.freezeVersion.mockRejectedValue(new Error('Benchmark subject urn:x must be frozen'));
    const area = await mountSaved();

    await area.get('[data-testid="run-bar-run"]').trigger('click');
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith('Benchmark subject urn:x must be frozen');
    expect(execution.executeRun).not.toHaveBeenCalled();
  });
});

describe('useApiClient.executeBenchmarkRun', () => {
  afterEach(() => {
    globalThis.__NUXT_TEST_CONFIG__ = undefined;
    vi.unstubAllGlobals();
  });

  it('sends no JSON content type, because it sends no body', async () => {
    vi.doUnmock('@/composables/useApiClient');
    vi.resetModules();
    globalThis.__NUXT_TEST_CONFIG__ = { public: { apiBaseUrl: 'http://api.test', featureFlags: {} } };
    const fetch = vi.fn().mockResolvedValue(new Response('{}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);
    const { useApiClient } = await import('@/composables/useApiClient');

    await useApiClient().executeBenchmarkRun(EXPERIMENT_ID, 1).catch(() => undefined);

    const [, init] = fetch.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBeNull();
  });
});
