import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';

const RULE_SET_A = 'urn:sqlib:rule-set:a';
const LIBRARY_ID = 'urn:lib:1';

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
    fetchRuleSet: vi.fn(async (id: string) => ({
      ruleSet: { id, name: id, description: null, isPartOf: [LIBRARY_ID], currentVersion: `${id}-v1` },
      ifMatch: null,
    })),
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


/*
 * The Code tab offers both ways the execute route takes a base graph: RDF in
 * the request, or a saved data graph by IRI. Without either, the rules would
 * run on their own data blocks alone, which is what the tab used to show
 * whenever the run bar had no data.
 */
const GRAPH = 'urn:sqlib:data-graph:people';
const GRAPH_VERSION = 'urn:sqlib:data-graph-version:people-2';

const EditorStub = {
  props: ['sparqlCode'],
  emits: ['update:sparqlCode'],
  template: '<div data-testid="document">{{ sparqlCode }}<slot name="footer" /></div>',
};

async function mountSaved() {
  const { mount } = await import('@vue/test-utils');
  const RuleSetWorkArea = (await import('@/components/RuleSetWorkArea.vue')).default;
  const wrapper = mount(RuleSetWorkArea, {
    props: { ruleSetId: RULE_SET_A as string, scratchId: null },
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
  for (let tick = 0; tick < 8; tick += 1) await nextTick();
  return wrapper;
}

type Variant = { id: string; label: string; request: { method: string; url: string; body: Record<string, unknown> } };

describe('RuleSetWorkArea — the Code tab names a base graph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listRuleSetVersions.mockImplementation(async (id: string) => [
      { id: `${id}-v1`, version: 1, immutable: true, comment: null, dateModified: null },
    ]);
    api.exportRuleSetSrl.mockResolvedValue({
      srl: 'PREFIX : <http://example/>\nRULE { ?x :p ?y } WHERE { ?x :q ?y }\n',
      tupleSeeds: null,
      tuplesEnabled: false,
      warnings: [],
    });
    api.analyzeRuleSetSrl.mockResolvedValue({ valid: true, ruleCount: 1, dataBlockCount: 0, blocks: [] });
    api.listDataGraphs.mockResolvedValue([
      { id: GRAPH, name: 'People', isPartOf: [LIBRARY_ID], currentVersion: GRAPH_VERSION },
    ]);
    api.listDataGraphVersions.mockResolvedValue([
      { id: GRAPH_VERSION, version: 2, tripleCount: 3, contentFormat: 'text/turtle' },
    ]);
    api.getDataGraphVersion.mockResolvedValue({ id: GRAPH_VERSION, contentString: '', contentFormat: 'text/turtle' });
    api.listTupleSets.mockResolvedValue([]);
    api.listTupleSetVersions.mockResolvedValue([]);
  });

  const inspector = (wrapper: Awaited<ReturnType<typeof mountSaved>>) =>
    wrapper.findComponent({ name: 'RuleSetInspectorPanel' });
  const variants = (wrapper: Awaited<ReturnType<typeof mountSaved>>) =>
    inspector(wrapper).props('codeVariants') as Variant[];

  it('offers RDF in the request and a saved graph, each with a graph, even when the run bar has none', async () => {
    const wrapper = await mountSaved();
    const [inline, saved] = variants(wrapper);
    expect(inline.id).toBe('inline');
    expect(inline.request.body.dataGraphInline).toMatch(/^# /);
    expect(inline.request.body.dataGraphInlineFormat).toBe('text/turtle');
    expect(saved.id).toBe('saved');
    expect(saved.request.body.dataGraphId).toBe('<data-graph-id>');
    expect(saved.request.body).not.toHaveProperty('dataGraphInline');
    expect(inspector(wrapper).props('codeDefaultVariantId')).toBe('inline');
  });

  it('fills each variant from the run bar, and opens on the one Run uses', async () => {
    const wrapper = await mountSaved();
    inspector(wrapper).vm.$emit('update:dataGraphInline', '<urn:a> <urn:p> <urn:b> .');
    inspector(wrapper).vm.$emit('update:dataGraphInlineFormat', 'application/n-triples');
    await nextTick();
    expect(variants(wrapper)[0].request.body).toMatchObject({
      dataGraphInline: '<urn:a> <urn:p> <urn:b> .',
      dataGraphInlineFormat: 'application/n-triples',
    });

    inspector(wrapper).vm.$emit('update:dataSource', 'saved');
    inspector(wrapper).vm.$emit('update:dataGraphVersionId', GRAPH_VERSION);
    await nextTick();
    expect(variants(wrapper)[1].request.body.dataGraphId).toBe(GRAPH);
    expect(inspector(wrapper).props('codeDefaultVariantId')).toBe('saved');
  });
});
