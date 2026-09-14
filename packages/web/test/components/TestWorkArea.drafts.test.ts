/**
 * Unsaved edits to a saved test, the same way a query, a rule set or a
 * data graph keeps them: a draft in the browser, a pill that counts it, and a
 * Discard that goes back to the saved version.
 *
 * This is the gap #190 names. Before it, an edit to a saved test lived in
 * the open tab and nowhere else — close it, reload, or open another test, and
 * the work was gone with no warning.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed } from 'vue';
import type { CallableDraft } from '@/composables/useCallableDrafts';

const TEST_ID = 'urn:sqlib:test:t1';
const SAVED_EXPECTED = '<http://example/a> <http://example/reaches> <http://example/b> .';

const api = vi.hoisted(() => ({
  listDataGraphs: vi.fn(),
  listDataGraphVersions: vi.fn(),
  listRuleSetVersions: vi.fn(),
  listQueryVersions: vi.fn(),
  listQueryGroupVersions: vi.fn(),
  listArgumentSets: vi.fn(),
  getTest: vi.fn(),
  // A saved test's name and description are written back on save; before
  // Details owned them the rename went nowhere.
  updateTest: vi.fn(),
  // The Tags field loads the library's vocabulary for its picker.
  listTags: vi.fn().mockResolvedValue([]),
}));
const store = vi.hoisted(() => {
  /*
   * The real store keeps one verdict per test and the screen reads it there —
   * a run started from the Runs tab writes the same map — so the stand-in has
   * to do the same or the panel it feeds is testing nothing.
   */
  const lastRunByTest = { value: {} as Record<string, unknown> };
  return {
    tests: { value: [] as Array<{ id: string; tags?: string[] | null }> },
    lastRunByTest,
    runTest: vi.fn(async (testId: string) => {
      const result = (store.runTest as unknown as { nextResult?: unknown }).nextResult;
      if (result) lastRunByTest.value = { ...lastRunByTest.value, [testId]: result };
      return result;
    }),
    createTest: vi.fn(),
    createVersion: vi.fn(),
    deleteTest: vi.fn(),
    loadVersions: vi.fn(),
    loadTests: vi.fn(),
  };
});

/** A stand-in for the browser-local store, so one spec cannot leak into another. */
const drafts = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>() }));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useTestsStore', () => ({ useTestsStore: () => store }));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: { value: 'urn:sqlib:library:lib1' } }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: () => ({
    // A saved test, which is the only case that can hold a draft.
    isScratch: ref(false),
    hydrating: ref(false),
    savedAt: ref(null),
    flush: vi.fn(),
  }),
}));
vi.mock('@/composables/useQueriesStore', () => ({
  useQueriesStore: () => ({ queries: { value: [] }, loadQueries: vi.fn() }),
}));
vi.mock('@/composables/useQueryGroupsStore', () => ({
  useQueryGroupsStore: () => ({ queryGroups: { value: [] }, loadQueryGroups: vi.fn() }),
}));
vi.mock('@/composables/useRuleSetsStore', () => ({
  useRuleSetsStore: () => ({
    ruleSets: { value: [{ id: 'urn:sqlib:ruleset:rs1', name: 'Reach', isPartOf: ['urn:sqlib:library:lib1'] }] },
    fetchRuleSets: vi.fn(),
  }),
}));
// ETL is an optional feature and this screen only lists its jobs as possible
// subjects; the real store would reach the network for a list every spec here
// leaves empty.
vi.mock('@/composables/useEtlJobsStore', () => ({
  useEtlJobsStore: () => ({
    etlJobs: { value: [] },
    loadEtlJobs: vi.fn().mockResolvedValue([]),
    loadEtlJobVersions: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({ backends: { value: [{ id: 'urn:sqlib:backend:b1', name: 'Live' }] }, loadBackends: vi.fn() }),
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
// The expectation and named-tuples boxes are CodeMirror instances; what these
// specs are about is the text they hold, so a textarea stands in for each.
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
  },
}));

/** The fake store is a plain Map, so reactivity needs a counter of its own. */
const draftsVersion = ref(0);
function bumpDrafts() {
  draftsVersion.value += 1;
}

async function mountSaved() {
  const TestWorkArea = (await import('@/components/TestWorkArea.vue')).default;
  const area = mount(TestWorkArea, { props: { testId: TEST_ID, scratchId: null } });
  await flushPromises();
  return area;
}

type Area = Awaited<ReturnType<typeof mountSaved>>;

const expectedField = (area: Area) => area.get('[data-testid="test-expected"] textarea');
const expectedText = (area: Area) => (expectedField(area).element as HTMLTextAreaElement).value;

/** Type into the expectation and let the 500ms autosave run. */
async function edit(area: Area, text: string) {
  await expectedField(area).setValue(text);
  vi.advanceTimersByTime(600);
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  drafts.records.clear();
  draftsVersion.value = 0;

  api.listDataGraphs.mockResolvedValue([]);
  api.listDataGraphVersions.mockResolvedValue([]);
  api.listRuleSetVersions.mockResolvedValue([{ id: 'urn:v1', version: 1 }]);
  api.listArgumentSets.mockResolvedValue([]);
  api.getTest.mockResolvedValue({
    data: {
      id: TEST_ID,
      name: 'Reach is transitive',
      subject: 'urn:sqlib:ruleset:rs1',
      subjectKind: 'ruleSet',
      currentVersion: 'urn:sqlib:test-version:v1',
      isPartOf: ['urn:sqlib:library:lib1'],
    },
  });
  store.loadVersions.mockResolvedValue([
    {
      id: 'urn:sqlib:test-version:v1',
      version: 1,
      expectationKind: 'graph',
      subjectVersion: null,
      backend: null,
      cases: [{ name: null, expected: SAVED_EXPECTED, expectedFormat: 'text/turtle', ordered: null }],
    },
  ]);
});

describe('TestWorkArea — drafts', () => {
  it('keeps unsaved edits as a draft, and counts them in the pill', async () => {
    const area = await mountSaved();
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);

    await edit(area, `${SAVED_EXPECTED}\n<http://example/b> <http://example/reaches> <http://example/c> .`);

    expect(drafts.records.get(TEST_ID)).toMatchObject({ section: 'test', basedOn: TEST_ID });
    expect(area.get('[data-testid="draft-pill"]').text()).toContain('1 unsaved edit');
  });

  it('drops the draft when the body is typed back to the saved version', async () => {
    // Undoing an edit is not an edit, and a lit pill over an identical body is
    // a lie the sidebar would repeat.
    const area = await mountSaved();
    await edit(area, 'something else .');
    expect(drafts.records.has(TEST_ID)).toBe(true);

    await edit(area, SAVED_EXPECTED);
    expect(drafts.records.has(TEST_ID)).toBe(false);
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);
  });

  it('restores the saved body on Discard', async () => {
    const area = await mountSaved();
    await edit(area, 'nonsense .');

    await area.get('[data-testid="discard-draft"]').trigger('click');
    await flushPromises();

    expect(expectedText(area)).toBe(SAVED_EXPECTED);
    expect(drafts.records.has(TEST_ID)).toBe(false);
  });

  it('opens the draft rather than the saved version after a reload', async () => {
    const first = await mountSaved();
    await edit(first, 'the edited expectation .');
    first.unmount();

    const reopened = await mountSaved();
    expect(expectedText(reopened)).toBe('the edited expectation .');

    // And reopening is not itself an edit: hydrating the draft back into the
    // editor must not count as a change to it.
    vi.advanceTimersByTime(600);
    await flushPromises();
    expect(drafts.records.get(TEST_ID)?.edits).toBe(1);
  });

  it('clears the draft once the edits are saved', async () => {
    store.createVersion.mockResolvedValue({ id: 'urn:sqlib:test-version:v2', version: 2 });

    const area = await mountSaved();
    await edit(area, 'the edited expectation .');

    await (area.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();

    expect(drafts.records.has(TEST_ID)).toBe(false);
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);
  });

  it('writes a rename back to the test, not only into the next version', async () => {
    // Name and description are the test's own fields rather than a version's,
    // and nothing wrote them at all while they sat in the Subject block: a
    // saved test's rename was dropped silently.
    store.createVersion.mockResolvedValue({ id: 'urn:sqlib:test-version:v2', version: 2 });

    const area = await mountSaved();
    await area.get('[data-testid="details-name"]').setValue('Reach is transitive, restated');
    await edit(area, 'the edited expectation .');

    await (area.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();

    expect(api.updateTest).toHaveBeenCalledWith(
      TEST_ID,
      expect.objectContaining({ name: 'Reach is transitive, restated' }),
    );
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
    const edited = 'the edited expectation .';
    await edit(area, edited);
    const before = { ...drafts.records.get(TEST_ID) };

    await (area.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();

    expect(drafts.records.get(TEST_ID)).toMatchObject(before);
    expect(expectedText(area)).toBe(edited);
    expect(area.get('[data-testid="draft-pill"]').exists()).toBe(true);
  });

  it('refuses to save a body identical to the current version', async () => {
    // Nothing to save is a disabled button, not a duplicate version.
    const area = await mountSaved();
    expect(area.get('[data-testid="save"]').attributes('disabled')).toBeDefined();

    await edit(area, 'the edited expectation .');
    expect(area.get('[data-testid="save"]').attributes('disabled')).toBeUndefined();
  });

  it('records a change to any part of the version, not just the expectation', async () => {
    // The fields a test version carries beyond its cases — expectation kind,
    // pinned subject version, backend — are edits too. Drafting only the text
    // box would lose the rest just as silently.
    //
    // Pinned here rather than the backend: this is a rule-set test, and a rule
    // set has no backend slot to type into. Same claim, on a field this kind
    // of subject actually has.
    const area = await mountSaved();
    await area.get('[data-testid="test-subject-pinned"]').trigger('click');
    vi.advanceTimersByTime(600);
    await flushPromises();

    expect(drafts.records.get(TEST_ID)).toMatchObject({ section: 'test' });
    expect((drafts.records.get(TEST_ID)?.body as { subjectVersion?: string }).subjectVersion)
      .toBeTruthy();
  });
});
