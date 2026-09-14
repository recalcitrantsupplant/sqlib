/**
 * The Details tab on a data graph: the panel every other record page carries,
 * now that this one carries it too.
 *
 * What is asserted here is the wiring the page owns — the rows it hands the
 * shared panel, what clicking one does, and what the footer's Delete addresses.
 * How a row looks, and the folding of the history, are `EntityDetailsPanel`'s
 * and are tested where they live.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';

const GRAPH_ID = 'urn:sqlib:data-graph:g1';
const V1 = 'urn:sqlib:data-graph-version:v1';
const V2 = 'urn:sqlib:data-graph-version:v2';
const V1_BODY = '@prefix : <http://ex/> .\n:a :edge :b .';
const V2_BODY = `${V1_BODY}\n:b :edge :c .`;

const store = vi.hoisted(() => ({
  dataGraphs: [] as Array<Record<string, unknown>>,
  loadDataGraphs: vi.fn(),
  loadVersions: vi.fn(),
  getDataGraph: vi.fn(),
  createDataGraph: vi.fn(),
  updateDataGraph: vi.fn(),
  createVersion: vi.fn(),
  annotateVersion: vi.fn(),
  deleteDataGraph: vi.fn(),
}));

vi.mock('@/composables/useDataGraphsStore', () => ({
  useDataGraphsStore: () => ({
    ...store,
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
      draftsVersion.value += 1;
    },
    remove: (id: string) => {
      for (const [basedOn, record] of drafts.records) {
        if (record.id === id) drafts.records.delete(basedOn);
      }
      draftsVersion.value += 1;
    },
    draftFor: (id: string) => drafts.records.get(id) ?? null,
    allDrafts: computed(() => {
      void draftsVersion.value;
      return [...drafts.records.values()];
    }),
  }),
  UNASSIGNED_LIBRARY_ID: 'unassigned',
}));
vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

/**
 * The browser-local draft store, per spec rather than shared.
 *
 * The real one is a module-level singleton: an autosave left behind by one
 * spec is hydrated by the next one's mount, which is a saved body silently
 * replaced by the previous test's edit.
 */
const drafts = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>() }));
const draftsVersion = ref(0);

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

beforeEach(() => {
  vi.clearAllMocks();
  drafts.records.clear();
  draftsVersion.value = 0;
  store.dataGraphs = [];
  store.getDataGraph.mockResolvedValue({
    id: GRAPH_ID,
    name: 'Family tree',
    description: 'People',
    currentVersion: V2,
    isPartOf: ['urn:sqlib:library:lib1'],
    dateCreated: '2026-08-01T10:00:00.000Z',
  });
  store.loadVersions.mockResolvedValue([
    {
      id: V1,
      version: 1,
      contentString: V1_BODY,
      contentFormat: 'text/turtle',
      tripleCount: 1,
      byteSize: V1_BODY.length,
    },
    {
      id: V2,
      version: 2,
      contentString: V2_BODY,
      contentFormat: 'text/turtle',
      tripleCount: 2,
      byteSize: V2_BODY.length,
      comment: 'added the second edge',
    },
  ]);
});

describe('DataGraphWorkArea — Details', () => {
  it('edits the name and description in the panel, and nowhere else', async () => {
    const area = await mountSaved();

    // One editor of each field: the body carries the content and no copy of
    // the identity that would be able to disagree with it.
    expect(area.findAll('[data-testid="details-name"]')).toHaveLength(1);
    expect((area.get('[data-testid="details-name"]').element as HTMLInputElement).value)
      .toBe('Family tree');
    expect((area.get('[data-testid="details-description"]').element as HTMLTextAreaElement).value)
      .toBe('People');
  });

  it('says what the server measured about a version the author did not comment', async () => {
    const area = await mountSaved();
    // The current version is the one the folded list shows, and it has a
    // comment of its own — the author's wins over the measurement.
    expect(area.get('[data-testid="version-row"]').text()).toContain('added the second edge');

    await area.get('[data-testid="toggle-version-history"]').trigger('click');
    const rows = area.findAll('[data-testid="version-row"]');
    // Newest first, and the uncommented v1 falls back to what was measured.
    expect(rows[0].text()).toContain('v2');
    expect(rows[1].text()).toContain('1 triple');
    expect(rows[1].text()).toContain('text/turtle');
  });

  it('reads a version into the editor when its row is clicked', async () => {
    const area = await mountSaved();
    expect(content(area)).toBe(V2_BODY);

    await area.get('[data-testid="toggle-version-history"]').trigger('click');
    const older = area.findAll('[data-testid="version-row"]')[1];
    await older.trigger('click');
    await flushPromises();

    expect(content(area)).toBe(V1_BODY);
  });

  it('points the graph at a version without changing what the editor shows', async () => {
    store.updateDataGraph.mockResolvedValue({ id: GRAPH_ID });
    const area = await mountSaved();
    await area.get('[data-testid="toggle-version-history"]').trigger('click');

    await area.get('[data-testid="set-current-version"]').trigger('click');
    await flushPromises();

    expect(store.updateDataGraph).toHaveBeenCalledWith(GRAPH_ID, { currentVersion: V1 });
    // Choosing what a run with no version pinned gets is not a request to read
    // that version.
    expect(content(area)).toBe(V2_BODY);
  });

  it('deletes from the footer, once confirmed', async () => {
    store.deleteDataGraph.mockResolvedValue(undefined);
    const area = await mountSaved();

    await area.get('[data-testid="details-delete"]').trigger('click');
    expect(store.deleteDataGraph).not.toHaveBeenCalled();

    await area.get('[data-testid="details-confirm-delete"]').trigger('click');
    await flushPromises();

    expect(store.deleteDataGraph).toHaveBeenCalledWith(GRAPH_ID);
    expect(area.emitted('data-graph-deleted')).toBeTruthy();
  });

  it('saves without a comment — the bar collects nothing', async () => {
    store.createVersion.mockResolvedValue({ id: 'urn:sqlib:data-graph-version:v3', version: 3, tripleCount: 3 });
    vi.useFakeTimers();
    const area = await mountSaved();
    // Saving an unchanged body is a disabled button, so there has to be an edit.
    await area.get('[data-testid="data-graph-content"]').setValue(`${V2_BODY}\n:c :edge :d .`);
    vi.advanceTimersByTime(600);
    await flushPromises();
    vi.useRealTimers();

    await (area.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();

    const [, input] = store.createVersion.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(input.comment).toBeUndefined();
  });

  /*
   * The note is written where it is read. Saving asks for nothing, so a
   * version gets its comment from its own row — including one saved long
   * before anybody had anything to say about it.
   */
  it('writes a version note from its row, and shows it there', async () => {
    store.annotateVersion.mockResolvedValue({ id: V1, version: 1, comment: 'the first cut' });
    const area = await mountSaved();
    await area.get('[data-testid="toggle-version-history"]').trigger('click');

    const older = area.findAll('[data-testid="version-row"]')[1];
    await older.get('[data-testid="version-comment-edit"]').trigger('click');
    const input = area.get('[data-testid="version-comment-input"]');
    await input.setValue('the first cut');
    await input.trigger('keydown.enter');
    await flushPromises();

    expect(store.annotateVersion).toHaveBeenCalledWith(GRAPH_ID, 1, 'the first cut');
    expect(area.findAll('[data-testid="version-row"]')[1].text()).toContain('the first cut');
  });

  it('leaves the note alone when the edit is abandoned', async () => {
    const area = await mountSaved();

    await area.get('[data-testid="version-comment-edit"]').trigger('click');
    const input = area.get('[data-testid="version-comment-input"]');
    await input.setValue('never mind');
    await input.trigger('keydown.esc');
    await flushPromises();

    expect(store.annotateVersion).not.toHaveBeenCalled();
    expect(area.get('[data-testid="version-row"]').text()).toContain('added the second edge');
  });

  it('puts the old note back when the write fails', async () => {
    store.annotateVersion.mockRejectedValue(new Error('nope'));
    const area = await mountSaved();

    await area.get('[data-testid="version-comment-edit"]').trigger('click');
    const input = area.get('[data-testid="version-comment-input"]');
    await input.setValue('optimistic');
    await input.trigger('keydown.enter');
    await flushPromises();

    expect(area.get('[data-testid="version-row"]').text()).toContain('added the second edge');
  });
});
