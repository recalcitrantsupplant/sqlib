import { describe, it, expect } from 'vitest';

import { createGraphStateFromExpanded } from '../../src/composables/useQueryGroupGraph';
import { useQueryGroupGraphState } from '../../src/composables/useQueryGroupGraphState';
import { variablesForPort } from '../../src/composables/queryGroupIoModel';
import {
  IDS,
  OTHER_IDS,
  observablePorts,
  otherQueryVersionExpanded,
  selectGroupVersionExpanded,
  selectQueryVersionExpanded,
  unassignedGroupVersionExpanded,
} from '../fixtures/queryGroupCanvasIo';

/**
 * The canvas has two ways to learn what a query node's ports are, and they used
 * to disagree. These tests pin them together: whatever a node looks like after
 * a fresh assignment, it must look the same after a save and reload.
 */

const graphFor = (expanded: ReturnType<typeof unassignedGroupVersionExpanded>) =>
  useQueryGroupGraphState({ initialGraphState: createGraphStateFromExpanded(expanded) });

const nodeIn = (state: { nodes: Array<{ id: string }> }, id: string) =>
  state.nodes.find(node => node.id === id)!;

/** The node's ports plus the variables behind them - what the user can see. */
const observableIo = (
  state: {
    nodes: Array<{ id: string; inputs: Array<{ id: string; entityType: string }>; outputs: Array<{ id: string; entityType: string }> }>;
    ioEntities: Record<string, unknown>;
    tupleMembers: Record<string, unknown>;
    variables: Record<string, unknown>;
  },
  nodeId: string,
) => {
  const node = nodeIn(state as never, nodeId) as never as {
    inputs: Array<{ id: string; entityType: string }>;
    outputs: Array<{ id: string; entityType: string }>;
  };
  const model = {
    entities: state.ioEntities,
    members: state.tupleMembers,
    variables: state.variables,
  } as never;
  return {
    ports: observablePorts(node),
    variables: Object.fromEntries(
      [...node.inputs, ...node.outputs].map(port => [
        port.id,
        variablesForPort(port.id, model)?.map(v => v.variableName) ?? null,
      ]),
    ),
  };
};

describe('assignment and reload produce the same canvas state', () => {
  it('a freshly assigned SELECT node matches the same node after reload', () => {
    const assigned = graphFor(unassignedGroupVersionExpanded());
    assigned.updateNodeIoFromQueryVersion(IDS.queryNode, selectQueryVersionExpanded());

    const reloaded = graphFor(selectGroupVersionExpanded());

    expect(observableIo(assigned.currentGraphState.value, IDS.queryNode)).toEqual(
      observableIo(reloaded.currentGraphState.value, IDS.queryNode),
    );
  });

  it('shows both input and output variables in either case', () => {
    const assigned = graphFor(unassignedGroupVersionExpanded());
    assigned.updateNodeIoFromQueryVersion(IDS.queryNode, selectQueryVersionExpanded());

    for (const state of [assigned.currentGraphState.value, graphFor(selectGroupVersionExpanded()).currentGraphState.value]) {
      const io = observableIo(state, IDS.queryNode);
      expect(io.variables[IDS.inputTuple]).toEqual(['city', 'country']);
      expect(io.variables[IDS.outputTuple]).toEqual(['city', 'pop', 'area']);
    }
  });

  it('marks an assigned node ready, and reports a query version the group never described', () => {
    const assigned = graphFor(unassignedGroupVersionExpanded());
    assigned.updateNodeIoFromQueryVersion(IDS.queryNode, selectQueryVersionExpanded());
    expect(nodeIn(assigned.currentGraphState.value, IDS.queryNode).queryVersionResolution).toEqual({
      status: 'ready',
      versionId: IDS.selectVersion,
    });

    // An incomplete expansion is an error state, not a query with no ports.
    const incomplete = selectGroupVersionExpanded();
    const reloaded = createGraphStateFromExpanded({ ...incomplete, queryVersions: [] } as never);
    expect(nodeIn(reloaded, IDS.queryNode).queryVersionResolution?.status).toBe('error');
  });

  it('recovers the canonical ports of a node whose saved port arrays are empty', () => {
    // The node was saved before the query version declared these tuples, so its
    // own arrays say nothing. The version still owns the interface.
    const stale = graphFor(selectGroupVersionExpanded({ omitNodePorts: true }));
    const fresh = graphFor(selectGroupVersionExpanded());

    expect(observablePorts(nodeIn(stale.currentGraphState.value, IDS.queryNode) as never)).toEqual(
      observablePorts(nodeIn(fresh.currentGraphState.value, IDS.queryNode) as never),
    );
  });

  it('keeps the group boundary tuple owned by the group, with its variables', () => {
    const state = graphFor(selectGroupVersionExpanded()).currentGraphState.value;
    const start = nodeIn(state, IDS.startNode);

    expect(start.outputs.map(port => port.entityType)).toEqual(['QueryInputTuple']);
    expect(state.ioEntities[IDS.boundaryTuple].origin).toBe('query-group');
    expect(
      variablesForPort(IDS.boundaryTuple, {
        entities: state.ioEntities,
        members: state.tupleMembers,
        variables: state.variables,
      })?.map(v => v.variableName),
    ).toEqual(['city']);
  });
});

describe('shared query-version metadata survives a change to one node', () => {
  it('does not remove tuples the other node still uses', () => {
    const graph = graphFor(selectGroupVersionExpanded({ withSecondNode: true }));

    // Reassigning one of the two nodes to the same version used to delete the
    // shared tuples from the store before rebuilding only this node's ports,
    // blanking the other node's inspector.
    graph.updateNodeIoFromQueryVersion(IDS.queryNode, selectQueryVersionExpanded());

    const state = graph.currentGraphState.value;
    expect(state.ioEntities[IDS.inputTuple]).toBeDefined();
    expect(state.ioEntities[IDS.outputTuple]).toBeDefined();
    expect(observablePorts(nodeIn(state, IDS.secondQueryNode) as never)).toEqual({
      inputs: [{ id: IDS.inputTuple, entityType: 'QueryInputTuple' }],
      outputs: [{ id: IDS.outputTuple, entityType: 'QueryOutputTuple' }],
    });
  });

  it('keeps the first version alive for the other node when one node switches away', () => {
    const graph = graphFor(selectGroupVersionExpanded({ withSecondNode: true }));

    graph.updateNodeIoFromQueryVersion(IDS.queryNode, otherQueryVersionExpanded());

    const state = graph.currentGraphState.value;
    // Node A moved to the new version...
    expect(observablePorts(nodeIn(state, IDS.queryNode) as never)).toEqual({
      inputs: [{ id: OTHER_IDS.inputTuple, entityType: 'QueryInputTuple' }],
      outputs: [{ id: OTHER_IDS.outputTuple, entityType: 'QueryOutputTuple' }],
    });
    // ...without taking node B's tuples with it.
    expect(state.ioEntities[IDS.inputTuple]).toBeDefined();
    expect(state.ioEntities[IDS.outputTuple]).toBeDefined();
    expect(observableIo(state, IDS.secondQueryNode).variables[IDS.outputTuple]).toEqual([
      'city',
      'pop',
      'area',
    ]);
  });

  it('leaves both nodes observationally identical after reassigning one', () => {
    const graph = graphFor(selectGroupVersionExpanded({ withSecondNode: true }));
    graph.updateNodeIoFromQueryVersion(IDS.queryNode, selectQueryVersionExpanded());

    const state = graph.currentGraphState.value;
    expect(observableIo(state, IDS.queryNode)).toEqual(observableIo(state, IDS.secondQueryNode));
  });

  it('deleting one node leaves the other node its metadata', () => {
    const graph = graphFor(selectGroupVersionExpanded({ withSecondNode: true }));
    graph.deleteNode(IDS.secondQueryNode);

    const state = graph.currentGraphState.value;
    expect(state.ioEntities[IDS.inputTuple]).toBeDefined();
    expect(observablePorts(nodeIn(state, IDS.queryNode) as never).inputs).toEqual([
      { id: IDS.inputTuple, entityType: 'QueryInputTuple' },
    ]);
  });
});

describe('a save and reload round trip preserves the graph', () => {
  it('round-trips node ports and edge endpoints through the flat payload', () => {
    const graph = graphFor(selectGroupVersionExpanded());
    const payload = graph.toFlatPayload();

    const node = payload.executionNodes.find(entry => entry.id === IDS.queryNode)!;
    expect(node.inputs).toEqual([IDS.inputTuple]);
    expect(node.outputs).toEqual([IDS.outputTuple]);
    expect(payload.startNode?.outputs).toEqual([IDS.boundaryTuple]);

    const boundaryEdge = payload.edges.find(edge => edge.id === IDS.boundaryEdge)!;
    expect(boundaryEdge.sourceOutputId).toBe(IDS.boundaryTuple);
    expect(boundaryEdge.targetInputId).toBe(IDS.inputTuple);
  });
});
