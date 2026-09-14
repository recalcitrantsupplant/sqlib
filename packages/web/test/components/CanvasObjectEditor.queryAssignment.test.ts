import { describe, it, expect } from 'vitest';

import { createGraphStateFromExpanded } from '@/composables/useQueryGroupGraph';
import type { QueryGroupGraphState } from '@/composables/useQueryGroupGraph';
import { IDS, selectGroupVersionExpanded } from '../fixtures/queryGroupCanvasIo';

/**
 * Assigning a query is a dropdown on the node rather than a modal. What that
 * has to get right is the round trip: a node saved with only a query *version*
 * still has to show which query it belongs to, and picking a query has to
 * resolve a version for it without asking a second question.
 */

const QUERY_OPTIONS = [
  {
    id: IDS.selectQuery,
    name: 'Select cities',
    versions: [
      { id: 'urn:sqlib:query-version:select-2', version: 2, isCurrent: true },
      { id: IDS.selectVersion, version: 1, isCurrent: false },
    ],
  },
  {
    id: 'urn:sqlib:query:other',
    name: 'Other query',
    versions: [{ id: 'urn:sqlib:query-version:other-1', version: 1, isCurrent: true }],
  },
];

const DEFAULT_PROPS = {
  validationIssues: [],
  startTuples: [],
  backendOptions: [],
  flowTypeOptions: ['CONTROL_FLOW', 'VARIABLE_BINDINGS', 'RDF_GRAPH', 'BOOLEAN', 'QUERY_ID'],
};

async function mountEditor(state: QueryGroupGraphState, selection: unknown, extraProps: object = {}) {
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
      queryOptions: QUERY_OPTIONS,
      ...extraProps,
    } as never,
    global: { stubs: { Teleport: true } },
  });
}

const setupState = (wrapper: { vm: unknown }) =>
  (wrapper.vm as { $: { setupState: Record<string, unknown> } }).$.setupState;

const loadedState = () => createGraphStateFromExpanded(selectGroupVersionExpanded());
const nodeIn = (state: QueryGroupGraphState, id: string) => state.nodes.find(node => node.id === id)!;

describe('CanvasObjectEditor query assignment', () => {
  it('finds the owning query of a node that only knows its version', async () => {
    const state = loadedState();
    const node = nodeIn(state, IDS.queryNode);
    // A group loaded from the server carries no query id on its nodes.
    expect(node.queryEntityId ?? null).toBeNull();

    const wrapper = await mountEditor(state, { type: 'node', node });

    expect(setupState(wrapper).assignedQueryId).toBe(IDS.selectQuery);
    expect(setupState(wrapper).versionChoices).toEqual([
      { value: 'urn:sqlib:query-version:select-2', label: 'v2 (current)' },
      { value: IDS.selectVersion, label: 'v1' },
    ]);
  });

  it('assigns the current version when a query is picked', async () => {
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'node', node: nodeIn(state, IDS.queryNode) });

    (setupState(wrapper).emitAssignQuery as (id: string) => void)('urn:sqlib:query:other');

    expect(wrapper.emitted('assign-query')?.[0]).toEqual([
      {
        nodeId: IDS.queryNode,
        queryId: 'urn:sqlib:query:other',
        queryVersionId: 'urn:sqlib:query-version:other-1',
      },
    ]);
  });

  it('keeps the query and swaps the version when a version is picked', async () => {
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'node', node: nodeIn(state, IDS.queryNode) });

    (setupState(wrapper).emitAssignQueryVersion as (id: string) => void)('urn:sqlib:query-version:select-2');

    expect(wrapper.emitted('assign-query')?.[0]).toEqual([
      {
        nodeId: IDS.queryNode,
        queryId: IDS.selectQuery,
        queryVersionId: 'urn:sqlib:query-version:select-2',
      },
    ]);
  });

  it('says the library has nothing to assign rather than showing an empty dropdown', async () => {
    const state = loadedState();
    const wrapper = await mountEditor(state, { type: 'node', node: nodeIn(state, IDS.queryNode) }, {
      queryOptions: [],
    });

    expect(wrapper.text()).toContain('no saved query versions');
  });
});
