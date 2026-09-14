import { describe, it, expect } from 'vitest';

import { createGraphStateFromExpanded } from '@/composables/useQueryGroupGraph';
import type { QueryGroupGraphState } from '@/composables/useQueryGroupGraph';
import {
  IDS,
  selectGroupVersionExpanded,
} from '../fixtures/queryGroupCanvasIo';

/**
 * The two visible regressions this panel produced: a query node with a query
 * version and no variables, and an edge with a valid target and no selectable
 * target input. Both looked like empty state, which is also a legal answer -
 * so these assert the difference is visible.
 */

const DEFAULT_PROPS = {
  validationIssues: [],
  startTuples: [],
  backendOptions: [],
  flowTypeOptions: ['CONTROL_FLOW', 'VARIABLE_BINDINGS', 'RDF_GRAPH', 'BOOLEAN', 'QUERY_ID'],
};

async function mountEditor(state: QueryGroupGraphState, selection: unknown) {
  const { mount } = await import('@vue/test-utils');
  const Editor = (await import('@/components/query-group/CanvasObjectEditor.vue')).default;
  return mount(Editor, {
    props: {
      ...DEFAULT_PROPS,
      selection,
      ioEntities: state.ioEntities,
      graphNodes: state.nodes,
      iriMap: state.iriMap,
      tupleMembers: state.tupleMembers,
      variables: state.variables,
    } as never,
    global: { stubs: { Teleport: true } },
  });
}

/**
 * The endpoint dropdowns render their options inside a portal that only opens
 * on interaction, so the options are read from the component's own selector
 * rather than from the DOM. That selector is what the regression was in.
 */
const targetOptions = (wrapper: { vm: unknown }) => {
  const state = (wrapper.vm as { $: { setupState: Record<string, unknown> } }).$.setupState;
  // The setup-state proxy unwraps refs; the raw record does not.
  const options = state.targetMappingOptions as
    | Array<{ id: string; label: string; meta?: string }>
    | { value: Array<{ id: string; label: string; meta?: string }> };
  return Array.isArray(options) ? options : options.value;
};

const loadedState = () => createGraphStateFromExpanded(selectGroupVersionExpanded());
const nodeIn = (state: QueryGroupGraphState, id: string) => state.nodes.find(node => node.id === id)!;
const edgeIn = (state: QueryGroupGraphState, id: string) => state.edges.find(edge => edge.id === id)!;

describe('CanvasObjectEditor node I/O', () => {
  it('renders both input and output variables for a ready query node', async () => {
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'node', node: nodeIn(state, IDS.queryNode) });

    const text = wrapper.text();
    for (const variable of ['?city', '?country', '?pop', '?area']) {
      expect(text).toContain(variable);
    }
    expect(wrapper.find('[data-io-state]').exists()).toBe(false);
  });

  it('tells ready-with-no-ports, loading and error apart', async () => {
    const state = loadedState();
    const bare = { ...nodeIn(state, IDS.queryNode), inputs: [], outputs: [] };

    const ready = await mountEditor(state, {
      type: 'node',
      node: { ...bare, queryVersionResolution: { status: 'ready', versionId: IDS.selectVersion } },
    });
    expect(ready.find('[data-io-state]').attributes('data-io-state')).toBe('empty');
    expect(ready.text()).toContain('declares no inputs or outputs');

    const loading = await mountEditor(state, {
      type: 'node',
      node: { ...bare, queryVersionResolution: { status: 'loading' } },
    });
    expect(loading.find('[data-io-state]').attributes('data-io-state')).toBe('loading');

    const errored = await mountEditor(state, {
      type: 'node',
      node: { ...bare, queryVersionResolution: { status: 'error', message: 'Backend unreachable' } },
    });
    expect(errored.find('[data-io-state]').attributes('data-io-state')).toBe('error');
    expect(errored.text()).toContain('Backend unreachable');
  });

  it('tells an unassigned ruleset node what would give it ports', async () => {
    // A ruleset node has no query version, so both query-shaped answers — the
    // "assign a query version" one and "this query version declares no inputs
    // or outputs" — are about something it does not have. Its ports come from
    // the ruleset.
    const state = loadedState();
    const node = {
      ...nodeIn(state, IDS.queryNode),
      kind: 'ruleset',
      queryId: null,
      queryVersionId: null,
      ruleSetVersionId: null,
      queryVersionResolution: undefined,
      inputs: [],
      outputs: [],
    };

    const wrapper = await mountEditor(state, { type: 'node', node });
    expect(wrapper.find('[data-io-state]').attributes('data-io-state')).toBe('empty');
    expect(wrapper.text()).toContain('Assign a ruleset to give this node its RDF input and output.');
  });

  it('reports a port with no I/O metadata as incomplete rather than as no variables', async () => {
    const state = loadedState();
    const node = {
      ...nodeIn(state, IDS.queryNode),
      inputs: [{ id: 'urn:sqlib:input-tuple:vanished', label: 'gone', entityType: 'Unknown', direction: 'input', resolved: false }],
    };

    const wrapper = await mountEditor(state, { type: 'node', node });
    expect(wrapper.find('[data-io-state]').attributes('data-io-state')).toBe('incomplete');
  });
});

describe('CanvasObjectEditor edge endpoints', () => {
  it('offers the target input tuple for a variable-binding edge after reload', async () => {
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'edge', edge: edgeIn(state, IDS.boundaryEdge) });

    expect(targetOptions(wrapper)).toEqual([
      { id: IDS.inputTuple, label: 'city-country', meta: '2 vars' },
    ]);
  });

  it('keeps a kind-compatible target whose arity differs from the source', async () => {
    // The boundary tuple has one variable and the query input tuple has two.
    // Requiring equal arity removed the only legal target and left the edge
    // inspector with nothing to choose.
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'edge', edge: edgeIn(state, IDS.boundaryEdge) });

    expect(targetOptions(wrapper).map(option => option.id)).toContain(IDS.inputTuple);
    expect(wrapper.find('[data-testid="mapping-arity-warning"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="mapping-arity-warning"]').text()).toMatch(/1 var.*2 vars/);
  });

  it('keeps a target whose arity is unknown, and says the mapping cannot be checked', async () => {
    const state = loadedState();
    const undescribed: QueryGroupGraphState = {
      ...state,
      ioEntities: {
        ...state.ioEntities,
        [IDS.inputTuple]: { ...state.ioEntities[IDS.inputTuple], memberEntries: null, arity: null },
      },
    };

    const wrapper = await mountEditor(undescribed, { type: 'edge', edge: edgeIn(state, IDS.boundaryEdge) });

    expect(targetOptions(wrapper)).toEqual([
      { id: IDS.inputTuple, label: 'city-country', meta: 'arity unknown' },
    ]);
    expect(wrapper.find('[data-testid="mapping-arity-warning"]').text()).toMatch(/cannot be checked/);
  });

  it('raises no arity warning when the arities agree', async () => {
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'edge', edge: edgeIn(state, IDS.resultEdge) });

    expect(wrapper.find('[data-testid="mapping-arity-warning"]').exists()).toBe(false);
  });
});
