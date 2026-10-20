import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { EditorState, type Extension } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';

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
 * The Inputs tab's data box holds an RDF graph. It was given the SPARQL
 * grammar, which looked right while highlighting was all a grammar did; once
 * the grammars gained a parse-error linter, a Turtle graph in that box was
 * underlined from its first triple to its end.
 */
const TURTLE = [
  '@prefix : <http://example/> .',
  ':A a :Company ;',
  '  :hasProfit 100, 50 .',
  ':B a :Company ; :hasProfit 200 .',
].join('\n');
const NTRIPLES = '<http://example/A> <http://example/hasProfit> "100" .';

/** The parse errors a document gets under these extensions: what the linter underlines. */
function parseErrors(doc: string, extensions: Extension[]): number {
  const state = EditorState.create({ doc, extensions });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  let errors = 0;
  tree?.iterate({ enter: (node) => { if (node.type.isError) errors += 1; } });
  return errors;
}

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

describe('RuleSetWorkArea — the language of the Inputs data box', () => {
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
    api.listDataGraphs.mockResolvedValue([]);
    api.listDataGraphVersions.mockResolvedValue([]);
    api.listTupleSets.mockResolvedValue([]);
    api.listTupleSetVersions.mockResolvedValue([]);
  });

  const dataBoxExtensions = (wrapper: Awaited<ReturnType<typeof mountSaved>>) =>
    wrapper.findComponent({ name: 'RuleSetInspectorPanel' }).props('inputEditorExtensions') as Extension[];

  it('parses a Turtle graph without a single parse error', async () => {
    const wrapper = await mountSaved();
    const extensions = dataBoxExtensions(wrapper);
    // Guard: a grammar that parsed nothing would also report no errors.
    expect(EditorState.create({ doc: TURTLE, extensions }).facet(EditorState.languageData).length).toBeGreaterThan(0);
    expect(parseErrors(TURTLE, extensions)).toBe(0);
  });

  it('re-parses in the format the picker switches to', async () => {
    const wrapper = await mountSaved();
    wrapper.findComponent({ name: 'RuleSetInspectorPanel' }).vm.$emit('update:dataGraphInlineFormat', 'application/n-triples');
    await nextTick();
    expect(parseErrors(NTRIPLES, dataBoxExtensions(wrapper))).toBe(0);
    // And a Turtle shorthand is now the error it is in N-Triples.
    expect(parseErrors(TURTLE, dataBoxExtensions(wrapper))).toBeGreaterThan(0);
  });
});
