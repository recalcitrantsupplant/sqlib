/**
 * The column preview after a saved pipeline opens. The preview reads the
 * SQL's columns. It must not replace the saved column mapping, because that
 * shows unsaved edits that nobody made.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed } from 'vue';

const JOB_ID = 'urn:sqlib:etl-job:j1';
const SAVED_SQL = 'SELECT site, label FROM sample';
const MAPPING_VERSION = 'urn:sqlib:etl-column-mapping-version:m1';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const SAVED_MAPPINGS = [
  { columnName: 'site', targetVariable: 'thing', termType: 'uri' as const, nullPolicy: 'skipRow' as const },
  {
    columnName: 'label', targetVariable: 'label', termType: 'uri' as const,
    iriTemplate: 'https://example.org/property/{value}', nullPolicy: 'skipRow' as const,
  },
];

const store = vi.hoisted(() => ({
  fetchEtlJob: vi.fn(),
  loadEtlJobVersions: vi.fn(),
  fetchColumnMappingVersion: vi.fn(),
  createEtlJob: vi.fn(),
  createEtlJobVersion: vi.fn(),
  updateEtlJob: vi.fn(),
}));
const drafts = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>() }));

vi.mock('@/composables/useEtlJobsStore', () => ({ useEtlJobsStore: () => store }));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: ref('urn:sqlib:library:lib1'), activeLibraryName: ref('Library one') }),
}));
vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({ backends: ref([]), loading: ref(false), loadBackends: vi.fn() }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: () => ({ isScratch: ref(false), hydrating: ref(false), savedAt: ref(null), flush: vi.fn() }),
}));
vi.mock('@/composables/useCallableDrafts', () => ({
  useCallableDrafts: () => ({
    save: (record: Record<string, unknown>) => { drafts.records.set(String(record.basedOn), record); },
    remove: (id: string) => {
      for (const [basedOn, record] of drafts.records) if (record.id === id) drafts.records.delete(basedOn);
    },
    draftFor: (id: string) => drafts.records.get(id) ?? null,
    allDrafts: computed(() => []),
  }),
  UNASSIGNED_LIBRARY_ID: 'unassigned',
}));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
  },
}));

/** What the server proposes for a new pipeline: plain literals, as before. */
function previewFor(sql: string) {
  const columns = sql.includes('value') ? ['site', 'label', 'value'] : ['site', 'label'];
  return {
    schema: columns.map((columnName) => ({ columnName, duckdbType: columnName === 'value' ? 'DOUBLE' : 'VARCHAR', nullable: true })),
    rows: [],
    inferredMapping: {
      columns: columns.map((columnName) => ({
        columnName,
        targetVariable: columnName,
        termType: 'literal',
        datatypeIri: columnName === 'value' ? `${XSD}double` : `${XSD}string`,
        nullPolicy: 'undef',
      })),
    },
  };
}

type Editors = { sqlQuery: string; columnMappings: unknown[] };

async function mountSaved() {
  const EtlPlayground = (await import('@/components/EtlPlayground.vue')).default;
  const area = mount(EtlPlayground, { props: { scratchId: null, etlJobId: JOB_ID } });
  await flushPromises();
  return area;
}

/** Let the 1 s preview and the 500 ms autosave run. */
async function settle() {
  for (let i = 0; i < 3; i += 1) {
    vi.advanceTimersByTime(1100);
    await flushPromises();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  drafts.records.clear();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => ({
    ok: true,
    json: async () => previewFor(JSON.parse(init?.body ?? '{}').sql ?? ''),
  })));
  store.fetchEtlJob.mockResolvedValue({
    id: JOB_ID, name: 'Sites to RDF', description: '',
    currentVersionId: 'urn:sqlib:etl-job-version:v1', libraryIds: ['urn:sqlib:library:lib1'],
  });
  store.loadEtlJobVersions.mockResolvedValue([{
    id: 'urn:sqlib:etl-job-version:v1', isPartOf: JOB_ID, version: 1, sql: SAVED_SQL,
    sparqlTemplate: 'CONSTRUCT { ?thing ?p ?label } WHERE { VALUES (?thing ?label) { (UNDEF UNDEF) } }',
    backendId: 'urn:sqlib:backend:ephemeral', currentColumnMappingVersionId: MAPPING_VERSION,
  }]);
  store.fetchColumnMappingVersion.mockResolvedValue({ id: MAPPING_VERSION, columns: SAVED_MAPPINGS });
});

describe('EtlPlayground: the column preview and a saved mapping', () => {
  it('keeps the saved mapping after the preview, with no unsaved edits', async () => {
    const area = await mountSaved();
    await settle();

    expect(fetch).toHaveBeenCalled();
    expect((area.vm as unknown as Editors).columnMappings).toEqual(SAVED_MAPPINGS);
    expect(area.find('[data-testid="draft-pill"]').exists()).toBe(false);
    expect(drafts.records.has(JOB_ID)).toBe(false);
  });

  it('keeps the saved rows and adds a row for a new column when the SQL changes', async () => {
    const area = await mountSaved();
    await settle();

    (area.vm as unknown as Editors).sqlQuery = 'SELECT site, label, value FROM sample';
    await flushPromises();
    await settle();

    expect((area.vm as unknown as Editors).columnMappings).toEqual([
      ...SAVED_MAPPINGS,
      { columnName: 'value', targetVariable: 'value', termType: 'literal', datatypeIri: `${XSD}double`, nullPolicy: 'undef' },
    ]);
  });

  it('shows the IRI template of a saved row', async () => {
    const area = await mountSaved();
    await settle();
    const inputs = area.findAll('[data-testid="etl-iri-template"]');
    expect(inputs).toHaveLength(2);
    expect((inputs[1].element as HTMLInputElement).value).toBe('https://example.org/property/{value}');
  });
});
