/**
 * The ETL sink: a pipeline's rows kept as a tuple set version (issue #211).
 *
 * The property that matters here is what crosses the wire. The rows are never
 * in the browser — the server re-runs the saved job version's SQL — so the only
 * thing this component can get wrong is *which* version it names, and whether
 * it lets an author name one that cannot explain the rows it would produce.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import TupleSetSink from '@/components/etl/TupleSetSink.vue';

const LIBRARY = 'urn:sqlib:library:lib1';
const JOB_VERSION = 'urn:sqlib:etl-job-version:v3';

const store = vi.hoisted(() => ({
  tupleSets: [] as Array<Record<string, unknown>>,
  loadTupleSets: vi.fn(),
  createTupleSet: vi.fn(),
  createVersionFromEtl: vi.fn(),
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('@/composables/useTupleSetsStore', () => ({
  useTupleSetsStore: () => ({
    ...store,
    // After the spread, so the listing reads through to whatever the current
    // test set up rather than the empty array captured at mock time.
    tupleSets: { get value() { return store.tupleSets; } },
  }),
}));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: { value: LIBRARY } }),
}));
vi.mock('vue-sonner', () => ({ toast: toasts }));

const PROPS = {
  etlJobVersionId: JOB_VERSION,
  versionNumber: 3,
  jobName: 'People to RDF',
};

function tupleSet(name: string, currentVersionNumber: number | null = null) {
  return {
    id: `urn:sqlib:tupleSet:${name}`,
    name,
    isPartOf: [LIBRARY],
    currentVersionNumber,
  };
}

async function open(props: Record<string, unknown> = {}) {
  const sink = mount(TupleSetSink, { props: { ...PROPS, ...props } });
  await sink.get('[data-testid="etl-tuple-sink-open"]').trigger('click');
  await flushPromises();
  return sink;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.tupleSets = [];
  store.loadTupleSets.mockResolvedValue(undefined);
  // The real store appends a created set to the listing; the panel reads the
  // listing, so a stand-in that forgets would hide the retry path.
  store.createTupleSet.mockImplementation(async (input: { name: string }) => {
    const created = tupleSet(input.name);
    store.tupleSets = [...store.tupleSets, created];
    return created;
  });
  store.createVersionFromEtl.mockResolvedValue({
    version: { id: 'urn:sqlib:tupleSetVersion:new', version: 2, rowCount: 12 },
    reused: false,
  });
});

describe('TupleSetSink — what it offers', () => {
  it('scopes the listing to the pipeline’s library', async () => {
    await open();
    expect(store.loadTupleSets).toHaveBeenCalledWith({ library: LIBRARY });
  });

  it('offers a name for a new set even when the library holds none', async () => {
    // The first save a pipeline makes has nowhere to go yet, so an empty
    // library is the common case rather than the edge one.
    const sink = await open();
    expect((sink.get('[data-testid="etl-tuple-sink-name"]').element as HTMLInputElement).value)
      .toBe('People to RDF rows');
  });

  it('lists the sets already in the library', async () => {
    store.tupleSets = [tupleSet('Cities', 2), tupleSet('Airports')];
    const sink = await open();
    const panel = sink.get('[data-testid="etl-tuple-sink-panel"]').text();
    expect(panel).toContain('Airports');
    expect(panel).toContain('Cities');
    expect(panel).toContain('v2');
  });
});

describe('TupleSetSink — saving', () => {
  it('names the saved job version, and says which pipeline version it was', async () => {
    store.tupleSets = [tupleSet('Cities', 2)];
    const sink = await open();

    await sink.get('[data-testid="etl-tuple-sink-existing"]').trigger('click');
    await flushPromises();

    expect(store.createVersionFromEtl).toHaveBeenCalledWith('urn:sqlib:tupleSet:Cities', {
      etlJobVersionId: JOB_VERSION,
      comment: 'Rows from “People to RDF” v3',
    });
    // A save that worked closes the panel and says how many rows landed.
    expect(sink.find('[data-testid="etl-tuple-sink-panel"]').exists()).toBe(false);
    expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining('12 rows to “Cities” v2'));
  });

  /**
   * A run that produced what the set already holds cuts no version (#211's
   * version churn). The pipeline still ran, so the panel closes as it does on
   * any successful save — what changes is the sentence, because "Saved" would
   * be a claim about a version that was not cut.
   */
  it('says nothing was cut when the set already holds the rows', async () => {
    store.tupleSets = [tupleSet('Cities', 2)];
    store.createVersionFromEtl.mockResolvedValue({
      version: { id: 'urn:sqlib:tupleSetVersion:current', version: 2, rowCount: 12 },
      reused: true,
    });
    const sink = await open();

    await sink.get('[data-testid="etl-tuple-sink-existing"]').trigger('click');
    await flushPromises();

    expect(sink.find('[data-testid="etl-tuple-sink-panel"]').exists()).toBe(false);
    expect(toasts.error).not.toHaveBeenCalled();
    const [message] = toasts.success.mock.calls[0] as [string];
    expect(message).toContain('already holds these 12 rows');
    expect(message).toContain('“Cities” v2');
    expect(message).not.toContain('Saved');
  });

  it('sends no column mapping, so the job version’s own typing is used', async () => {
    // Pinning an older mapping is a re-snapshot, not something the editor
    // chooses: the mapping on screen is the one the version already names.
    store.tupleSets = [tupleSet('Cities', 2)];
    const sink = await open();
    await sink.get('[data-testid="etl-tuple-sink-existing"]').trigger('click');
    await flushPromises();

    const [, body] = store.createVersionFromEtl.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty('columnMappingVersionId');
  });

  it('creates the named set and fills it in one go', async () => {
    const sink = await open();
    await sink.get('[data-testid="etl-tuple-sink-name"]').setValue('People');
    await sink.get('[data-testid="etl-tuple-sink-create"]').trigger('click');
    await flushPromises();

    expect(store.createTupleSet).toHaveBeenCalledWith({ name: 'People', isPartOf: [LIBRARY] });
    expect(store.createVersionFromEtl).toHaveBeenCalledWith('urn:sqlib:tupleSet:People', {
      etlJobVersionId: JOB_VERSION,
      comment: 'Rows from “People to RDF” v3',
    });
  });

  it('keeps the panel open and shows the server’s reason when the run fails', async () => {
    // A mapping that types no columns, SQL that will not run, a result over the
    // per-version cap: all of them arrive as a message worth reading, and a
    // panel that closed on failure would take it away with it.
    store.tupleSets = [tupleSet('Cities', 2)];
    store.createVersionFromEtl.mockRejectedValue(
      new Error('The ETL result passed the limit for one tuple set version after 4000 rows'),
    );
    const sink = await open();

    await sink.get('[data-testid="etl-tuple-sink-existing"]').trigger('click');
    await flushPromises();

    expect(sink.get('[data-testid="etl-tuple-sink-error"]').text()).toContain('passed the limit');
    expect(sink.get('[data-testid="etl-tuple-sink-panel"]').exists()).toBe(true);
    expect(toasts.error).toHaveBeenCalled();
  });

  it('leaves the created set as the retry target when the run fails', async () => {
    // The set is already named and already stored, so a second Create would
    // make a namesake beside it. The retry belongs in the set that exists.
    store.createVersionFromEtl.mockRejectedValue(new Error('nope'));
    const sink = await open();
    await sink.get('[data-testid="etl-tuple-sink-create"]').trigger('click');
    await flushPromises();

    expect(sink.get('[data-testid="etl-tuple-sink-error"]').text()).toContain('nope');
    expect(sink.get('[data-testid="etl-tuple-sink-create"]').attributes('disabled')).toBeDefined();

    store.createVersionFromEtl.mockResolvedValue({ id: 'v', version: 1, rowCount: 3 });
    await sink.get('[data-testid="etl-tuple-sink-existing"]').trigger('click');
    await flushPromises();

    expect(store.createTupleSet).toHaveBeenCalledTimes(1);
    expect(store.createVersionFromEtl).toHaveBeenLastCalledWith(
      'urn:sqlib:tupleSet:People to RDF rows',
      expect.objectContaining({ etlJobVersionId: JOB_VERSION }),
    );
  });
});

describe('TupleSetSink — when it refuses', () => {
  it('is disabled, and says why, while the pipeline cannot be a source', async () => {
    const sink = mount(TupleSetSink, {
      props: { ...PROPS, etlJobVersionId: null, blockedReason: 'Save this pipeline first' },
    });
    const button = sink.get('[data-testid="etl-tuple-sink-open"]');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('title')).toBe('Save this pipeline first');

    await button.trigger('click');
    expect(sink.find('[data-testid="etl-tuple-sink-panel"]').exists()).toBe(false);
  });
});
