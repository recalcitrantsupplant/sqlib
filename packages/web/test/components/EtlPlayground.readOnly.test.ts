/**
 * The ETL screen on a read-only deployment: Run sends the saved version to
 * `/etl-jobs/:id/execute`, never SQL to the playground route, and the editors
 * cannot be changed. The deployment refuses `/etl-jobs/preview`, so the screen
 * neither calls it nor offers the controls that would.
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
  executeEtlJob: vi.fn(),
}));
const mode = vi.hoisted(() => ({ readOnly: true }));

/** A stand-in for the browser-local store, so one spec cannot leak into another. */
const drafts = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>() }));

vi.mock('@/composables/useEtlJobsStore', () => ({ useEtlJobsStore: () => store }));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({
    activeLibraryId: ref('urn:sqlib:library:lib1'),
    activeLibraryName: ref('Library one'),
  }),
}));
const BACKEND_A = 'urn:sqlib:backend:a';
const BACKEND_B = 'urn:sqlib:backend:b';
const backendList = ref([
  { id: BACKEND_A, name: 'Backend A' },
  { id: BACKEND_B, name: 'Backend B' },
]);
vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({ backends: backendList, loading: ref(false), loadBackends: vi.fn() }),
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
vi.mock('@/composables/useDeploymentMode', async () => {
  const { computed } = await import('vue');
  return {
    useDeploymentMode: () => ({
      isReadOnly: computed(() => mode.readOnly),
      isResolved: computed(() => true),
      runLimits: computed(() => null),
      ensureLoaded: async () => {},
    }),
  };
});
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// The three editors are CodeMirror instances; what this spec is about is the
// bodies they hold, so a textarea stands in for each.
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template: '<textarea :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  drafts.records.clear();
  draftsVersion.value = 0;
  mode.readOnly = true;

  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ schema: [], rows: [] }) });
  vi.stubGlobal('fetch', fetchMock);

  store.fetchEtlJob.mockResolvedValue({
    id: JOB_ID,
    name: 'People to RDF',
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
      backendId: BACKEND_B,
      currentColumnMappingVersionId: MAPPING_VERSION,
    },
  ]);
  store.fetchColumnMappingVersion.mockResolvedValue({ id: MAPPING_VERSION, columns: SAVED_MAPPINGS });
  store.executeEtlJob.mockResolvedValue({
    status: 'completed',
    output: '<a> <b> <c> .\n',
    outputFormat: 'application/n-triples',
    totalRows: 3,
    totalChunks: 1,
    rowLimitApplied: 100000,
  });
});

describe('EtlPlayground on a read-only deployment', () => {
  it('runs the saved version through the job route, never the playground', async () => {
    const area = await mountSaved();

    await area.get('[data-testid="run-bar-run"]').trigger('click');
    await flushPromises();

    expect(store.executeEtlJob).toHaveBeenCalledWith(JOB_ID, { etlJobVersionId: 'urn:sqlib:etl-job-version:v1' });
    const playgroundCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/playground/etl/execute'));
    expect(playgroundCalls).toHaveLength(0);
    expect(area.find('[data-testid="etl-row-limit-note"]').text()).toContain('100,000');
  });

  it('holds the SQL and the template read-only', async () => {
    const area = await mountSaved();
    const editors = area.findAll('textarea')
      .filter((editor) => [SAVED_SQL, SAVED_TEMPLATE].includes((editor.element as HTMLTextAreaElement).value));
    expect(editors).toHaveLength(2);
    for (const editor of editors) expect(editor.attributes('disabled')).toBeDefined();
  });

  it('asks for no preview and offers no Peek or examples', async () => {
    vi.useFakeTimers();
    try {
      const area = await mountSaved();
      await vi.advanceTimersByTimeAsync(2000);
      await flushPromises();

      const previewCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/etl-jobs/preview'));
      expect(previewCalls).toHaveLength(0);
      expect(area.find('.btn-peek').exists()).toBe(false);
      expect(area.find('.example-select').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the playground route on a deployment that writes', async () => {
    mode.readOnly = false;
    const area = await mountSaved();
    const sql = area.findAll('textarea')
      .find((editor) => (editor.element as HTMLTextAreaElement).value === SAVED_SQL);
    expect(sql?.attributes('disabled')).toBeUndefined();
    expect(area.find('.btn-peek').exists()).toBe(true);
    expect(area.find('.example-select').exists()).toBe(true);
  });
});
