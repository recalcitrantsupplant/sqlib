import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';

/**
 * A draft rule set — the rules work area with nothing saved yet.
 *
 * Two things are asserted here. The shape of what is authored: one SRL
 * document, sent as a document, with the tuple extension opt-in beside it. And
 * that a draft is the *same screen* as a saved rule set: it used to be a
 * separate component (`RulesPlayground`), which is how the two came to
 * disagree about what a rule set even looks like.
 *
 * The editor is stubbed rather than mounted. It is CodeMirror, and what matters
 * here is which text the work area hands it and what it does with what comes
 * back — not that CodeMirror renders.
 */

const api = vi.hoisted(() => ({
  executeRulesPlayground: vi.fn(),
  createRuleSet: vi.fn(),
  importRuleSetSrl: vi.fn(),
  analyzeRuleSetSrl: vi.fn(),
  compileRuleSetSrl: vi.fn(),
  validateRuleData: vi.fn(),
  // The work area offers a data graph to run against, so it lists them on
  // mount. Stubbed empty: what that dropdown contains is the data-graph
  // strip's business, not this file's.
  listDataGraphs: vi.fn(),
  listDataGraphVersions: vi.fn(),
  // Named tuples are the other run input, listed on mount for the same reason.
  listTupleSets: vi.fn(),
  listTupleSetVersions: vi.fn(),
}));

/** The scratch record the workspace hydrates from, per test. */
const scratch = vi.hoisted(() => ({ body: {} as Record<string, unknown>, name: 'Untitled rule set' }));
const scratchCollected = vi.hoisted(() => ({ value: null as unknown }));
const toasts = vi.hoisted(() => ({ error: [] as string[] }));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn((message: string) => { toasts.error.push(String(message)); }),
  },
}));
vi.mock('@/composables/useLibrariesStore', () => ({
  useLibrariesStore: () => ({ loadLibraries: vi.fn(), libraries: ref([]) }),
}));
vi.mock('@/composables/useRuleSetsStore', () => ({
  useRuleSetsStore: () => ({
    fetchRuleSet: vi.fn(),
    updateRuleSet: vi.fn(),
    deleteRuleSet: vi.fn(),
    concurrency: {},
  }),
}));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: ref('urn:lib:1'), activeLibraryName: ref('mylib') }),
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
  useScratchRecord: (options: {
    scratchId: () => string | null | undefined;
    hydrate: (record: { name: string; body: Record<string, unknown> }) => void;
    collect: (record: { name: string }) => unknown;
  }) => {
    options.hydrate({ name: scratch.name, body: scratch.body });
    return {
      isScratch: computed(() => Boolean(options.scratchId())),
      hydrating: ref(false),
      savedAt: ref(null),
      flush: () => { scratchCollected.value = options.collect({ name: scratch.name }); },
      persist: () => {},
    };
  },
}));

/*
 * Nuxt auto-imports, which are not defined under plain vitest — put on
 * globalThis rather than mocked, because the component calls them as globals.
 */
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


/** A minimal editor stub: `data-testid="document"` carries the text it was given. */
const EditorStub = {
  props: ['sparqlCode'],
  emits: ['update:sparqlCode'],
  template: '<div data-testid="document">{{ sparqlCode }}<slot name="footer" /></div>',
};

async function mountWorkArea() {
  const { mount } = await import('@vue/test-utils');
  const RuleSetWorkArea = (await import('@/components/RuleSetWorkArea.vue')).default;
  const wrapper = mount(RuleSetWorkArea, {
    props: { ruleSetId: null, scratchId: 'urn:ui-temp:1' },
    global: {
      stubs: {
        SparqlEditorPanel: EditorStub,
        RuleSetInspectorPanel: true,
        SrlPreviewDialog: true,
        AddRuleSetDialog: true,
        Dialog: true,
      },
    },
  });
  await nextTick();
  await nextTick();
  return wrapper;
}

type WorkArea = Awaited<ReturnType<typeof mountWorkArea>>;

const documentText = (wrapper: WorkArea) => wrapper.find('[data-testid="document"]').text();

/** Type into the document, as the editor's own update event would. */
const setDocument = async (wrapper: WorkArea, text: string) => {
  await wrapper.findComponent(EditorStub).vm.$emit('update:sparqlCode', text);
  await nextTick();
};

const clickButton = async (wrapper: WorkArea, label: RegExp) => {
  await wrapper.findAll('button').find((button) => label.test(button.text()))!.trigger('click');
  await nextTick();
  await nextTick();
};

/** The Details tab lives in the inspector, which is stubbed; talk to it directly. */
const setTuplesEnabled = async (wrapper: WorkArea, value: boolean) => {
  const inspector = wrapper.findComponent({ name: 'RuleSetInspectorPanel' });
  await inspector.vm.$emit('update:tuplesEnabled', value);
  await nextTick();
};

/*
 * The named tuples are an *input*, so they live in the Inputs tab rather than
 * in a strip above the document. The inspector is stubbed, so the rows go in
 * and come back out through the model the work area binds to it.
 */
const setInlineTuples = async (wrapper: WorkArea, rows: string) => {
  const inspector = wrapper.findComponent({ name: 'RuleSetInspectorPanel' });
  await inspector.vm.$emit('update:inlineTuples', rows);
  await nextTick();
};

const inlineTuples = (wrapper: WorkArea) =>
  wrapper.findComponent({ name: 'RuleSetInspectorPanel' }).props('inlineTuples');

describe('RuleSetWorkArea (draft) — one document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scratch.body = {};
    scratchCollected.value = null;
    toasts.error.length = 0;
    api.executeRulesPlayground.mockResolvedValue({ status: 'converged', iterations: [], dataBlocks: [] });
    api.listDataGraphs.mockResolvedValue([]);
    api.listDataGraphVersions.mockResolvedValue([]);
    api.listTupleSets.mockResolvedValue([]);
    api.listTupleSetVersions.mockResolvedValue([]);
    api.analyzeRuleSetSrl.mockResolvedValue({
      valid: true,
      error: null,
      ruleCount: 1,
      dataBlockCount: 1,
      blocks: [],
      stratification: {
        strata: {}, monotonicity: {}, edges: [], issues: [],
        strataCount: 1, negationCount: 0, stratified: true,
      },
      wellFormedness: [],
    });
  });

  it('opens on one document holding prefixes, DATA and rules', async () => {
    const wrapper = await mountWorkArea();
    const text = documentText(wrapper);
    expect(text).toContain('PREFIX');
    expect(text).toContain('DATA {');
    expect(text).toContain('RULE {');
    // No per-part lists, and nothing to add parts to.
    expect(wrapper.text()).not.toContain('Add Data Block');
    expect(wrapper.text()).not.toContain('Add Rule');
  });

  it('sends the document as a document, for the server to split', async () => {
    const wrapper = await mountWorkArea();
    await setDocument(wrapper, 'PREFIX : <http://x/>\n\nRULE { ?s :q ?o } WHERE { ?s :p ?o }');
    await clickButton(wrapper, /^Run$/);

    expect(api.executeRulesPlayground).toHaveBeenCalledWith(
      expect.objectContaining({
        srl: 'PREFIX : <http://x/>\n\nRULE { ?s :q ?o } WHERE { ?s :p ?o }',
        tuples: false,
      }),
    );
  });

  it('migrates a pre-document scratch record instead of dropping it', async () => {
    scratch.body = {
      dataBlocks: ['PREFIX : <http://x/>\nDATA { :a :p :b }'],
      rules: ['PREFIX : <http://x/>\nRULE { ?s :q ?o } WHERE { ?s :p ?o }'],
    };
    const wrapper = await mountWorkArea();
    const text = documentText(wrapper);
    // Both parts survive, data first.
    expect(text).toContain('DATA { :a :p :b }');
    expect(text).toContain('RULE { ?s :q ?o }');
    expect(text.indexOf('DATA {')).toBeLessThan(text.indexOf('RULE {'));
  });

  it('keeps a stored document exactly as it was written', async () => {
    scratch.body = { srl: '# a comment the author wrote\nPREFIX : <http://x/>\n\nRULE { } WHERE { }' };
    const wrapper = await mountWorkArea();
    expect(documentText(wrapper)).toContain('# a comment the author wrote');
  });

  it('saves by importing the document, not by minting parts itself', async () => {
    api.createRuleSet.mockResolvedValue({ data: { id: 'urn:rs:new' } });
    api.importRuleSetSrl.mockResolvedValue({ ruleSetVersionId: 'urn:rsv:1', version: 1, ruleCount: 1 });

    const wrapper = await mountWorkArea();
    await clickButton(wrapper, /Save/);

    expect(api.createRuleSet).toHaveBeenCalledWith(expect.objectContaining({ isPartOf: ['urn:lib:1'] }));
    expect(api.importRuleSetSrl).toHaveBeenCalledWith(
      'urn:rs:new',
      expect.stringContaining('RULE {'),
      expect.objectContaining({ tuples: false }),
    );
    expect(wrapper.emitted('scratch-saved')?.[0]).toEqual([
      { id: 'urn:rs:new', name: 'Untitled rule set', libraryId: 'urn:lib:1' },
    ]);
  });

  it('keeps the scratch record when saving fails', async () => {
    api.createRuleSet.mockRejectedValue(new Error('nope'));
    const wrapper = await mountWorkArea();
    await clickButton(wrapper, /Save/);
    expect(wrapper.emitted('scratch-saved')).toBeUndefined();
  });
});

describe('RuleSetWorkArea (draft) — rule tuples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scratch.body = {};
    toasts.error.length = 0;
    api.executeRulesPlayground.mockResolvedValue({ status: 'converged', iterations: [], dataBlocks: [] });
    api.listDataGraphs.mockResolvedValue([]);
    api.listDataGraphVersions.mockResolvedValue([]);
    api.listTupleSets.mockResolvedValue([]);
    api.listTupleSetVersions.mockResolvedValue([]);
    api.analyzeRuleSetSrl.mockResolvedValue({
      valid: true,
      error: null,
      ruleCount: 1,
      dataBlockCount: 0,
      blocks: [],
      stratification: {
        strata: {}, monotonicity: {}, edges: [], issues: [],
        strataCount: 1, negationCount: 0, stratified: true,
      },
      wellFormedness: [],
    });
  });

  /*
   * The editor column holds SRL and nothing else. Named tuples are an argument,
   * not definition, so there is no strip above the document to gate on the
   * extension — only the Run with strip naming the selection.
   */
  it('keeps the run inputs out of the editor column', async () => {
    const wrapper = await mountWorkArea();
    expect(wrapper.find('[data-testid="run-bar"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="initial-tuples"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="data-graph"]').exists()).toBe(false);

    await setTuplesEnabled(wrapper, true);
    expect(wrapper.find('[data-testid="initial-tuples"]').exists()).toBe(false);
  });

  it('sends the seed rows and the toggle with the run', async () => {
    const wrapper = await mountWorkArea();
    await setTuplesEnabled(wrapper, true);
    await setInlineTuples(wrapper, 'TUPLE(:reach, :a, :b)');
    await clickButton(wrapper, /^Run$/);

    expect(api.executeRulesPlayground).toHaveBeenCalledWith(
      expect.objectContaining({ tuples: true, tupleSeeds: 'TUPLE(:reach, :a, :b)' }),
    );
  });

  it('restores a workspace that had the extension on', async () => {
    scratch.body = { srl: 'RULE { } WHERE { }', tuplesEnabled: true, tupleSeeds: 'TUPLE(:reach, :a)' };
    const wrapper = await mountWorkArea();
    expect(inlineTuples(wrapper)).toBe('TUPLE(:reach, :a)');
  });

  it('refuses to turn the extension off while tuple content is present', async () => {
    scratch.body = {
      srl: 'PREFIX : <http://x/>\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x) }',
      tuplesEnabled: true,
    };
    const wrapper = await mountWorkArea();
    await setTuplesEnabled(wrapper, false);

    expect(toasts.error.join(' ')).toContain('Remove the tuple rules');
    // Nothing authored was discarded to enforce it.
    expect(documentText(wrapper)).toContain('TUPLE(:rel, ?x)');
  });
});

/*
 * The server refuses a rule set that does not stratify before evaluating
 * anything, so Run is not offered only to report that refusal: it is off, and
 * says why.
 */
describe('RuleSetWorkArea (draft) — a rule set that does not stratify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scratch.body = {};
    toasts.error.length = 0;
    api.executeRulesPlayground.mockResolvedValue({ status: 'converged', iterations: [], dataBlocks: [] });
    api.listDataGraphs.mockResolvedValue([]);
    api.listDataGraphVersions.mockResolvedValue([]);
    api.listTupleSets.mockResolvedValue([]);
    api.listTupleSetVersions.mockResolvedValue([]);
    api.analyzeRuleSetSrl.mockResolvedValue({
      valid: true,
      error: null,
      ruleCount: 1,
      dataBlockCount: 0,
      blocks: [],
      stratification: {
        strata: {}, monotonicity: {}, edges: [], issues: ['Non-stratifiable cycle involving: rule at L3'],
        cycles: [{ kind: 'negation', rules: ['rule-1'], edges: [] }],
        strataCount: 0, negationCount: 1, runOnceCount: 0, stratified: false,
      },
      wellFormedness: [],
    });
  });

  it('disables Run and says why', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountWorkArea();
      await vi.advanceTimersByTimeAsync(500);
      await nextTick();
      const run = wrapper.get('[data-testid="run-bar-run"]');
      expect(run.attributes('disabled')).toBeDefined();
      expect(run.attributes('title')).toMatch(/does not stratify/);
      expect(api.executeRulesPlayground).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
