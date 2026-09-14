/**
 * The pipeline screen's second output target: its rows, kept as a tuple set
 * version (issue #211).
 *
 * The run bar's sentence ends in a backend — SQL in, triples out, written to a
 * store. This is the other end the same table can go to, and the wiring that
 * matters is which pipeline version it names: the server re-runs the *saved*
 * version, so the screen must refuse whenever what is on it is not that.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed } from 'vue';
import type { CallableDraft } from '@/composables/useCallableDrafts';

const JOB_ID = 'urn:sqlib:etl-job:j1';
const JOB_VERSION = 'urn:sqlib:etl-job-version:v1';
const MAPPING_VERSION = 'urn:sqlib:etl-column-mapping-version:m1';
const SAVED_SQL = `SELECT * FROM read_csv('data/examples/people.csv')`;

const jobs = vi.hoisted(() => ({
  fetchEtlJob: vi.fn(),
  loadEtlJobVersions: vi.fn(),
  fetchColumnMappingVersion: vi.fn(),
  createEtlJob: vi.fn(),
  createEtlJobVersion: vi.fn(),
  updateEtlJob: vi.fn(),
}));

const tupleSets = vi.hoisted(() => ({
  sets: [] as Array<Record<string, unknown>>,
  loadTupleSets: vi.fn(),
  createTupleSet: vi.fn(),
  createVersionFromEtl: vi.fn(),
}));

/** Toggled per test, so the same mocks cover a scratch pipeline and a saved one. */
const isScratch = ref(false);

vi.mock('@/composables/useEtlJobsStore', () => ({ useEtlJobsStore: () => jobs }));
vi.mock('@/composables/useTupleSetsStore', () => ({
  useTupleSetsStore: () => ({
    loadTupleSets: tupleSets.loadTupleSets,
    createTupleSet: tupleSets.createTupleSet,
    createVersionFromEtl: tupleSets.createVersionFromEtl,
    tupleSets: { get value() { return tupleSets.sets; } },
  }),
}));
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
    isScratch,
    hydrating: ref(false),
    savedAt: ref(null),
    flush: vi.fn(),
  }),
}));
vi.mock('@/composables/useCallableDrafts', () => ({
  useCallableDrafts: () => ({
    save: (record: Record<string, unknown>) => {
      drafts.set(String(record.basedOn), record);
      draftsVersion.value += 1;
    },
    remove: (id: string) => {
      for (const [basedOn, record] of drafts) {
        if (record.id === id) drafts.delete(basedOn);
      }
      draftsVersion.value += 1;
    },
    draftFor: (id: string) => drafts.get(id) ?? null,
    allDrafts: computed(() => {
      void draftsVersion.value;
      return [...drafts.values()] as unknown as CallableDraft[];
    }),
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

const drafts = new Map<string, Record<string, unknown>>();
const draftsVersion = ref(0);

async function mountPipeline() {
  const EtlPlayground = (await import('@/components/EtlPlayground.vue')).default;
  const area = mount(EtlPlayground, {
    props: { scratchId: isScratch.value ? 'scratch-1' : null, etlJobId: isScratch.value ? null : JOB_ID },
  });
  await flushPromises();
  return area;
}

type Area = Awaited<ReturnType<typeof mountPipeline>>;

async function edit(area: Area, sql: string) {
  (area.vm as unknown as { sqlQuery: string }).sqlQuery = sql;
  await flushPromises();
  vi.advanceTimersByTime(600);
  await flushPromises();
}

const sinkButton = (area: Area) => area.get('[data-testid="etl-tuple-sink-open"]');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  drafts.clear();
  draftsVersion.value = 0;
  isScratch.value = false;
  tupleSets.sets = [];
  tupleSets.loadTupleSets.mockResolvedValue(undefined);
  tupleSets.createVersionFromEtl.mockResolvedValue({
    version: { id: 'urn:v', version: 1, rowCount: 3 },
    reused: false,
  });

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ schema: [], rows: [] }),
  }));

  jobs.fetchEtlJob.mockResolvedValue({
    id: JOB_ID,
    name: 'People to RDF',
    description: 'CSV in, triples out',
    currentVersionId: JOB_VERSION,
    libraryIds: ['urn:sqlib:library:lib1'],
  });
  jobs.loadEtlJobVersions.mockResolvedValue([
    {
      id: JOB_VERSION,
      isPartOf: JOB_ID,
      version: 1,
      sql: SAVED_SQL,
      sparqlTemplate: 'CONSTRUCT { ?s ?p ?o } WHERE { VALUES (?s ?p ?o) {} }',
      backendId: 'urn:sqlib:backend:ephemeral',
      currentColumnMappingVersionId: MAPPING_VERSION,
    },
  ]);
  jobs.fetchColumnMappingVersion.mockResolvedValue({
    id: MAPPING_VERSION,
    columns: [{ columnName: 'name', targetVariable: 'name', termType: 'literal', nullPolicy: 'undef' }],
  });
});

describe('EtlPlayground — the tuple set sink', () => {
  it('saves the version on screen, not the editors', async () => {
    const area = await mountPipeline();
    await sinkButton(area).trigger('click');
    await flushPromises();
    await area.get('[data-testid="etl-tuple-sink-name"]').setValue('People');
    tupleSets.createTupleSet.mockResolvedValue({
      id: 'urn:sqlib:tupleSet:People',
      name: 'People',
      isPartOf: ['urn:sqlib:library:lib1'],
    });

    await area.get('[data-testid="etl-tuple-sink-create"]').trigger('click');
    await flushPromises();

    expect(tupleSets.createVersionFromEtl).toHaveBeenCalledWith('urn:sqlib:tupleSet:People', {
      etlJobVersionId: JOB_VERSION,
      comment: 'Rows from “People to RDF” v1',
    });
  });

  it('refuses while edits are unsaved, and says which way out', async () => {
    // The rows would come from the saved SQL, so a snapshot taken now would
    // carry a version id that does not explain them.
    const area = await mountPipeline();
    expect(sinkButton(area).attributes('disabled')).toBeUndefined();

    await edit(area, 'SELECT 1 AS name');

    expect(sinkButton(area).attributes('disabled')).toBeDefined();
    expect(sinkButton(area).attributes('title')).toContain('Save your edits first');
  });

  it('refuses on a pipeline that was never saved', async () => {
    isScratch.value = true;
    const area = await mountPipeline();

    expect(sinkButton(area).attributes('disabled')).toBeDefined();
    expect(sinkButton(area).attributes('title')).toContain('Save this pipeline first');
  });
});
