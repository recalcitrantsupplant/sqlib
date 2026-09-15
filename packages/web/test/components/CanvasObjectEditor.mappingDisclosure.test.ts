import { describe, it, expect } from 'vitest';

import { createGraphStateFromExpanded } from '@/composables/useQueryGroupGraph';
import type { QueryGroupGraphState } from '@/composables/useQueryGroupGraph';
import { IDS, selectGroupVersionExpanded } from '../fixtures/queryGroupCanvasIo';

/**
 * The positional mapping grid is collapsed by default, so everything that used
 * to be answered by looking at it has to be answered by the one row that is
 * still visible: what each target variable is fed, and whether that is all
 * right. These assert both halves of that bargain - the summary tells the
 * truth, and a closed grid never hides a reason.
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

const loadedState = () => createGraphStateFromExpanded(selectGroupVersionExpanded());
const edgeIn = (state: QueryGroupGraphState, id: string) => state.edges.find(edge => edge.id === id)!;

const summary = (wrapper: { find: (s: string) => { exists: () => boolean; text: () => string; attributes: (a?: string) => string | undefined } }) =>
  wrapper.find('[data-testid="mapping-summary"]');
const summaryLine = (wrapper: { find: (s: string) => { text: () => string } }) =>
  wrapper.find('[data-testid="mapping-summary-line"]').text();

describe('CanvasObjectEditor variable mapping disclosure', () => {
  it('collapses the grid and says on one line what it would have shown', async () => {
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'edge', edge: edgeIn(state, IDS.resultEdge) });

    // The grid, and the selects that are the bulk of it, are not rendered.
    expect(wrapper.find('#variable-mapping-details').exists()).toBe(false);
    expect(wrapper.findAll('.mapping-select')).toHaveLength(0);

    expect(summaryLine(wrapper)).toBe('?city ?pop ?area → ?city ?pop ?area');
    expect(summary(wrapper).attributes('data-mapping-state')).toBe('ok');
    expect(summary(wrapper).text()).toContain('mapped');
  });

  it('opens the positional grid on request, and closes it again', async () => {
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'edge', edge: edgeIn(state, IDS.resultEdge) });

    expect(summary(wrapper).attributes('aria-expanded')).toBe('false');

    await wrapper.find('[data-testid="mapping-summary"]').trigger('click');
    expect(wrapper.find('#variable-mapping-details').exists()).toBe(true);
    // One select per target variable: the mapping is editable once it is open.
    expect(wrapper.findAll('.mapping-select')).toHaveLength(3);
    expect(summary(wrapper).attributes('aria-expanded')).toBe('true');

    await wrapper.find('[data-testid="mapping-summary"]').trigger('click');
    expect(wrapper.find('#variable-mapping-details').exists()).toBe(false);
    expect(summary(wrapper).attributes('aria-expanded')).toBe('false');
  });

  it('points the summary at the region it opens', async () => {
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'edge', edge: edgeIn(state, IDS.resultEdge) });

    await wrapper.find('[data-testid="mapping-summary"]').trigger('click');
    expect(summary(wrapper).attributes('aria-controls')).toBe('variable-mapping-details');
    expect(wrapper.find('#variable-mapping-details').exists()).toBe(true);
  });

  it('names a target variable nothing feeds, rather than leaving it to the grid', async () => {
    // The boundary tuple has one variable and the query input tuple takes two,
    // so ?country is left unbound. That is the fact a collapsed grid would
    // otherwise swallow.
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'edge', edge: edgeIn(state, IDS.boundaryEdge) });

    expect(summaryLine(wrapper)).toBe('?city UNDEF → ?city ?country');
    expect(summary(wrapper).attributes('data-mapping-state')).toBe('warning');
    expect(summary(wrapper).text()).toContain('1 warning');
  });

  it('keeps the reasons readable while the grid is closed', async () => {
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'edge', edge: edgeIn(state, IDS.boundaryEdge) });

    expect(wrapper.find('#variable-mapping-details').exists()).toBe(false);
    expect(wrapper.find('[data-testid="mapping-arity-warning"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="mapping-arity-warning"]').text()).toMatch(/1 var.*2 vars/);
  });

  it('reports a mapping the source cannot satisfy as a problem, not a warning', async () => {
    const state = loadedState();
    const edge = {
      ...edgeIn(state, IDS.resultEdge),
      variableMappings: JSON.stringify([{ source: 'nope', target: 'city' }]),
    };

    const wrapper = await mountEditor(state, { type: 'edge', edge });

    expect(summary(wrapper).attributes('data-mapping-state')).toBe('error');
    expect(summary(wrapper).text()).toContain('1 problem');
    // The summary shows the mapping as configured, so the bad source is visible
    // without opening anything.
    expect(summaryLine(wrapper)).toBe('?nope ?pop ?area → ?city ?pop ?area');
    expect(wrapper.find('[data-testid="edge-diagnostic"]').text()).toContain('?nope');
  });
});
