import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, computed } from 'vue';
import type { TupleDefinition } from '@/types/tuple-editor';
import SearchSelect from '@/components/shared/SearchSelect.vue';

// The panel reaches the API only to export a payload for the Copy action, and
// `useApiClient` pulls in Nuxt auto-imports at module scope. Neither belongs in
// a rendering test.
vi.mock('@/composables/useApiClient', () => ({
  useApiClient: () => ({ exportArgumentSetPayload: vi.fn() }),
}));
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const QueryGroupArgumentsPanel = (
  await import('@/components/query-group/QueryGroupArgumentsPanel.vue')
).default;

/**
 * The group's Arguments tab is the query screen's, over the same composable
 * and the same three components. What is group-shaped is only where the
 * signature comes from — the start node's input tuples rather than detection —
 * so that is what these cover.
 */

/** Enough of `useArgumentSets` for the panel; the composable has its own tests. */
function stubArgumentSets(overrides: Record<string, unknown> = {}) {
  const selection = ref<{ kind: string; id?: string }>({ kind: 'none' });
  return {
    argumentSets: ref([]),
    selection,
    selectedSetId: computed(() => null),
    versionsNewestFirst: ref([]),
    nextVersionNumber: ref(1),
    runTarget: ref({ kind: 'draft' as const }),
    isLoading: ref(false),
    error: ref(null),
    hasDraft: ref(false),
    isScratch: ref(false),
    editCount: ref(0),
    draftSavedAt: ref(null),
    stateLabel: ref(''),
    name: ref(''),
    tupleBindings: ref([]),
    scalarBindings: ref([]),
    graphBindings: ref([]),
    scratchSets: ref([]),
    selectSet: async () => {},
    selectScratch: () => {},
    createScratch: () => null,
    runWith: () => {},
    persistLocal: () => {},
    rename: () => {},
    save: async () => false,
    discard: async () => {},
    deleteSet: async () => false,
    executionArgumentSetId: computed(() => null),
    inlineExecutionPayload: () => null,
    ...overrides,
  };
}

function tuple(...names: string[]): TupleDefinition {
  return { id: names.join('-'), label: names.join(' '), variables: names.map((name) => ({ name })) } as TupleDefinition;
}

function mountPanel(
  startTuples: TupleDefinition[],
  composable = stubArgumentSets(),
  pageParameters: {
    limitParameters?: string[];
    offsetParameters?: string[];
    dataGraphPorts?: Array<{ id: string; label: string }>;
    dataGraphOptions?: Array<{ versionId: string; name: string; version: number; detail: string; graphId: string }>;
  } = {},
) {
  return mount(QueryGroupArgumentsPanel, {
    props: {
      groupId: 'group-1',
      startTuples,
      argumentSetsComposable: composable,
      limitParameters: pageParameters.limitParameters ?? [],
      offsetParameters: pageParameters.offsetParameters ?? [],
      dataGraphPorts: pageParameters.dataGraphPorts ?? [],
      dataGraphOptions: pageParameters.dataGraphOptions ?? [],
    } as never,
    global: { stubs: { Teleport: true } },
  });
}

describe('QueryGroupArgumentsPanel', () => {
  it('says the group takes no arguments when the start node declares none', () => {
    expect(mountPanel([]).text()).toContain('takes no arguments');
  });

  it('asks for a set before showing editors, when the group does have inputs', () => {
    const w = mountPanel([tuple('city')]);
    expect(w.text()).toContain('No argument set open');
    expect(w.findAll('[data-testid="argument-clause"]')).toHaveLength(0);
  });

  it('gives one clause editor per start tuple once a set is open', () => {
    const args = stubArgumentSets({ selection: ref({ kind: 'scratch', id: 's1' }) });
    const w = mountPanel([tuple('city'), tuple('postcode', 'state')], args);
    const clauses = w.findAll('[data-testid="argument-clause"]');
    expect(clauses).toHaveLength(2);
    expect(clauses[1].text()).toContain('postcode');
  });

  it('reports a set whose bindings do not answer the group signature', () => {
    const args = stubArgumentSets({
      selection: ref({ kind: 'scratch', id: 's1' }),
      tupleBindings: ref([{ tupleSignature: 'lat|lon', variables: ['lat', 'lon'], rows: [] }]),
    });
    const w = mountPanel([tuple('city')], args);
    expect(w.find('.signature-verdict--mismatch').exists()).toBe(true);
  });

  it('hands the work area what the composable says should run', () => {
    const args = stubArgumentSets({ executionArgumentSetId: computed(() => 'version-9') });
    const w = mountPanel([tuple('city')], args);
    expect((w.vm as unknown as { getExecutionArgumentSetId: () => string }).getExecutionArgumentSetId()).toBe('version-9');
  });
});

/**
 * LIMIT / OFFSET on a group.
 *
 * The panel used to say outright that "groups name no LIMIT / OFFSET
 * parameters", which was true only because the execute route refused them. A
 * placeholder is named, so a value reaches the member queries declaring that
 * name — and the names come from the version detail, computed server-side as
 * the union of what those members declare, so the fields offered here and the
 * names the route accepts cannot disagree.
 */
describe('QueryGroupArgumentsPanel — numbers', () => {
  it('offers no numbers when the group\'s members declare none', () => {
    const args = stubArgumentSets({ selection: ref({ kind: 'scratch', id: 's1' }) });
    const w = mountPanel([tuple('city')], args);
    expect(w.find('[data-testid="argument-scalars"]').exists()).toBe(false);
  });

  it('offers the names the version reports', () => {
    const args = stubArgumentSets({ selection: ref({ kind: 'scratch', id: 's1' }) });
    const w = mountPanel([tuple('city')], args, { limitParameters: ['10'], offsetParameters: ['30'] });
    expect(w.find('[data-testid="argument-scalars"]').exists()).toBe(true);
  });

  /* A set has to be open first: there is nowhere to put a value otherwise. */
  it('offers nothing before a set is open, even when names exist', () => {
    const w = mountPanel([tuple('city')], stubArgumentSets(), { limitParameters: ['10'] });
    expect(w.find('[data-testid="argument-scalars"]').exists()).toBe(false);
  });
});

/**
 * Data graphs on a group.
 *
 * The group knows its ports; the argument set carries the graphs in the order
 * those ports are declared. So the picker here writes a graph binding on the
 * open set rather than run-local state beside it — which is what lets a group
 * run or test be one pinned object.
 */
describe('QueryGroupArgumentsPanel — data graphs', () => {
  const PORTS = [{ id: 'urn:io:a', label: 'source data' }, { id: 'urn:io:b', label: 'shapes' }];
  const OPTIONS = [
    { versionId: 'urn:dgv:1', name: 'Cities', version: 1, detail: '3 triples, turtle', graphId: 'urn:dg:1' },
    { versionId: 'urn:dgv:2', name: 'Shapes', version: 2, detail: '9 triples, turtle', graphId: 'urn:dg:2' },
  ];

  it('shows no data graph section when the start node declares no graph input', () => {
    const args = stubArgumentSets({ selection: ref({ kind: 'scratch', id: 's1' }) });
    const w = mountPanel([tuple('city')], args, { dataGraphOptions: OPTIONS });
    expect(w.text()).not.toContain('Data graphs');
  });

  it('writes the chosen graph onto the open set, at the port\'s slot', async () => {
    const args = stubArgumentSets({ selection: ref({ kind: 'scratch', id: 's1' }) });
    const w = mountPanel([tuple('city')], args, { dataGraphPorts: PORTS, dataGraphOptions: OPTIONS });

    // The second port, so the first slot has to be held rather than skipped:
    // the group routes by position, and a shifted list would mean a graph
    // reaching the wrong node.
    const selects = w.findAllComponents(SearchSelect);
    await selects[1].vm.$emit('update:modelValue', 'urn:dgv:2');

    expect((args.graphBindings as { value: Array<{ dataGraphVersionId: string | null }> }).value).toEqual([
      { dataGraphVersionId: null },
      { dataGraphVersionId: 'urn:dgv:2' },
    ]);
  });

  it('reads the set back into the ports, so a reopened set shows its graphs', () => {
    const args = stubArgumentSets({
      selection: ref({ kind: 'scratch', id: 's1' }),
      graphBindings: ref([{ dataGraphVersionId: 'urn:dgv:1' }]),
    });
    const w = mountPanel([tuple('city')], args, { dataGraphPorts: PORTS, dataGraphOptions: OPTIONS });

    const selects = w.findAllComponents(SearchSelect);
    expect(selects[0].props('modelValue')).toBe('urn:dgv:1');
    expect(selects[1].props('modelValue')).toBe(null);
  });

  it('drops trailing empties, so a port left open stays open', async () => {
    const args = stubArgumentSets({
      selection: ref({ kind: 'scratch', id: 's1' }),
      graphBindings: ref([{ dataGraphVersionId: 'urn:dgv:1' }, { dataGraphVersionId: 'urn:dgv:2' }]),
    });
    const w = mountPanel([tuple('city')], args, { dataGraphPorts: PORTS, dataGraphOptions: OPTIONS });

    await w.findAllComponents(SearchSelect)[1].vm.$emit('update:modelValue', '');

    expect((args.graphBindings as { value: unknown[] }).value).toEqual([{ dataGraphVersionId: 'urn:dgv:1' }]);
  });

  it('offers the run only the graphs a port was chosen for', async () => {
    const args = stubArgumentSets({
      selection: ref({ kind: 'scratch', id: 's1' }),
      graphBindings: ref([{ dataGraphVersionId: null }, { dataGraphVersionId: 'urn:dgv:2' }]),
    });
    const w = mountPanel([tuple('city')], args, { dataGraphPorts: PORTS, dataGraphOptions: OPTIONS });

    expect((w.vm as unknown as { getInlineDataGraphs: () => unknown[] }).getInlineDataGraphs())
      .toEqual([{ dataGraphVersionId: 'urn:dgv:2' }]);
  });
});
