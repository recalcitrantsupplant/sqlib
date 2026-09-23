import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';

const RULE_SET_A = 'urn:sqlib:rule-set:a';
const RULE_SET_B = 'urn:sqlib:rule-set:b';
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


/*
 * Opening a rule set sends the export route a prologue to abbreviate its rules
 * against. That prologue may come from the document on screen only when it is
 * the same rule set's: carried across a switch, rule set B was rendered with
 * A's prefixes — and a bad-syntax case stored verbatim, PREFIX and all, gained
 * one more PREFIX line every time you clicked between two of them.
 */
const DOCS: Record<string, string> = {
  [RULE_SET_A]: 'PREFIX a: <http://a.example/>\n\nPREFIX :    <http://example/>\nRULE { } WHERE { a :p "abc" }\n',
  [RULE_SET_B]: 'PREFIX b: <http://b.example/>\n\nPREFIX : <http://example/>\nRULE {} WHERE { :s :p :o }\n',
};

const prologueSent = (call: number) =>
  (api.exportRuleSetSrl.mock.calls[call]?.[1] as { prologue?: string } | undefined)?.prologue;

describe('RuleSetWorkArea — the prologue a load is rendered with', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listRuleSetVersions.mockImplementation(async (id: string) => [
      { id: `${id}-v1`, version: 1, immutable: true, comment: null, dateModified: null },
    ]);
    api.exportRuleSetSrl.mockImplementation(async (id: string) => ({
      srl: DOCS[id],
      tupleSeeds: null,
      tuplesEnabled: false,
      warnings: [],
    }));
    api.analyzeRuleSetSrl.mockResolvedValue({ valid: false, error: 'bad', ruleCount: 0, dataBlockCount: 0, blocks: [] });
    api.listDataGraphs.mockResolvedValue([]);
    api.listDataGraphVersions.mockResolvedValue([]);
    api.listTupleSets.mockResolvedValue([]);
    api.listTupleSetVersions.mockResolvedValue([]);
  });

  it('does not carry one rule set\'s prefixes into the next, however often you switch', async () => {
    const wrapper = await mountSaved();

    for (const next of [RULE_SET_B, RULE_SET_A, RULE_SET_B]) {
      await wrapper.setProps({ ruleSetId: next });
      for (let tick = 0; tick < 8; tick += 1) await nextTick();
    }

    const calls = api.exportRuleSetSrl.mock.calls;
    // Loaded in turn (a load may be issued more than once; each is the same).
    expect([...new Set(calls.map((call) => call[0]))]).toEqual([RULE_SET_A, RULE_SET_B]);
    expect(calls[calls.length - 1][0]).toBe(RULE_SET_B);
    // No load is rendered with the other rule set's prefixes, or its own
    // verbatim PREFIX line sent back to be written again.
    for (let call = 0; call < calls.length; call += 1) {
      const prologue = prologueSent(call) ?? '';
      expect(prologue).not.toMatch(/PREFIX (a|b):/);
      expect(prologue.match(/PREFIX/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
    expect(wrapper.find('[data-testid="document"]').text()).toContain('PREFIX b: <http://b.example/>');
  });
});
