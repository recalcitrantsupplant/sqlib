/**
 * Unsaved edits to a saved pipeline, the same way every other
 * versioned section keeps them: a draft in the browser, a pill that counts it,
 * and a Discard that goes back to the saved version.
 *
 * The second half of the gap #190 names. Scratch was already safe here — a
 * pipeline that had never been saved survived a reload — but an edit to a
 * *saved* pipeline lived in the open tab and nowhere else.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed } from 'vue';
import type { CallableDraft } from '@/composables/useCallableDrafts';

const JOB_ID = 'urn:sqlib:etl-job:j1';
const SAVED_SQL = `SELECT * FROM read_csv('data/examples/people.csv')`;
const SAVED_TEMPLATE = 'CONSTRUCT { ?s ?p ?o } WHERE { VALUES (?s ?p ?o) {} }';
const MAPPING_VERSION = 'urn:sqlib:etl-column-mapping-version:m1';
const SAVED_MAPPINGS = [
  { columnName: 'name', targetVariable: 'name', termType: 'literal' as const, nullPolicy: 'undef' as const },
];

const store = vi.hoisted(() => ({
  fetchEtlJob: vi.fn(),
  loadEtlJobVersions: vi.fn(),
  fetchColumnMappingVersion: vi.fn(),
  createEtlJob: vi.fn(),
  createEtlJobVersion: vi.fn(),
  updateEtlJob: vi.fn(),
}));

/** A stand-in for the browser-local store, so one spec cannot leak into another. */
const drafts = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>() }));

vi.mock('@/composables/useEtlJobsStore', () => ({ useEtlJobsStore: () => store }));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({
    activeLibraryId: ref('urn:sqlib:library:lib1'),
    activeLibraryName: ref('Library one'),
  }),
}));
vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({ backends: ref([]), loading: ref(false), loadBackends: vi.fn() }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: () => ({
    // A saved pipeline, which is the only case that can hold a draft.
    isScratch: ref(false),
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
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// The three editors are CodeMirror instances; what this spec is about is the
// bodies they hold, so a textarea stands in for each.
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
  const EtlPlayground = (await import('@/components/EtlPlayground.vue')).default;
  const area = mount(EtlPlayground, { props: { scratchId: null, etlJobId: JOB_ID } });
  await flushPromises();
  return area;
}

type Area = Awaited<ReturnType<typeof mountSaved>>;
type Editors = { sqlQuery: string; sparqlTemplate: string; save: () => Promise<void> };

const editors = (area: Area) => area.vm as unknown as Editors;

/** Change a body and let the 500ms autosave run — but not the 1s SQL preview. */
async function edit(area: Area, sql: string) {
  editors(area).sqlQuery = sql;
  await flushPromises();
  vi.advanceTimersByTime(600);
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  drafts.records.clear();
  draftsVersion.value = 0;

  // The screen previews the SQL on mount; nothing here is about that.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ schema: [], rows: [] }),
  }));

  store.fetchEtlJob.mockResolvedValue({
    id: JOB_ID,
    name: 'People to RDF',
    description: 'CSV in, triples out',
    currentVersionId: 'urn:sqlib:etl-job-version:v1',
    libraryIds: ['urn:sqlib:library:lib1'],
  });
  store.loadEtlJobVersions.mockResolvedValue([
    {
      id: 'urn:sqlib:etl-job-version:v1',
      isPartOf: JOB_ID,
      version: 1,
      sql: SAVED_SQL,
      sparqlTemplate: SAVED_TEMPLATE,
      backendId: 'urn:sqlib:backend:ephemeral',
      currentColumnMappingVersionId: MAPPING_VERSION,
    },
  ]);
  store.fetchColumnMappingVersion.mockResolvedValue({ id: MAPPING_VERSION, columns: SAVED_MAPPINGS });
});

describe('EtlPlayground — drafts', () => {
  it('keeps unsaved edits as a draft, and counts them in the pill', async () => {
    const area = await mountSaved();
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);

    await edit(area, 'SELECT 1 AS name');

    expect(drafts.records.get(JOB_ID)).toMatchObject({ section: 'etl', basedOn: JOB_ID });
    expect(area.get('[data-testid="draft-pill"]').text()).toContain('1 unsaved edit');
  });

  it('drafts the mapping and the template, not just the SQL', async () => {
    // The three bodies are one version, so an edit to any of them is an edit
    // to the pipeline. Drafting only the SQL would lose the other two.
    const area = await mountSaved();
    editors(area).sparqlTemplate = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';
    await flushPromises();
    vi.advanceTimersByTime(600);
    await flushPromises();

    const body = drafts.records.get(JOB_ID)?.body as { sparqlTemplate?: string; columnMappings?: unknown[] };
    expect(body.sparqlTemplate).toContain('WHERE { ?s ?p ?o }');
    expect(body.columnMappings).toEqual(SAVED_MAPPINGS);
  });

  it('drops the draft when the body is typed back to the saved version', async () => {
    // Undoing an edit is not an edit, and a lit pill over an identical body is
    // a lie the sidebar would repeat.
    const area = await mountSaved();
    await edit(area, 'SELECT 1 AS name');
    expect(drafts.records.has(JOB_ID)).toBe(true);

    await edit(area, SAVED_SQL);
    expect(drafts.records.has(JOB_ID)).toBe(false);
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);
  });

  it('restores the saved bodies on Discard', async () => {
    const area = await mountSaved();
    await edit(area, 'SELECT nonsense');

    await area.get('[data-testid="discard-draft"]').trigger('click');
    await flushPromises();

    expect(editors(area).sqlQuery).toBe(SAVED_SQL);
    expect(editors(area).sparqlTemplate).toBe(SAVED_TEMPLATE);
    expect(drafts.records.has(JOB_ID)).toBe(false);
  });

  it('opens the draft rather than the saved version after a reload', async () => {
    const first = await mountSaved();
    await edit(first, 'SELECT 1 AS name');
    first.unmount();

    const reopened = await mountSaved();
    expect(editors(reopened).sqlQuery).toBe('SELECT 1 AS name');

    // And reopening is not itself an edit: hydrating the draft back into the
    // editors must not count as a change to it.
    vi.advanceTimersByTime(600);
    await flushPromises();
    expect(drafts.records.get(JOB_ID)?.edits).toBe(1);
  });

  it('clears the draft once the edits are saved', async () => {
    store.createEtlJobVersion.mockResolvedValue({ id: 'urn:sqlib:etl-job-version:v2', version: 2 });

    const area = await mountSaved();
    await edit(area, 'SELECT 1 AS name');

    await editors(area).save();
    await flushPromises();

    expect(drafts.records.has(JOB_ID)).toBe(false);
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);
  });

  /**
   * The invariant the model states for every versioned editor
   * (`entityLifecycle`): a save that fails leaves the draft exactly as it
   * was. It is the one outcome that loses work outright rather than merely
   * confusing.
   */
  it('keeps the draft when the save fails', async () => {
    store.createEtlJobVersion.mockRejectedValue(new Error('the server said no'));

    const area = await mountSaved();
    await edit(area, 'SELECT 1 AS name');
    const before = { ...drafts.records.get(JOB_ID) };

    await editors(area).save();
    await flushPromises();

    expect(drafts.records.get(JOB_ID)).toMatchObject(before);
    expect(editors(area).sqlQuery).toBe('SELECT 1 AS name');
    expect(area.get('[data-testid="draft-pill"]').exists()).toBe(true);
  });

  it('refuses to save a body identical to the current version', async () => {
    // Nothing to save is a disabled button, not a duplicate version.
    const area = await mountSaved();
    expect(area.get('[data-testid="save"]').attributes('disabled')).toBeDefined();

    await edit(area, 'SELECT 1 AS name');
    expect(area.get('[data-testid="save"]').attributes('disabled')).toBeUndefined();
  });
});
