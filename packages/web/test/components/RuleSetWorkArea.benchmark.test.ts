/**
 * "Create benchmark" on the rules screen — the pair #247 promised.
 *
 * A rule set has always been able to become a test; the run bar offered no
 * benchmark because a benchmark subject was `query | queryGroup`. The model
 * learned the kind in #377, and this is the line that reaches it: the same
 * recipe — this version, this tuple set, this data graph — written as a subject
 * spec with two axes and no store axis.
 *
 * What is pinned here is the *shape of the spec*, because that is where the
 * screen can go wrong silently. The API refuses a rule-set spec carrying
 * backends and refuses an axis member that is not the right kind of entity, so
 * a spec built wrong here fails at save with a message about a field the author
 * never saw. Three things therefore matter: no `backends` key at all, the axes
 * naming the *entity* rather than the version on screen, and the button
 * refusing rather than quietly dropping an input that has nowhere to be named.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';

const RULE_SET_ID = 'urn:sqlib:rule-set:r1';
const LIBRARY_ID = 'urn:lib:1';
const VERSION_ID = 'urn:sqlib:rule-set-version:r1-v2';
const TUPLE_SET_ID = 'urn:sqlib:tuple-set:t1';
const TUPLE_VERSION_ID = 'urn:sqlib:tuple-set-version:t1-v1';
const GRAPH_ID = 'urn:sqlib:data-graph:g1';
const GRAPH_VERSION_ID = 'urn:sqlib:data-graph-version:g1-v1';
const NO_ARGUMENTS_IRI = 'https://sparql-query-lib/NoArguments';

const api = vi.hoisted(() => ({
  listRuleSetVersions: vi.fn(),
  exportRuleSetSrl: vi.fn(),
  executeRulesPlayground: vi.fn(),
  analyzeRuleSetSrl: vi.fn(),
  compileRuleSetSrl: vi.fn(),
  listDataGraphs: vi.fn(),
  listDataGraphVersions: vi.fn(),
  getDataGraphVersion: vi.fn(),
  listTupleSets: vi.fn(),
  listTupleSetVersions: vi.fn(),
  getTupleSetVersion: vi.fn(),
  createTest: vi.fn(),
  createTestVersion: vi.fn(),
}));

const benchmarks = vi.hoisted(() => ({
  createExperiment: vi.fn(),
  createVersion: vi.fn(),
}));

const toasts = vi.hoisted(() => ({ error: [] as string[], success: [] as string[] }));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useBenchmarksStore', () => ({ useBenchmarksStore: () => benchmarks }));
vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn((message: string) => { toasts.success.push(String(message)); }),
    warning: vi.fn(),
    error: vi.fn((message: string) => { toasts.error.push(String(message)); }),
  },
}));
vi.mock('@/composables/useLibrariesStore', () => ({
  useLibrariesStore: () => ({
    loadLibraries: vi.fn(),
    libraries: ref([{ id: LIBRARY_ID, name: 'mylib' }]),
  }),
}));
vi.mock('@/composables/useRuleSetsStore', () => ({
  useRuleSetsStore: () => ({
    fetchRuleSet: vi.fn().mockResolvedValue({
      ruleSet: {
        id: RULE_SET_ID,
        name: 'Reachability',
        description: null,
        isPartOf: [LIBRARY_ID],
        currentVersion: VERSION_ID,
      },
      ifMatch: null,
    }),
    updateRuleSet: vi.fn(),
    deleteRuleSet: vi.fn(),
    concurrency: {},
  }),
}));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: ref(LIBRARY_ID), activeLibraryName: ref('mylib') }),
}));
vi.mock('@/composables/useCallableDrafts', () => ({
  useCallableDrafts: () => ({
    remove: vi.fn(),
    save: vi.fn(),
    draftFor: () => null,
    allDrafts: ref([]),
  }),
  UNASSIGNED_LIBRARY_ID: 'unassigned',
}));
vi.mock('@/composables/usePrefixManager', () => ({
  usePrefixManager: () => ({ autoDiscoverFromRule: vi.fn(), autoDiscoverFromSparql: vi.fn() }),
}));
vi.mock('@/composables/useScratchRecord', () => ({
  useScratchRecord: (options: { scratchId: () => string | null | undefined }) => ({
    isScratch: computed(() => Boolean(options.scratchId())),
    hydrating: ref(false),
    savedAt: ref(null),
    flush: vi.fn(),
    persist: vi.fn(),
  }),
}));

(globalThis as Record<string, unknown>).useFeatureFlags = () => ({ isEnabled: () => true });
(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({ public: { apiBaseUrl: 'http://api.test' } });

/*
 * These specs exercise the SRL rule-tuples extension, which a default build
 * withholds (`ruleTuples` defaults off). Declaring it on here keeps them
 * testing the extension rather than the gate; `ruleTuplesGate.test.ts` covers
 * what the same surfaces do with it off.
 */
(globalThis as Record<string, unknown>).__NUXT_TEST_CONFIG__ = {
  public: { apiBaseUrl: 'http://api.test', featureFlags: { ruleTuples: true } },
};


const EditorStub = {
  props: ['sparqlCode'],
  emits: ['update:sparqlCode'],
  template: '<div data-testid="document">{{ sparqlCode }}<slot name="footer" /></div>',
};

async function mountSaved() {
  const { mount } = await import('@vue/test-utils');
  const RuleSetWorkArea = (await import('@/components/RuleSetWorkArea.vue')).default;
  const wrapper = mount(RuleSetWorkArea, {
    props: { ruleSetId: RULE_SET_ID, scratchId: null },
    global: {
      stubs: {
        SparqlEditorPanel: EditorStub,
        RuleSetInspectorPanel: true,
        SrlDiffPane: true,
        AddRuleSetDialog: true,
        Dialog: true,
      },
    },
  });
  for (let tick = 0; tick < 8; tick += 1) await nextTick();
  return wrapper;
}

type WorkArea = Awaited<ReturnType<typeof mountSaved>>;

/** The run bar's create buttons carry a testid per target. */
const createButton = (wrapper: WorkArea, target: 'test' | 'benchmark') =>
  wrapper.find(`[data-testid="run-bar-create-${target}"]`);

/**
 * The inputs are edited in the Inputs tab, whose panel is stubbed here — so the
 * selection goes in through the model the work area binds to it, which is the
 * same path a click takes.
 */
async function selectInputs(wrapper: WorkArea, patch: Record<string, unknown>) {
  const inspector = wrapper.findComponent({ name: 'RuleSetInspectorPanel' });
  for (const [event, value] of Object.entries(patch)) {
    await inspector.vm.$emit(`update:${event}`, value);
  }
  await nextTick();
}

/** The one subject spec a create call sent. */
const sentSpec = () => (benchmarks.createVersion.mock.calls[0]?.[1] as {
  subjectSpecs: { subject: string; inputs?: string[]; backends?: string[]; dataGraphs?: string[] }[];
}).subjectSpecs[0];

describe('RuleSetWorkArea — create benchmark from the recipe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toasts.error.length = 0;
    toasts.success.length = 0;

    api.listRuleSetVersions.mockResolvedValue([
      { id: 'urn:sqlib:rule-set-version:r1-v1', version: 1, immutable: true, comment: null, dateModified: null },
      { id: VERSION_ID, version: 2, immutable: true, comment: null, dateModified: null },
    ]);
    api.exportRuleSetSrl.mockResolvedValue({
      srl: 'RULE { ?s :q ?o } WHERE { ?s :p ?o }',
      tupleSeeds: null,
      tuplesEnabled: false,
      warnings: [],
    });
    api.analyzeRuleSetSrl.mockResolvedValue({
      valid: true, error: null, ruleCount: 1, dataBlockCount: 0, rules: [], dataBlocks: [],
    });
    api.listDataGraphs.mockResolvedValue([
      { id: GRAPH_ID, name: 'Roads', isPartOf: [LIBRARY_ID], currentVersion: GRAPH_VERSION_ID },
    ]);
    api.listDataGraphVersions.mockResolvedValue([
      { id: GRAPH_VERSION_ID, version: 1, tripleCount: 13, contentFormat: 'text/turtle' },
    ]);
    api.getDataGraphVersion.mockResolvedValue({ data: { contentString: '' } });
    api.listTupleSets.mockResolvedValue([
      { id: TUPLE_SET_ID, name: 'Seeds', isPartOf: [LIBRARY_ID], currentVersion: TUPLE_VERSION_ID },
    ]);
    api.listTupleSetVersions.mockResolvedValue([
      { id: TUPLE_VERSION_ID, version: 1, rowCount: 2, contentString: '{"head":{"vars":["a"]},"results":{"bindings":[]}}' },
    ]);
    api.getTupleSetVersion.mockResolvedValue({
      data: { contentString: '{"head":{"vars":["a"]},"results":{"bindings":[]}}' },
    });

    benchmarks.createExperiment.mockResolvedValue({ id: 'urn:sqlib:benchmark:b1' });
    benchmarks.createVersion.mockResolvedValue({ version: 1 });
  });

  it('offers the benchmark button beside the test button', async () => {
    const wrapper = await mountSaved();
    expect(createButton(wrapper, 'benchmark').exists()).toBe(true);
    expect(createButton(wrapper, 'test').exists()).toBe(true);
    expect(createButton(wrapper, 'benchmark').attributes('disabled')).toBeUndefined();
  });

  /*
   * The store axis is collapsed for a rule set and the API refuses a spec that
   * names one, so this is the assertion that keeps the button honest: the key
   * is absent, not an empty array that a later reader might fan a backend onto.
   */
  it('sends a spec with no backends and the version as the subject', async () => {
    const wrapper = await mountSaved();
    await createButton(wrapper, 'benchmark').trigger('click');
    await nextTick();
    await nextTick();

    expect(benchmarks.createExperiment).toHaveBeenCalledTimes(1);
    const spec = sentSpec();
    expect(spec.subject).toBe(VERSION_ID);
    expect('backends' in spec).toBe(false);
    // Nothing selected: the version's own stored seeds, no base graph.
    expect(spec.inputs).toEqual([NO_ARGUMENTS_IRI]);
    expect('dataGraphs' in spec).toBe(false);
  });

  /*
   * The axes name the entity, not the version on screen. A benchmark is a
   * recipe re-run against a moving library — the run records what each
   * reference resolved to — where a *test* pins, because it asserts a result.
   */
  it('names the tuple set and the data graph entities, not their versions', async () => {
    const wrapper = await mountSaved();
    await selectInputs(wrapper, {
      tupleSource: 'saved',
      tupleSetVersionId: TUPLE_VERSION_ID,
      dataSource: 'saved',
      dataGraphVersionId: GRAPH_VERSION_ID,
    });

    await createButton(wrapper, 'benchmark').trigger('click');
    await nextTick();
    await nextTick();

    const spec = sentSpec();
    expect(spec.inputs).toEqual([TUPLE_SET_ID]);
    expect(spec.dataGraphs).toEqual([GRAPH_ID]);
  });

  /*
   * Inline content has nothing in the library to name. Dropping it would create
   * a benchmark that runs against an empty base graph while the screen shows
   * the data the author expects it to be measuring.
   */
  it('refuses while an inline data graph would be lost', async () => {
    const wrapper = await mountSaved();
    await selectInputs(wrapper, { dataSource: 'inline', dataGraphInline: ':a :p :b .' });

    const button = createButton(wrapper, 'benchmark');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('title')).toContain('Save the inline data graph first');
    expect(benchmarks.createExperiment).not.toHaveBeenCalled();
  });

  /*
   * The same refusal for inline rows, but only when they would change the run:
   * text identical to what the version stored is what a spec with no `inputs`
   * already executes, so refusing there would block a benchmark for nothing.
   */
  it('refuses while inline tuple rows would be lost', async () => {
    const wrapper = await mountSaved();
    await selectInputs(wrapper, {
      tuplesEnabled: true,
      tupleSource: 'inline',
      inlineTuples: 'TUPLE (?a) { ("x") }',
    });

    const button = createButton(wrapper, 'benchmark');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('title')).toContain('Save the inline rows as a tuple set first');
  });
});
