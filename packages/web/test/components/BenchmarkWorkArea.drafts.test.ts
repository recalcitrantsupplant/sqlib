/**
 * Unsaved edits to a saved benchmark, the same way a query, a test, a
 * rule set or a data graph keeps them: a draft in the browser, a pill that
 * counts it, and a Discard that goes back to the saved version.
 *
 * Benchmarks were the section #190 missed. The design doc's coverage table
 * claimed drafts for them, but `BenchmarkWorkArea` only ever kept a *scratch*
 * record: edits to a saved experiment lived in the open tab and nowhere
 * else, so closing it, reloading, or opening another experiment lost the work
 * with no warning. These are the same seven invariants the other
 * `*.drafts.test.ts` files pin, so the claim is checked rather than asserted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed } from 'vue';
import type { CallableDraft } from '@/composables/useCallableDrafts';
import { NO_ARGUMENTS_IRI } from '@/lib/benchmarkPlan';

const EXPERIMENT_ID = 'urn:sqlib:benchmark:e1';
const QUERY_ID = 'urn:sqlib:query:q1';
const BACKEND_ID = 'urn:sqlib:backend:b1';

/** The version on screen. Its `repeats` is what these specs edit. */
const SAVED_VERSION = {
  id: 'urn:sqlib:benchmark-version:v1',
  version: 1,
  immutable: true,
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
  getRunObservations: vi.fn(),
  createExperiment: vi.fn(),
  // A save writes the name and description back to the experiment before it
  // cuts the version — Details is where they are edited now.
  updateExperiment: vi.fn(),
  createVersion: vi.fn(),
}));

/** A stand-in for the browser-local store, so one spec cannot leak into another. */
const drafts = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>() }));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useBenchmarksStore', () => ({ useBenchmarksStore: () => store }));
vi.mock('@/composables/useBenchmarkExecution', () => ({
  useBenchmarkExecution: () => ({ isExecuting: ref(false), executeRun: vi.fn() }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: () => ({
    // A saved experiment, which is the only case that can hold a draft.
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
    save: (record: Record<string, unknown>) => {
      drafts.records.set(String(record.basedOn), record);
      bumpDrafts();
    },
    remove: (id: string) => {
      for (const [basedOn, record] of drafts.records) {
        if (record.id === id) drafts.records.delete(basedOn);
      }
      bumpDrafts();
    },
    draftFor: (id: string) => drafts.records.get(id) ?? null,
    allDrafts: computed(() => {
      void draftsVersion.value;
      return [...drafts.records.values()] as unknown as CallableDraft[];
    }),
  }),
  UNASSIGNED_LIBRARY_ID: 'unassigned',
}));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

/** The fake store is a plain Map, so reactivity needs a counter of its own. */
const draftsVersion = ref(0);
function bumpDrafts() {
  draftsVersion.value += 1;
}

async function mountSaved() {
  const BenchmarkWorkArea = (await import('@/components/BenchmarkWorkArea.vue')).default;
  const area = mount(BenchmarkWorkArea, {
    props: { experimentId: EXPERIMENT_ID, scratchId: null },
  });
  await flushPromises();
  return area;
}

type Area = Awaited<ReturnType<typeof mountSaved>>;

/** The benchmark body is a structured plan rather than text, so edits are poked
 *  at the plan the way the case editor's events would set it. */
interface BenchVm {
  plan: { settings: { repeats: number | null }; cases: unknown[] };
  experimentDescription: string;
  save: () => Promise<void>;
}
const vm = (area: Area) => area.vm as unknown as BenchVm;
const repeats = (area: Area) => vm(area).plan.settings.repeats;

/**
 * Change the plan and let the 500ms autosave run.
 *
 * The flush between the two matters: the watcher that schedules the autosave
 * runs on a microtask, so advancing timers first would advance past a timeout
 * nothing had set yet. The other drafts specs get this for free from
 * `setValue`, which awaits a tick of its own.
 */
async function edit(area: Area, nextRepeats: number) {
  vm(area).plan.settings.repeats = nextRepeats;
  await flushPromises();
  vi.advanceTimersByTime(600);
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  drafts.records.clear();
  draftsVersion.value = 0;

  store.loading.value = false;
  store.runs.value = [];
  store.selectedExperiment.value = {
    id: EXPERIMENT_ID,
    name: 'Reachability under load',
    description: 'How the reachability query behaves as concurrency rises',
    status: 'Active',
  };
  store.selectedVersion.value = SAVED_VERSION;
  store.listVersions.mockResolvedValue([SAVED_VERSION]);
  store.fetchExperiment.mockResolvedValue(undefined);
  store.fetchVersion.mockResolvedValue(undefined);
  store.loadRunsForVersion.mockResolvedValue(undefined);
  store.loadExperiments.mockResolvedValue(undefined);
  api.listArgumentSets.mockResolvedValue([]);
});

describe('BenchmarkWorkArea — drafts', () => {
  it('keeps unsaved edits as a draft, and counts them in the pill', async () => {
    const area = await mountSaved();
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);

    await edit(area, 5);

    expect(drafts.records.get(EXPERIMENT_ID)).toMatchObject({
      section: 'bench',
      basedOn: EXPERIMENT_ID,
    });
    expect(area.get('[data-testid="draft-pill"]').text()).toContain('1 unsaved edit');
  });

  it('drops the draft when the plan is set back to the saved version', async () => {
    // Undoing an edit is not an edit, and a lit pill over an identical body is
    // a lie the sidebar would repeat.
    const area = await mountSaved();
    await edit(area, 5);
    expect(drafts.records.has(EXPERIMENT_ID)).toBe(true);

    await edit(area, 1);
    expect(drafts.records.has(EXPERIMENT_ID)).toBe(false);
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);
  });

  it('restores the saved body on Discard', async () => {
    const area = await mountSaved();
    await edit(area, 9);

    await area.get('[data-testid="discard-draft"]').trigger('click');
    await flushPromises();

    expect(repeats(area)).toBe(1);
    expect(drafts.records.has(EXPERIMENT_ID)).toBe(false);
  });

  it('opens the draft rather than the saved version after a reload', async () => {
    const first = await mountSaved();
    await edit(first, 7);
    first.unmount();

    const reopened = await mountSaved();
    expect(repeats(reopened)).toBe(7);

    // And reopening is not itself an edit: hydrating the draft back into the
    // editor must not count as a change to it.
    await flushPromises();
    vi.advanceTimersByTime(600);
    await flushPromises();
    expect(drafts.records.get(EXPERIMENT_ID)?.edits).toBe(1);
  });

  it('clears the draft once the edits are saved', async () => {
    store.createVersion.mockResolvedValue({ id: 'urn:sqlib:benchmark-version:v2', version: 2 });

    const area = await mountSaved();
    await edit(area, 4);

    await vm(area).save();
    await flushPromises();

    expect(drafts.records.has(EXPERIMENT_ID)).toBe(false);
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);
  });

  /**
   * The invariant the model states for every versioned editor
   * (`entityLifecycle`): a save that fails leaves the draft exactly as it
   * was. It is the one outcome that loses work outright rather than merely
   * confusing.
   */
  it('keeps the draft when the save fails', async () => {
    store.createVersion.mockRejectedValue(new Error('the server said no'));

    const area = await mountSaved();
    await edit(area, 4);
    const before = { ...drafts.records.get(EXPERIMENT_ID) };

    await vm(area).save();
    await flushPromises();

    expect(drafts.records.get(EXPERIMENT_ID)).toMatchObject(before);
    expect(repeats(area)).toBe(4);
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(true);
  });

  it('refuses to save a body identical to the current version', async () => {
    // Nothing to save is a disabled button, not a duplicate version.
    const area = await mountSaved();
    expect(area.get('[data-testid="save"]').attributes('disabled')).toBeDefined();

    await edit(area, 3);
    expect(area.get('[data-testid="save"]').attributes('disabled')).toBeUndefined();
  });

  it('writes the name and description back with the version it saves', async () => {
    // They live on the experiment rather than on a version, and Details is
    // where they are edited: a save that only cut a version would lose a
    // rename the moment the page reloaded.
    store.createVersion.mockResolvedValue({ ...SAVED_VERSION, version: 2 });
    const area = await mountSaved();
    await area.get('[data-testid="details-name"]').setValue('Reachability under load, v2');
    await edit(area, 4);

    await vm(area).save();
    await flushPromises();

    expect(store.updateExperiment).toHaveBeenCalledWith(
      EXPERIMENT_ID,
      expect.objectContaining({ name: 'Reachability under load, v2' }),
    );
  });

  it('names the third column for what the mode has selected', async () => {
    // One slot — "what is selected" — rather than two tabs that would make the
    // strip change length as the mode changes.
    const area = await mountSaved();
    expect(area.get('[data-testid="benchmark-inspector"]').text()).toContain('Arguments');

    (area.vm as unknown as { tab: string }).tab = 'runs';
    await flushPromises();
    expect(area.get('[data-testid="benchmark-inspector"]').text()).toContain('Request');
  });

  it('lists its versions in Details, with what each version is', async () => {
    const area = await mountSaved();
    const rows = area.findAll('[data-testid="version-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('v1');
    // No comment field on a benchmark version, so the row says what it is.
    expect(rows[0].text()).toMatch(/case/);
  });

  it('records a change to any part of the experiment, not just the plan', async () => {
    // The fields a benchmark carries beyond its plan — name, description,
    // status — are edits too. Drafting only the plan would lose the rest just
    // as silently.
    const area = await mountSaved();
    vm(area).experimentDescription = 'Now also under a cold cache';
    await flushPromises();
    vi.advanceTimersByTime(600);
    await flushPromises();

    expect(drafts.records.get(EXPERIMENT_ID)).toMatchObject({ section: 'bench' });
    expect((drafts.records.get(EXPERIMENT_ID)?.body as { description?: string }).description)
      .toBe('Now also under a cold cache');
  });
});
