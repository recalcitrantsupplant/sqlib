/**
 * The Details tab on a tuple set.
 *
 * The data-graph spec covers the wiring the two pages share; what is pinned
 * here is where they differ — a tuple set is not a taggable kind, and its
 * version rows measure rows and columns rather than triples.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';

const SET_ID = 'urn:sqlib:tuple-set:s1';
const V1 = 'urn:sqlib:tuple-set-version:v1';
const V1_BODY = '{"head":{"vars":["city"]},"results":{"bindings":[{"city":{"type":"literal","value":"Paris"}}]}}';

const store = vi.hoisted(() => ({
  tupleSets: [] as Array<Record<string, unknown>>,
  loadTupleSets: vi.fn(),
  loadVersions: vi.fn(),
  loadCurrentVersions: vi.fn(),
  getTupleSet: vi.fn(),
  createTupleSet: vi.fn(),
  updateTupleSet: vi.fn(),
  createVersion: vi.fn(),
  deleteTupleSet: vi.fn(),
}));
const api = vi.hoisted(() => ({ detectTupleFormat: vi.fn(), previewTupleContent: vi.fn() }));
const drafts = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>() }));

vi.mock('@/composables/useTupleSetsStore', () => ({
  useTupleSetsStore: () => ({
    ...store,
    tupleSets: { get value() { return store.tupleSets; } },
    loading: { value: false },
    error: { value: null },
  }),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
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

/** Per-spec rather than the real module-level singleton; see the data-graph spec. */
const draftsVersion = ref(0);

async function mountSaved() {
  const TupleSetWorkArea = (await import('@/components/TupleSetWorkArea.vue')).default;
  const area = mount(TupleSetWorkArea, { props: { tupleSetId: SET_ID, scratchId: null } });
  await flushPromises();
  return area;
}

beforeEach(() => {
  vi.clearAllMocks();
  drafts.records.clear();
  draftsVersion.value = 0;
  store.tupleSets = [];
  store.getTupleSet.mockResolvedValue({
    id: SET_ID,
    name: 'European capitals',
    description: 'One row per capital',
    currentVersion: V1,
    isPartOf: ['urn:sqlib:library:lib1'],
    dateCreated: '2026-08-01T10:00:00.000Z',
  });
  store.loadVersions.mockResolvedValue([
    {
      id: V1,
      version: 1,
      contentString: V1_BODY,
      sourceFormat: 'csv',
      tupleColumns: ['city'],
      rowCount: 1,
      byteSize: V1_BODY.length,
    },
  ]);
  api.detectTupleFormat.mockResolvedValue('csv');
  api.previewTupleContent.mockResolvedValue({
    contentString: V1_BODY,
    tupleColumns: ['city'],
    rowCount: 1,
    byteSize: V1_BODY.length,
  });
});

describe('TupleSetWorkArea — Details', () => {
  it('edits the name and description in the panel, and nowhere else', async () => {
    const area = await mountSaved();

    expect(area.findAll('[data-testid="details-name"]')).toHaveLength(1);
    expect((area.get('[data-testid="details-name"]').element as HTMLInputElement).value)
      .toBe('European capitals');
    expect((area.get('[data-testid="details-description"]').element as HTMLTextAreaElement).value)
      .toBe('One row per capital');
  });

  it('offers no Tags row, because a tuple set is not a taggable kind', async () => {
    // A control that always failed at the server would be worse than none
    // (tags doc §4.6).
    const area = await mountSaved();
    expect(area.find('[data-testid="entity-tags-field"]').exists()).toBe(false);
  });

  it('says what the server measured about the version', async () => {
    const area = await mountSaved();
    const row = area.get('[data-testid="version-row"]');
    expect(row.text()).toContain('1 row');
    expect(row.text()).toContain('1 cols');
    expect(row.text()).toContain('from CSV');
  });

  it('deletes from the footer, once confirmed', async () => {
    store.deleteTupleSet.mockResolvedValue(undefined);
    const area = await mountSaved();

    await area.get('[data-testid="details-delete"]').trigger('click');
    expect(store.deleteTupleSet).not.toHaveBeenCalled();

    await area.get('[data-testid="details-confirm-delete"]').trigger('click');
    await flushPromises();

    expect(store.deleteTupleSet).toHaveBeenCalledWith(SET_ID);
    expect(area.emitted('tuple-set-deleted')).toBeTruthy();
  });
});
