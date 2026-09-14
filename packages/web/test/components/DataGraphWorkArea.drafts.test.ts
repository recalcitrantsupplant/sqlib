/**
 * Unsaved edits to a saved data graph, the same way a query or a rule
 * set keeps them: a draft in the browser, a pill that counts it, and a Discard
 * that goes back to the saved version.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed } from 'vue';
import type { CallableDraft } from '@/composables/useCallableDrafts';

const GRAPH_ID = 'urn:sqlib:data-graph:g1';
const SAVED = '@prefix : <http://ex/> .\n:a :edge :b .';

const store = vi.hoisted(() => ({
  dataGraphs: [] as Array<Record<string, unknown>>,
  loadDataGraphs: vi.fn(),
  loadVersions: vi.fn(),
  getDataGraph: vi.fn(),
  createDataGraph: vi.fn(),
  updateDataGraph: vi.fn(),
  createVersion: vi.fn(),
  deleteDataGraph: vi.fn(),
}));

/** A stand-in for the browser-local store, so one spec cannot leak into another. */
const drafts = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>() }));

vi.mock('@/composables/useDataGraphsStore', () => ({
  useDataGraphsStore: () => ({
    ...store,
    // After the spread: the component reads these as refs, and the raw arrays
    // on `store` would shadow them.
    dataGraphs: { get value() { return store.dataGraphs; } },
    loading: { value: false },
    error: { value: null },
  }),
}));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: { value: 'urn:sqlib:library:lib1' } }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: (options: { scratchId: () => string | null | undefined }) => ({
    isScratch: computed(() => Boolean(options.scratchId())),
    hydrating: ref(false),
    savedAt: ref(null),
    flush: vi.fn(),
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
vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

/** The fake store is a plain Map, so reactivity needs a counter of its own. */
const draftsVersion = ref(0);
function bumpDrafts() {
  draftsVersion.value += 1;
}

const RdfEditorStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
};

async function mountSaved() {
  const DataGraphWorkArea = (await import('@/components/DataGraphWorkArea.vue')).default;
  const area = mount(DataGraphWorkArea, {
    props: { dataGraphId: GRAPH_ID, scratchId: null },
    global: { stubs: { EditableRdfViewer: RdfEditorStub } },
  });
  await flushPromises();
  return area;
}

const content = (area: Awaited<ReturnType<typeof mountSaved>>) =>
  (area.get('[data-testid="data-graph-content"]').element as HTMLTextAreaElement).value;

/** Type into the editor and let the 500ms autosave run. */
async function edit(area: Awaited<ReturnType<typeof mountSaved>>, text: string) {
  await area.get('[data-testid="data-graph-content"]').setValue(text);
  vi.advanceTimersByTime(600);
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  drafts.records.clear();
  draftsVersion.value = 0;
  store.dataGraphs = [];
  store.getDataGraph.mockResolvedValue({
    id: GRAPH_ID,
    name: 'Family tree',
    description: 'People',
    currentVersion: 'urn:sqlib:data-graph-version:v1',
    isPartOf: ['urn:sqlib:library:lib1'],
  });
  store.loadVersions.mockResolvedValue([
    {
      id: 'urn:sqlib:data-graph-version:v1',
      version: 1,
      contentString: SAVED,
      contentFormat: 'text/turtle',
      tripleCount: 1,
      byteSize: SAVED.length,
    },
  ]);
});

describe('DataGraphWorkArea — drafts', () => {
  it('keeps unsaved edits as a draft, and counts them in the pill', async () => {
    const area = await mountSaved();
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);

    await edit(area, `${SAVED}\n:b :edge :c .`);

    expect(drafts.records.get(GRAPH_ID)).toMatchObject({ section: 'dataGraph', basedOn: GRAPH_ID });
    expect(area.get('[data-testid="draft-pill"]').text()).toContain('1 unsaved edit');
  });

  it('drops the draft when the body is typed back to the saved version', async () => {
    // Undoing an edit is not an edit, and a lit pill over an identical body is
    // a lie the sidebar would repeat.
    const area = await mountSaved();
    await edit(area, `${SAVED}\n:b :edge :c .`);
    expect(drafts.records.has(GRAPH_ID)).toBe(true);

    await edit(area, SAVED);
    expect(drafts.records.has(GRAPH_ID)).toBe(false);
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);
  });

  it('restores the saved body on Discard', async () => {
    const area = await mountSaved();
    await edit(area, 'nonsense');

    await area.get('[data-testid="discard-draft"]').trigger('click');
    await flushPromises();

    expect(content(area)).toBe(SAVED);
    expect(drafts.records.has(GRAPH_ID)).toBe(false);
  });

  it('opens the draft rather than the saved version after a reload', async () => {
    const first = await mountSaved();
    await edit(first, `${SAVED}\n:b :edge :c .`);
    first.unmount();

    const reopened = await mountSaved();
    expect(content(reopened)).toContain(':b :edge :c .');
  });

  it('clears the draft once the edits are saved', async () => {
    store.createVersion.mockResolvedValue({
      id: 'urn:sqlib:data-graph-version:v2',
      version: 2,
      tripleCount: 2,
    });

    const area = await mountSaved();
    await edit(area, `${SAVED}\n:b :edge :c .`);

    await (area.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();

    expect(drafts.records.has(GRAPH_ID)).toBe(false);
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);
  });

  /**
   * The invariant the model states for every section that keeps drafts
   * (`entityLifecycle`, DATA_GRAPH_CAPABILITIES): a save that fails leaves
   * the draft exactly as it was. Nothing checked it here before, and it is the
   * one outcome that loses work outright rather than merely confusing.
   */
  it('keeps the draft when the save fails', async () => {
    store.createVersion.mockRejectedValue(new Error('the server said no'));

    const area = await mountSaved();
    const edited = `${SAVED}\n:b :edge :c .`;
    await edit(area, edited);
    const before = { ...drafts.records.get(GRAPH_ID) };

    await (area.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();

    expect(drafts.records.get(GRAPH_ID)).toMatchObject(before);
    expect(content(area)).toBe(edited);
    expect(area.get('[data-testid="draft-pill"]').exists()).toBe(true);
  });

  it('refuses to save a body identical to the current version', async () => {
    // Nothing to save is a disabled button, not a duplicate version.
    const area = await mountSaved();
    expect(area.get('[data-testid="save"]').attributes('disabled')).toBeDefined();

    await edit(area, `${SAVED}\n:b :edge :c .`);
    expect(area.get('[data-testid="save"]').attributes('disabled')).toBeUndefined();
  });
});
