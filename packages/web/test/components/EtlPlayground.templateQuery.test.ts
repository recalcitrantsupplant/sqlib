/**
 * A template linked to a saved query. The picker sets the link and shows the
 * query's text, the editor locks while linked, Save stores the link without
 * the text, and Unlink keeps the text as the pipeline's own.
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
  const area = mount(EtlPlayground, {
    props: { scratchId: null, etlJobId: JOB_ID },
    global: { stubs: { TemplateQueryPicker: { name: 'TemplateQueryPicker', props: ['modelValue', 'libraryId'], template: '<div />' } } },
  });
  await flushPromises();
  return area;
}

type Area = Awaited<ReturnType<typeof mountSaved>>;
type Editors = { sqlQuery: string; sparqlTemplate: string; templateQuery: string | null; save: () => Promise<void> };

const editors = (area: Area) => area.vm as unknown as Editors;

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

const QUERY = 'urn:sqlib:query:people';
const QUERY_V2 = 'urn:sqlib:query-version:people-2';
const QUERY_TEXT = 'CONSTRUCT { ?name a <urn:Person> } WHERE { VALUES (?name) { (UNDEF) } }';

describe('EtlPlayground — linked template', () => {
  it('links the template to the picked query, locks the editor, and saves the link only', async () => {
    store.createEtlJobVersion.mockResolvedValue({ id: 'urn:sqlib:etl-job-version:v2', version: 2 });
    const area = await mountSaved();
    expect(area.find('[data-testid="etl-template-unlink"]').exists()).toBe(false);

    area.findComponent({ name: 'TemplateQueryPicker' }).vm.$emit('use', { reference: QUERY, text: QUERY_TEXT });
    await flushPromises();

    expect(editors(area).sparqlTemplate).toBe(QUERY_TEXT);
    expect(editors(area).templateQuery).toBe(QUERY);
    expect(area.findComponent({ name: 'TemplateQueryPicker' }).props('modelValue')).toBe(QUERY);
    expect(area.find('[data-testid="etl-template-unlink"]').exists()).toBe(true);

    vi.advanceTimersByTime(600);
    await flushPromises();
    await editors(area).save();
    await flushPromises();
    expect(store.createEtlJobVersion).toHaveBeenCalledWith(JOB_ID, expect.objectContaining({ templateQuery: QUERY }));
  });

  it('keeps the text and drops the link on Unlink', async () => {
    const area = await mountSaved();
    area.findComponent({ name: 'TemplateQueryPicker' }).vm.$emit('use', { reference: QUERY, text: QUERY_TEXT });
    await flushPromises();

    await area.get('[data-testid="etl-template-unlink"]').trigger('click');
    await flushPromises();

    expect(editors(area).templateQuery).toBeNull();
    expect(editors(area).sparqlTemplate).toBe(QUERY_TEXT);
    expect(area.find('[data-testid="etl-template-unlink"]').exists()).toBe(false);
  });

  it('opens a saved version that is linked to a pinned query version', async () => {
    store.loadEtlJobVersions.mockResolvedValue([
      {
        id: 'urn:sqlib:etl-job-version:v1',
        isPartOf: JOB_ID,
        version: 1,
        sql: SAVED_SQL,
        sparqlTemplate: QUERY_TEXT,
        templateQuery: QUERY_V2,
        templateQueryVersion: QUERY_V2,
        backendId: 'urn:sqlib:backend:ephemeral',
        currentColumnMappingVersionId: MAPPING_VERSION,
      },
    ]);
    const area = await mountSaved();

    expect(editors(area).templateQuery).toBe(QUERY_V2);
    expect(editors(area).sparqlTemplate).toBe(QUERY_TEXT);
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);
  });
});
