/**
 * The Arguments tab of the query inspector.
 *
 * Two things it has to get right when the query declares no parameters: say so,
 * and say how to declare one — parameters live in the query text, so there is
 * nothing in this panel to click. The pop-out sits on the set switcher, beside
 * the ⋮ that acts on the set, rather than in the inspector's tab strip, which
 * is shared with Details and Code.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import QueryResultsPanel from '@/components/query-work-area/QueryResultsPanel.vue';

vi.mock('@/composables/useApiClient', () => ({
  useApiClient: () => ({}),
}));

/* `testSubject` answers with a ref; there is no test subject in these mounts. */
const computedNull = ref(null);

vi.mock('@/composables/useTestsSurface', () => ({
  useTestsSurface: () => ({ testSubject: () => computedNull }),
}));

/** Enough of `useArgumentSets` for the panel to render its Arguments tab. */
function argumentSetsStub() {
  return {
    argumentSets: ref([]),
    selection: ref({ kind: 'none' }),
    selectedSetId: ref(null),
    versions: ref([]),
    versionsNewestFirst: ref([]),
    nextVersionNumber: ref(1),
    runTarget: ref({ kind: 'draft' }),
    isLoading: ref(false),
    hasDraft: ref(false),
    isScratch: ref(false),
    editCount: ref(0),
    draftSavedAt: ref(null),
    stateLabel: ref(''),
    name: ref(''),
    tupleBindings: ref([]),
    scalarBindings: ref([]),
    scratchSets: computed(() => []),
    selectScratch: vi.fn(),
    createScratch: vi.fn(),
    selectSet: vi.fn(),
    runWith: vi.fn(),
    rename: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    deleteSet: vi.fn(),
    persistLocal: vi.fn(),
    loadArgumentSets: vi.fn(),
    loadVersions: vi.fn(),
    executionArgumentSetId: computed(() => null),
    inlineExecutionPayload: computed(() => null),
    visibleValuesPayload: () => null,
    currentSet: ref(null),
    selectedVersionId: ref(null),
    selectedVersion: ref(null),
    currentVersion: ref(null),
    currentVersionId: ref(null),
    scratchId: ref(null),
    localRecord: ref(null),
    graphBindings: ref([]),
    description: ref(''),
    hydrating: ref(false),
    error: ref(null),
  } as never;
}

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(QueryResultsPanel, {
    props: {
      result: null,
      resultsOverlayActive: false,
      resultsOverlayMessage: '',
      argumentsOverlayActive: false,
      argumentsOverlayMessage: '',
      isNewQuery: false,
      queryLoading: false,
      activeTab: 'arguments',
      detectedInputs: null,
      detectedOutputs: [],
      validationState: 'valid',
      queryId: 'query:1',
      queryText: 'SELECT * WHERE { ?s ?p ?o }',
      argumentSetsComposable: argumentSetsStub(),
      ...overrides,
    },
  });
}

describe('QueryResultsPanel arguments tab', () => {
  it('says how to declare a parameter when the query declares none', () => {
    const wrapper = mountPanel();
    const hint = wrapper.get('[data-testid="arguments-parameter-hint"]');

    expect(hint.text()).toContain('To add arguments, add a VALUES clause with an all-UNDEF block.');
    expect(hint.get('a').attributes('href')).toBe(
      'https://github.com/recalcitrantsupplant/sqlib/blob/main/docs/concepts.md#parameters',
    );
    expect(hint.get('a').attributes('target')).toBe('_blank');
  });

  it('carries the pop-out on the set switcher, not in the tab strip', async () => {
    const wrapper = mountPanel();

    // The strip's action slot is where this button used to be.
    expect(wrapper.find('.tabs-header [data-testid="arguments-expand"]').exists()).toBe(false);

    await wrapper.get('[data-testid="arguments-expand"]').trigger('click');
    expect(wrapper.emitted('request-focus')?.[0]).toEqual(['arguments']);
  });

  it('withdraws the pop-out while the query is running', () => {
    const wrapper = mountPanel({ queryLoading: true });
    expect(wrapper.find('[data-testid="arguments-expand"]').exists()).toBe(false);
  });
});
