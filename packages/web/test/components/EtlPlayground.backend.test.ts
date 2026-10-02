/**
 * Which backend a saved pipeline runs on: the job's default backend, set in
 * the Details tab, and this browser's last pick in the run bar ahead of it.
 * A version's recorded backend no longer moves the run bar.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed } from 'vue';
import type { CallableDraft } from '@/composables/useCallableDrafts';
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';
import { setLastBackend, getLastBackend } from '@/lib/backendDefaults';

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
type Editors = {
  selectedBackendId: string;
  jobDefaultBackend: string;
  defaultBackendConfirmOpen: boolean;
  onRunBackendChange: (value: string) => void;
  handleDetailsBackendChange: (value: string) => void;
  confirmDefaultBackendChange: () => void;
  loadVersion: (id: string) => Promise<void>;
  save: () => Promise<void>;
};

const editors = (area: Area) => area.vm as unknown as Editors;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
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
      // Recorded with the version, but no longer what the run bar starts on.
      backendId: BACKEND_B,
      currentColumnMappingVersionId: MAPPING_VERSION,
    },
  ]);
  store.updateEtlJob.mockResolvedValue({});
  store.fetchColumnMappingVersion.mockResolvedValue({ id: MAPPING_VERSION, columns: SAVED_MAPPINGS });
});


function withJobDefault(defaultBackend?: string) {
  store.fetchEtlJob.mockResolvedValue({
    id: JOB_ID,
    name: 'People to RDF',
    currentVersionId: 'urn:sqlib:etl-job-version:v1',
    libraryIds: ['urn:sqlib:library:lib1'],
    ...(defaultBackend ? { defaultBackend } : {}),
  });
}

describe('EtlPlayground — backend', () => {
  it('starts on the in-memory store when there is no pick and no default', async () => {
    const area = await mountSaved();
    expect(editors(area).selectedBackendId).toBe(EPHEMERAL_BACKEND_ID);
  });

  it('starts on the job default, and a last pick beats it', async () => {
    withJobDefault(BACKEND_A);
    const first = await mountSaved();
    expect(editors(first).selectedBackendId).toBe(BACKEND_A);
    first.unmount();

    setLastBackend('etlJob', JOB_ID, BACKEND_B);
    const second = await mountSaved();
    expect(editors(second).selectedBackendId).toBe(BACKEND_B);
  });

  it('skips a last pick naming a deleted backend', async () => {
    withJobDefault(BACKEND_A);
    setLastBackend('etlJob', JOB_ID, 'urn:sqlib:backend:gone');
    const area = await mountSaved();
    expect(editors(area).selectedBackendId).toBe(BACKEND_A);
  });

  it('remembers a run bar pick, and that pick is not an edit', async () => {
    const area = await mountSaved();
    editors(area).onRunBackendChange(BACKEND_A);
    await flushPromises();
    vi.advanceTimersByTime(600);
    await flushPromises();
    expect(getLastBackend('etlJob', JOB_ID)).toBe(BACKEND_A);
    expect(drafts.records.has(JOB_ID)).toBe(false);
  });

  it('loading a version keeps the run bar where it is', async () => {
    const area = await mountSaved();
    editors(area).onRunBackendChange(BACKEND_A);
    await editors(area).loadVersion('urn:sqlib:etl-job-version:v1');
    await flushPromises();
    expect(editors(area).selectedBackendId).toBe(BACKEND_A);
  });

  it('saves a first default at once, and the run bar follows it', async () => {
    const area = await mountSaved();
    editors(area).handleDetailsBackendChange(BACKEND_A);
    await flushPromises();
    expect(store.updateEtlJob).toHaveBeenCalledWith(JOB_ID, { defaultBackend: BACKEND_A });
    expect(editors(area).selectedBackendId).toBe(BACKEND_A);
    expect(editors(area).defaultBackendConfirmOpen).toBe(false);
  });

  it('asks before replacing a real default, and clears to null for in-memory', async () => {
    withJobDefault(BACKEND_A);
    const area = await mountSaved();
    editors(area).handleDetailsBackendChange(EPHEMERAL_BACKEND_ID);
    await flushPromises();
    expect(store.updateEtlJob).not.toHaveBeenCalled();
    expect(editors(area).defaultBackendConfirmOpen).toBe(true);

    editors(area).confirmDefaultBackendChange();
    await flushPromises();
    expect(store.updateEtlJob).toHaveBeenCalledWith(JOB_ID, { defaultBackend: null });
    expect(editors(area).jobDefaultBackend).toBe(EPHEMERAL_BACKEND_ID);
  });

  it('puts the old default back when the save fails', async () => {
    store.updateEtlJob.mockRejectedValue(new Error('the server said no'));
    const area = await mountSaved();
    editors(area).handleDetailsBackendChange(BACKEND_A);
    await flushPromises();
    expect(editors(area).jobDefaultBackend).toBe(EPHEMERAL_BACKEND_ID);
  });

  it('leaves a deliberate run bar pick alone when the default changes', async () => {
    const area = await mountSaved();
    editors(area).onRunBackendChange(BACKEND_B);
    editors(area).handleDetailsBackendChange(BACKEND_A);
    await flushPromises();
    expect(editors(area).selectedBackendId).toBe(BACKEND_B);
  });
});
