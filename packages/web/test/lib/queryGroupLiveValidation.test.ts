import { describe, it, expect, vi, afterEach } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

import {
  liveValidationIssues,
  useQueryGroupLiveValidation,
} from '../../src/composables/useQueryGroupLiveValidation';
import { checkInvariants } from '../../src/composables/queryGroupInvariants';
import { createGraphStateFromExpanded } from '../../src/composables/useQueryGroupGraph';
import type { QueryGroupGraphState } from '../../src/composables/useQueryGroupGraph';
import {
  IDS,
  selectGroupVersionExpanded,
  unassignedGroupVersionExpanded,
} from '../fixtures/queryGroupCanvasIo';

const loaded = () => createGraphStateFromExpanded(selectGroupVersionExpanded());
const unassigned = () => createGraphStateFromExpanded(unassignedGroupVersionExpanded());

const codes = (state: QueryGroupGraphState) => liveValidationIssues(state).map(issue => issue.code);

const withNode = (
  state: QueryGroupGraphState,
  nodeId: string,
  patch: Partial<QueryGroupGraphState['nodes'][number]>,
): QueryGroupGraphState => ({
  ...state,
  nodes: state.nodes.map(node => (node.id === nodeId ? { ...node, ...patch } : node)),
});

describe('live query group validation', () => {
  it('says nothing about a group that is fully built', () => {
    expect(liveValidationIssues(loaded())).toEqual([]);
  });

  /**
   * A differing arity is what the edge will do, not a fault in it - the
   * inspector states it on its own line and drops it from the diagnostics for
   * the same reason. The fixture group has one, and is not a warned group.
   */
  it('does not warn about arity, which is descriptive', () => {
    expect(codes(loaded())).not.toContain('mapping-arity-differs');
  });

  it('has nothing to say about no group at all', () => {
    expect(liveValidationIssues(null)).toEqual([]);
  });

  /**
   * The point of the whole exercise: a half-built group is reported while it is
   * being built, where `/validate` could only answer about the last saved one.
   */
  it('reports an execution node that has no query yet', () => {
    const issues = liveValidationIssues(unassigned());
    const query = issues.find(issue => issue.code === 'NODE_QUERY_ID_UNRESOLVABLE');
    expect(query).toBeDefined();
    expect(query?.entityId).toBe(IDS.queryNode);
    // A warning rather than an error: the node was dropped a second ago and
    // assigning its query is the next thing the author was going to do. The run
    // pre-flight still refuses to execute it.
    expect(query?.level).toBe('warning');
  });

  it('reports a node with no backend, and stops once it has one', () => {
    const state = withNode(loaded(), IDS.queryNode, { backendId: null });
    expect(codes(state)).toContain('NODE_BACKEND_UNRESOLVABLE');
    expect(codes(loaded())).not.toContain('NODE_BACKEND_UNRESOLVABLE');
  });

  it('accepts an ephemeral store in place of a backend', () => {
    const state = withNode(loaded(), IDS.queryNode, {
      backendId: null,
      backendConfig: { storeId: 'urn:sqlib:store:1' } as never,
    });
    expect(codes(state)).not.toContain('NODE_BACKEND_UNRESOLVABLE');
  });

  it('calls naming both a backend and an ephemeral store a contradiction', () => {
    const state = withNode(loaded(), IDS.queryNode, {
      backendConfig: { storeId: 'urn:sqlib:store:1' } as never,
    });
    const conflict = liveValidationIssues(state).find(issue => issue.code === 'NODE_BACKEND_CONFLICT');
    expect(conflict?.level).toBe('error');
  });

  it('surfaces a query version that could not be loaded', () => {
    const state = withNode(loaded(), IDS.queryNode, {
      queryVersionResolution: { status: 'error', message: 'Request failed: 404' },
    });
    const failure = liveValidationIssues(state).find(
      issue => issue.code === 'NODE_QUERY_VERSION_UNREADABLE',
    );
    expect(failure?.level).toBe('error');
    expect(failure?.message).toContain('Request failed: 404');
  });

  it('reports an edge that lost a node, against the edge', () => {
    const state = loaded();
    const dangling: QueryGroupGraphState = {
      ...state,
      nodes: state.nodes.filter(node => node.id !== IDS.queryNode),
    };
    const issue = liveValidationIssues(dangling).find(entry => entry.entityId === IDS.boundaryEdge);
    expect(issue?.level).toBe('error');
    expect(issue?.entityType).toBe('edge');
  });

  it('reports a cycle at the graph level, with nothing to highlight', () => {
    const state = loaded();
    const cyclic: QueryGroupGraphState = {
      ...state,
      edges: [
        ...state.edges,
        {
          id: 'urn:sqlib:edge:back',
          source: IDS.queryNode,
          target: IDS.startNode,
          flowType: 'CONTROL_FLOW',
          sourceOutputId: null,
          targetInputId: null,
        },
      ],
    };
    const cycle = liveValidationIssues(cyclic).find(issue => issue.code === 'GRAPH_CYCLE');
    expect(cycle?.entityId).toBeNull();
  });

  /**
   * The two passes answer different questions and must not be confused: the
   * invariants describe states a command should never produce, so a group that
   * is merely half-built satisfies every one of them while live validation has
   * plenty to say about it.
   */
  it('is not the invariant checker', () => {
    const state = unassigned();
    expect(checkInvariants(state)).toEqual([]);
    expect(liveValidationIssues(state).length).toBeGreaterThan(0);
  });

  /**
   * The reactive half: an edit has to reach the badges without anyone asking,
   * which is the whole difference from the button this replaced.
   */
  describe('following the canvas', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('starts from the state it is given, before any edit', () => {
      const scope = effectScope();
      const graphState = ref<QueryGroupGraphState | null>(unassigned());
      const issues = scope.run(() => useQueryGroupLiveValidation({ graphState }).liveIssues)!;
      expect(issues.value.length).toBeGreaterThan(0);
      scope.stop();
    });

    it('re-validates after an edit settles, not on every keystroke of one', async () => {
      vi.useFakeTimers();
      const scope = effectScope();
      const graphState = ref<QueryGroupGraphState | null>(unassigned());
      const issues = scope.run(() => useQueryGroupLiveValidation({ graphState, delayMs: 200 }).liveIssues)!;
      expect(issues.value.length).toBeGreaterThan(0);

      // The command lands: the node now has its query.
      graphState.value = loaded();
      await nextTick();
      // Still the old answer while the edit is settling.
      expect(issues.value.length).toBeGreaterThan(0);

      vi.advanceTimersByTime(200);
      await nextTick();
      expect(issues.value).toEqual([]);
      scope.stop();
    });

    it('stops watching when its scope goes away', async () => {
      vi.useFakeTimers();
      const scope = effectScope();
      const graphState = ref<QueryGroupGraphState | null>(loaded());
      const issues = scope.run(() => useQueryGroupLiveValidation({ graphState, delayMs: 200 }).liveIssues)!;
      scope.stop();

      graphState.value = unassigned();
      vi.advanceTimersByTime(200);
      await nextTick();
      expect(issues.value).toEqual([]);
    });
  });
});
