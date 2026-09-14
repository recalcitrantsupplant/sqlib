import { describe, it, expect, vi } from 'vitest';
import { nextTick } from 'vue';
import { Position } from '@vue-flow/core';

import {
  buildCanvasNodeData,
  canvasNodeLabel,
  useQueryGroupGraphState,
  LEFT_TO_RIGHT_HANDLES,
} from '../../src/composables/useQueryGroupGraphState';
import { createGraphStateFromExpanded, type GraphNodeState } from '../../src/composables/useQueryGroupGraph';
import { queryVersionInterfaceFromExpanded } from '../../src/composables/queryGroupIoModel';
import {
  IDS,
  OTHER_IDS,
  otherQueryVersionExpanded,
  selectGroupVersionExpanded,
} from '../fixtures/queryGroupCanvasIo';

/**
 * `useQueryGroupGraphState` is the composable that owns the canvas's own
 * state - VueFlow node/edge sync, selection, iriMap merging and the
 * command-delegating mutators - as distinct from `queryGroupCommands`
 * (its own dedicated tests) which decides what mutations are legal.
 */

const loaded = (options?: Parameters<typeof selectGroupVersionExpanded>[0]) =>
  createGraphStateFromExpanded(selectGroupVersionExpanded(options));

const makeGraph = (onSelectionChange?: (selection: unknown) => void) =>
  useQueryGroupGraphState({ initialGraphState: loaded(), onSelectionChange });

const nodeIn = (graph: ReturnType<typeof makeGraph>, id: string) =>
  graph.nodes.value.find(node => node.id === id)!;

const edgeIn = (graph: ReturnType<typeof makeGraph>, id: string) =>
  graph.edges.value.find(edge => edge.id === id)!;

describe('useQueryGroupGraphState: VueFlow conversion', () => {
  it('converts every graph node to a VueFlow node with left-to-right handles', () => {
    const graph = makeGraph();

    expect(graph.nodes.value).toHaveLength(3);
    const start = nodeIn(graph, IDS.startNode);
    expect(start.type).toBe('input');
    expect(start.sourcePosition).toBe(Position.Right);
    expect(start.targetPosition).toBe(Position.Left);
    expect(start).toMatchObject(LEFT_TO_RIGHT_HANDLES);

    const end = nodeIn(graph, IDS.endNode);
    expect(end.type).toBe('output');

    const query = nodeIn(graph, IDS.queryNode);
    expect(query.type).toBe('query-group-node');
    expect(query.data).toMatchObject({
      kind: 'query',
      queryVersionId: IDS.selectVersion,
      // The iriMap names the version, so the node inherits that as its label.
      attachedName: 'City lookup',
    });
  });

  it('converts every graph edge to a query-group-edge with its flow-type label', () => {
    const graph = makeGraph();

    const boundary = edgeIn(graph, IDS.boundaryEdge);
    expect(boundary.type).toBe('query-group-edge');
    expect(boundary.label).toBe('result rows');
    expect(boundary.animated).toBe(false);
    expect(boundary.data).toMatchObject({
      flowType: 'VARIABLE_BINDINGS',
      sourceOutputId: IDS.boundaryTuple,
      targetInputId: IDS.inputTuple,
    });
  });

  it('uses saved canvas positions instead of the computed lane layout', () => {
    const expanded = selectGroupVersionExpanded();
    expanded.queryGroupVersion.canvasData = JSON.stringify({
      nodes: [{ id: IDS.queryNode, position: { x: 999, y: 111 } }],
      viewport: { zoom: 1, panX: 0, panY: 0 },
    });

    const graph = useQueryGroupGraphState({ initialGraphState: createGraphStateFromExpanded(expanded) });

    expect(nodeIn(graph, IDS.queryNode).position).toEqual({ x: 999, y: 111 });
    // A node absent from the saved snapshot still falls back to the lane layout.
    expect(nodeIn(graph, IDS.startNode).position).not.toEqual({ x: 999, y: 111 });
  });

  it('tolerates malformed canvas data instead of throwing', () => {
    const expanded = selectGroupVersionExpanded();
    expanded.queryGroupVersion.canvasData = '{not json';

    expect(() =>
      useQueryGroupGraphState({ initialGraphState: createGraphStateFromExpanded(expanded) }),
    ).not.toThrow();
  });
});

describe('useQueryGroupGraphState: selection', () => {
  it('selecting a node highlights it and clears any edge selection', () => {
    const graph = makeGraph();
    graph.selectEdge(IDS.boundaryEdge);

    graph.selectNode(IDS.queryNode);

    expect(nodeIn(graph, IDS.queryNode).selected).toBe(true);
    expect(nodeIn(graph, IDS.startNode).selected).toBe(false);
    expect(edgeIn(graph, IDS.boundaryEdge).selected).toBe(false);
    expect(graph.selectedCanvasDetail.value).toEqual({ type: 'node', node: expect.objectContaining({ id: IDS.queryNode }) });
  });

  it('selecting an edge highlights it and clears any node selection', () => {
    const graph = makeGraph();
    graph.selectNode(IDS.queryNode);

    graph.selectEdge(IDS.resultEdge);

    expect(edgeIn(graph, IDS.resultEdge).selected).toBe(true);
    expect(nodeIn(graph, IDS.queryNode).selected).toBe(false);
    expect(graph.selectedCanvasDetail.value).toEqual({ type: 'edge', edge: expect.objectContaining({ id: IDS.resultEdge }) });
  });

  it('selecting an IO entity defaults its parent to the currently selected node', () => {
    const graph = makeGraph();
    graph.selectNode(IDS.queryNode);

    graph.selectIoEntity(IDS.inputTuple);

    expect(graph.selectedCanvasDetail.value).toMatchObject({
      type: 'io',
      parentNodeId: IDS.queryNode,
    });
  });

  it('clearSelection drops node, edge and canvas-object selection together', () => {
    const graph = makeGraph();
    graph.selectNode(IDS.queryNode);

    graph.clearSelection();

    expect(graph.selectedCanvasDetail.value).toBeNull();
    expect(nodeIn(graph, IDS.queryNode).selected).toBe(false);
  });

  it('notifies onSelectionChange whenever the selection changes', async () => {
    const onSelectionChange = vi.fn();
    const graph = makeGraph(onSelectionChange);

    graph.selectNode(IDS.queryNode);
    await nextTick();

    expect(onSelectionChange).toHaveBeenCalledWith({ type: 'node', id: IDS.queryNode });
  });

  it('auto-clears the selection once its target is deleted from the graph', async () => {
    const graph = makeGraph();
    graph.selectNode(IDS.queryNode);
    expect(graph.selectedCanvasDetail.value).not.toBeNull();

    graph.deleteNode(IDS.queryNode);
    await nextTick();

    expect(graph.selectedCanvasDetail.value).toBeNull();
  });
});

describe('useQueryGroupGraphState: applyGraphState', () => {
  it('replaces the graph wholesale and clears the prior selection', () => {
    const graph = makeGraph();
    graph.selectNode(IDS.queryNode);

    const next = loaded({ withSecondNode: true });
    graph.applyGraphState(next);

    expect(graph.currentGraphState.value).toEqual(next);
    expect(graph.nodes.value).toHaveLength(4);
    expect(graph.selectedCanvasDetail.value).toBeNull();
  });
});

describe('useQueryGroupGraphState: mergeIriMap', () => {
  it('adds new names and relabels matching query/dynamic nodes', () => {
    const graph = makeGraph();

    graph.mergeIriMap({ [OTHER_IDS.version]: 'Other query' });

    expect(graph.currentGraphState.value.iriMap[OTHER_IDS.version]).toBe('Other query');
    // The existing node points at a different version, so it is untouched.
    expect(nodeIn(graph, IDS.queryNode).data).toMatchObject({ attachedName: 'City lookup' });
  });

  it('renames the card of a node whose query version gained a new name', () => {
    const graph = makeGraph();

    graph.mergeIriMap({ [IDS.selectVersion]: 'Renamed lookup' });

    expect(nodeIn(graph, IDS.queryNode).data).toMatchObject({ label: 'Renamed lookup', attachedName: 'Renamed lookup' });
    /*
     * The node's own label is untouched, and that is the point: it holds the
     * name an *author* gave, so writing the version's name into it made every
     * node look renamed - and overwrote a name somebody had actually typed the
     * next time any response named that version.
     */
    expect(graph.currentGraphState.value.nodes.find(n => n.id === IDS.queryNode)?.label).toBe('');
  });

  it('leaves a name the author typed alone when the query version is renamed', () => {
    const graph = makeGraph();

    graph.updateNodeLabel(IDS.queryNode, 'Step one');
    graph.mergeIriMap({ [IDS.selectVersion]: 'Renamed lookup' });

    expect(graph.currentGraphState.value.nodes.find(n => n.id === IDS.queryNode)?.label).toBe('Step one');
    // The card keeps the author's name; the query's new name is still readable
    // in the node's details.
    expect(nodeIn(graph, IDS.queryNode).data).toMatchObject({ label: 'Step one', attachedName: 'Renamed lookup' });
  });

  it('ignores blank entries and a no-op call', () => {
    const graph = makeGraph();
    const before = graph.currentGraphState.value;

    graph.mergeIriMap({ [OTHER_IDS.version]: '   ' });
    expect(graph.currentGraphState.value).toBe(before);

    graph.mergeIriMap(undefined);
    expect(graph.currentGraphState.value).toBe(before);
  });

  it('is a no-op when every entry already matches', () => {
    const graph = makeGraph();
    graph.mergeIriMap({ [IDS.selectVersion]: 'City lookup' });
    const after = graph.currentGraphState.value;

    graph.mergeIriMap({ [IDS.selectVersion]: 'City lookup' });

    expect(graph.currentGraphState.value).toBe(after);
  });
});

describe('useQueryGroupGraphState: node field updates', () => {
  it('updateNodeLabel updates both the graph state and the VueFlow node data', () => {
    const graph = makeGraph();

    graph.updateNodeLabel(IDS.queryNode, 'Renamed by hand');

    expect(graph.currentGraphState.value.nodes.find(n => n.id === IDS.queryNode)?.label).toBe('Renamed by hand');
    expect(nodeIn(graph, IDS.queryNode).data).toMatchObject({ label: 'Renamed by hand' });
  });

  it('updateNodeBackend normalizes blank input to null', () => {
    const graph = makeGraph();

    graph.updateNodeBackend(IDS.queryNode, '  ');
    expect(graph.currentGraphState.value.nodes.find(n => n.id === IDS.queryNode)?.backendId).toBeNull();

    graph.updateNodeBackend(IDS.queryNode, ' urn:sqlib:backend:2 ');
    expect(graph.currentGraphState.value.nodes.find(n => n.id === IDS.queryNode)?.backendId).toBe('urn:sqlib:backend:2');
  });

  it('updateNodeMediaType trims input and normalizes blank to null', () => {
    const graph = makeGraph();

    graph.updateNodeMediaType(IDS.endNode, '  text/turtle  ');
    expect(graph.currentGraphState.value.nodes.find(n => n.id === IDS.endNode)?.mediaType).toBe('text/turtle');

    graph.updateNodeMediaType(IDS.endNode, '');
    expect(graph.currentGraphState.value.nodes.find(n => n.id === IDS.endNode)?.mediaType).toBeNull();
  });
});

describe('useQueryGroupGraphState: edge field updates and command delegation', () => {
  it('updateEdgeWhenEmpty sets the policy on the graph edge', () => {
    const graph = makeGraph();

    graph.updateEdgeWhenEmpty(IDS.boundaryEdge, 'error');

    expect(graph.currentGraphState.value.edges.find(e => e.id === IDS.boundaryEdge)?.whenEmpty).toBe('error');
  });

  it('updateEdgeVariableMappings accepts a well-formed mapping and rejects a malformed one', () => {
    const graph = makeGraph();

    graph.updateEdgeVariableMappings(IDS.boundaryEdge, '[]');
    expect(graph.currentGraphState.value.edges.find(e => e.id === IDS.boundaryEdge)?.variableMappings).toBe('[]');

    graph.updateEdgeVariableMappings(IDS.boundaryEdge, 'not json');
    // The command refuses unreadable mappings, so the last-good value survives.
    expect(graph.currentGraphState.value.edges.find(e => e.id === IDS.boundaryEdge)?.variableMappings).toBe('[]');
  });

  it('updateEdgeFlowType changes the edge and is reflected in the VueFlow edges', () => {
    const graph = makeGraph();

    graph.updateEdgeFlowType(IDS.boundaryEdge, 'CONTROL_FLOW');

    expect(graph.currentGraphState.value.edges.find(e => e.id === IDS.boundaryEdge)?.flowType).toBe('CONTROL_FLOW');
    expect(edgeIn(graph, IDS.boundaryEdge).animated).toBe(true);
    expect(edgeIn(graph, IDS.boundaryEdge).label).toBe('runs after');
  });

  /*
   * `setEdgeFlowType` refuses a flow type the endpoints cannot carry rather than
   * applying it and reporting the problem, so the outcome has to come back out
   * — as `connectNodes`'s already does. It did not, and the caller had nothing
   * to say: picking QUERY_ID on an edge into an ordinary query node left the
   * edge alone, the picker showing QUERY_ID, and the author none the wiser.
   */
  it('updateEdgeFlowType reports a refusal instead of swallowing it', () => {
    const graph = makeGraph();

    // QUERY_ID may only target a node that chooses its query at run time.
    const refused = graph.updateEdgeFlowType(IDS.boundaryEdge, 'QUERY_ID');

    expect(refused.applied).toBe(false);
    expect(refused.diagnostics.some(entry => entry.level === 'error')).toBe(true);
    expect(refused.diagnostics.map(entry => entry.message).join(' ')).toContain('must target a dynamic node');
    // And the edge is untouched, so the picker has something true to snap to.
    expect(graph.currentGraphState.value.edges.find(e => e.id === IDS.boundaryEdge)?.flowType)
      .toBe('VARIABLE_BINDINGS');

    const applied = graph.updateEdgeFlowType(IDS.boundaryEdge, 'CONTROL_FLOW');
    expect(applied.applied).toBe(true);
  });

  it('updateEdgeSourceOutput and updateEdgeTargetInput clear and rebind endpoints', () => {
    const graph = makeGraph();

    graph.updateEdgeSourceOutput(IDS.resultEdge, null);
    expect(graph.currentGraphState.value.edges.find(e => e.id === IDS.resultEdge)?.sourceOutputId).toBeNull();

    graph.updateEdgeSourceOutput(IDS.resultEdge, IDS.outputTuple);
    expect(graph.currentGraphState.value.edges.find(e => e.id === IDS.resultEdge)?.sourceOutputId).toBe(IDS.outputTuple);

    graph.updateEdgeTargetInput(IDS.boundaryEdge, null);
    expect(graph.currentGraphState.value.edges.find(e => e.id === IDS.boundaryEdge)?.targetInputId).toBeNull();

    graph.updateEdgeTargetInput(IDS.boundaryEdge, IDS.inputTuple);
    expect(graph.currentGraphState.value.edges.find(e => e.id === IDS.boundaryEdge)?.targetInputId).toBe(IDS.inputTuple);
  });

  it('connectNodes surfaces the command result shape, applied and rejected alike', () => {
    const graph = makeGraph();

    const rejected = graph.connectNodes({
      edgeId: IDS.boundaryEdge, // already exists
      sourceId: IDS.startNode,
      targetId: IDS.queryNode,
      flowType: 'CONTROL_FLOW',
    });
    expect(rejected.applied).toBe(false);
    expect(rejected.diagnostics[0].code).toBe('edge-exists');

    graph.duplicateNode(IDS.queryNode, 'urn:sqlib:node:select-copy');
    const connected = graph.connectNodes({
      edgeId: 'urn:sqlib:edge:new',
      sourceId: IDS.startNode,
      targetId: 'urn:sqlib:node:select-copy',
      flowType: 'CONTROL_FLOW',
    });
    expect(connected.applied).toBe(true);
    expect(edgeIn(graph, 'urn:sqlib:edge:new')).toBeDefined();
  });
});

describe('useQueryGroupGraphState: node/edge lifecycle', () => {
  it('deleteNode removes the node, its edges, and clears its selection', () => {
    const graph = makeGraph();
    graph.selectNode(IDS.queryNode);

    const removed = graph.deleteNode(IDS.queryNode);

    expect(removed).toBe(true);
    expect(graph.nodes.value.some(n => n.id === IDS.queryNode)).toBe(false);
    expect(graph.currentGraphState.value.edges).toHaveLength(0);
  });

  it('deleteNode refuses to remove a boundary node', () => {
    const graph = makeGraph();

    expect(graph.deleteNode(IDS.startNode)).toBe(false);
    expect(graph.nodes.value.some(n => n.id === IDS.startNode)).toBe(true);
  });

  it('duplicateNode copies a node with an offset position, a fresh label and no carried-over execution state', () => {
    const graph = makeGraph();
    const original = nodeIn(graph, IDS.queryNode);

    const duplicated = graph.duplicateNode(IDS.queryNode, 'urn:sqlib:node:select-copy');

    expect(duplicated).toBe(true);
    const copy = nodeIn(graph, 'urn:sqlib:node:select-copy');
    expect(copy.position).toEqual({ x: original.position.x + 40, y: original.position.y + 40 });
    expect(copy.selected).toBe(false);
    expect(copy.data).toMatchObject({ execution: null, validation: null });
    /*
     * Named after what the original is *called*, since the original carries no
     * name of its own: "City lookup copy" rather than a second card also
     * reading "City lookup", which is the one thing a duplicate must not be.
     */
    expect(graph.currentGraphState.value.nodes.find(n => n.id === 'urn:sqlib:node:select-copy')?.label).toBe('City lookup copy');
    expect(copy.data).toMatchObject({ label: 'City lookup copy' });
  });

  it('duplicateNode refuses to copy a boundary node', () => {
    const graph = makeGraph();

    expect(graph.duplicateNode(IDS.startNode, 'urn:sqlib:node:copy')).toBe(false);
  });

  it('deleteEdge removes the edge and clears its selection', () => {
    const graph = makeGraph();
    graph.selectEdge(IDS.resultEdge);

    const removed = graph.deleteEdge(IDS.resultEdge);

    expect(removed).toBe(true);
    expect(graph.currentGraphState.value.edges.some(e => e.id === IDS.resultEdge)).toBe(false);
    expect(graph.selectedCanvasDetail.value).toBeNull();
  });

  it('deleteSelected dispatches to the selected node or edge, and does nothing otherwise', () => {
    const graph = makeGraph();

    expect(graph.deleteSelected()).toBe(false);

    graph.selectEdge(IDS.resultEdge);
    expect(graph.deleteSelected()).toBe(true);
    expect(graph.currentGraphState.value.edges.some(e => e.id === IDS.resultEdge)).toBe(false);

    graph.selectNode(IDS.queryNode);
    expect(graph.deleteSelected()).toBe(true);
    expect(graph.nodes.value.some(n => n.id === IDS.queryNode)).toBe(false);
  });

  it('deleteSelected cannot delete an IO entity directly', () => {
    const graph = makeGraph();
    graph.selectNode(IDS.queryNode);
    graph.selectIoEntity(IDS.inputTuple);

    expect(graph.deleteSelected()).toBe(false);
  });
});

describe('useQueryGroupGraphState: canvas snapshot and flat payload', () => {
  it('serializeCanvasSnapshot records every node position under the current viewport', () => {
    const graph = makeGraph();

    const snapshot = JSON.parse(graph.serializeCanvasSnapshot()!);

    expect(snapshot.nodes).toHaveLength(3);
    expect(snapshot.nodes.map((n: { id: string }) => n.id)).toEqual(expect.arrayContaining([IDS.startNode, IDS.queryNode, IDS.endNode]));
    expect(snapshot.viewport).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  /*
   * A node's name has to survive a reload, and the canvas snapshot is where it
   * can: the execution-node contract is `.strict()` and has no field for it, and
   * a display name is the same kind of fact as a position - how this canvas is
   * drawn rather than what the group runs.
   */
  it('serializeCanvasSnapshot carries the names an author typed, and only those', () => {
    const graph = makeGraph();
    graph.updateNodeLabel(IDS.queryNode, '  Step one  ');

    const snapshot = JSON.parse(graph.serializeCanvasSnapshot()!);
    const byId = new Map(snapshot.nodes.map((n: { id: string; label?: string }) => [n.id, n.label]));

    expect(byId.get(IDS.queryNode)).toBe('Step one');
    // Unnamed nodes carry no label, so an old snapshot and an unnamed node read
    // the same. Writing what the node is *called* here would save "City lookup"
    // as a name the author never gave it.
    expect(byId.get(IDS.startNode)).toBeUndefined();
    expect(byId.get(IDS.endNode)).toBeUndefined();
  });

  it('restores the names an author typed from a saved snapshot', () => {
    const expanded = selectGroupVersionExpanded();
    expanded.queryGroupVersion.canvasData = JSON.stringify({
      nodes: [{ id: IDS.queryNode, position: { x: 42, y: 7 }, label: 'Step one' }],
      viewport: { zoom: 1, panX: 0, panY: 0 },
    });
    const graph = useQueryGroupGraphState({ initialGraphState: createGraphStateFromExpanded(expanded) });

    expect(graph.currentGraphState.value.nodes.find(n => n.id === IDS.queryNode)?.label).toBe('Step one');
    expect(nodeIn(graph, IDS.queryNode).data).toMatchObject({ label: 'Step one' });
    // The position in the same entry still applies: the two are read apart, so
    // a snapshot written before labels existed restores exactly as it used to.
    expect(nodeIn(graph, IDS.queryNode).position).toEqual({ x: 42, y: 7 });
  });

  it('survives a snapshot entry whose label is not a string', () => {
    const expanded = selectGroupVersionExpanded();
    expanded.queryGroupVersion.canvasData = JSON.stringify({
      nodes: [{ id: IDS.queryNode, position: { x: 42, y: 7 }, label: 17 }],
      viewport: { zoom: 1, panX: 0, panY: 0 },
    });
    const graph = useQueryGroupGraphState({ initialGraphState: createGraphStateFromExpanded(expanded) });

    expect(graph.currentGraphState.value.nodes.find(n => n.id === IDS.queryNode)?.label).toBe('');
    expect(nodeIn(graph, IDS.queryNode).position).toEqual({ x: 42, y: 7 });
  });

  it('serializeCanvasSnapshot returns null for a graph with no nodes', () => {
    const empty = createGraphStateFromExpanded({
      ...selectGroupVersionExpanded(),
      startNode: null as never,
      executionNodes: [],
      endNode: null as never,
      edges: [],
    });
    const graph = useQueryGroupGraphState({ initialGraphState: empty });

    expect(graph.serializeCanvasSnapshot()).toBeNull();
  });

  it('toFlatPayload reflects the live graph state, not just the initial one', () => {
    const graph = makeGraph();

    graph.updateEdgeWhenEmpty(IDS.boundaryEdge, 'error');
    const payload = graph.toFlatPayload();

    expect(payload.edges.find(e => e.id === IDS.boundaryEdge)?.whenEmpty).toBe('error');
  });
});

describe('useQueryGroupGraphState: query-version resolution', () => {
  it('setNodeQueryVersionResolution accepts a ready status matching the node and its known interface', () => {
    const graph = makeGraph();

    graph.setNodeQueryVersionResolution(IDS.queryNode, { status: 'ready', versionId: IDS.selectVersion });

    expect(graph.currentGraphState.value.nodes.find(n => n.id === IDS.queryNode)?.queryVersionResolution).toEqual({
      status: 'ready',
      versionId: IDS.selectVersion,
    });
  });

  it('setNodeQueryVersionResolution refuses a ready status for a version the node does not reference', () => {
    const graph = makeGraph();
    const before = graph.currentGraphState.value.nodes.find(n => n.id === IDS.queryNode)?.queryVersionResolution;

    graph.setNodeQueryVersionResolution(IDS.queryNode, { status: 'ready', versionId: OTHER_IDS.version });

    expect(graph.currentGraphState.value.nodes.find(n => n.id === IDS.queryNode)?.queryVersionResolution).toEqual(before);
  });

  it('updateNodeIoFromQueryVersion assigns the new interface and marks the node ready', () => {
    const graph = makeGraph();
    const iface = queryVersionInterfaceFromExpanded(otherQueryVersionExpanded())!;

    graph.updateNodeIoFromQueryVersion(IDS.queryNode, otherQueryVersionExpanded());

    const node = graph.currentGraphState.value.nodes.find(n => n.id === IDS.queryNode)!;
    expect(node.queryVersionId).toBe(iface.versionId);
    expect(node.queryVersionResolution).toEqual({ status: 'ready', versionId: iface.versionId });
  });
});

/*
 * The canvas data a node is drawn from.
 *
 * `QueryGroupCanvasNode` defaults a missing `kind` to `query`, which is right
 * for a component reading data it did not build and a trap for the code that
 * builds it: a node kind left out is not an error, it is a node titled
 * "Query Node". A ruleset node added from the toolbar read that way until #379
 * and a dynamic one after it, in both cases until something refreshed the node
 * out of the graph state.
 *
 * The table below is the guard, and it is a table so a fifth node kind cannot
 * be added without either drawing as itself or failing here.
 */
describe('buildCanvasNodeData: every node kind draws as itself', () => {
  const KINDS: GraphNodeState['kind'][] = ['start', 'query', 'dynamic', 'ruleset', 'patch', 'end'];

  it.each(KINDS)('a %s node carries its own kind', (kind) => {
    const data = buildCanvasNodeData({ id: 'urn:ui-temp:node-1', kind, label: '', inputs: [], outputs: [] }, {});

    expect(data.kind).toBe(kind);
  });

  it.each([
    ['query', 'Query Node'],
    ['dynamic', 'Dynamic Query Node'],
    ['ruleset', 'Ruleset Node'],
    ['patch', 'Patch Node'],
    ['start', 'Start'],
    ['end', 'End'],
  ] as const)('an unnamed %s node falls back to "%s"', (kind, expected) => {
    const data = buildCanvasNodeData({ id: 'urn:ui-temp:node-1', kind, label: '', inputs: [], outputs: [] }, {});

    expect(data.label).toBe(expected);
    expect(canvasNodeLabel({ id: 'urn:ui-temp:node-1', kind, label: '  ', inputs: [], outputs: [] }, {})).toBe(expected);
  });

  it("a node's own label wins over every fallback", () => {
    const data = buildCanvasNodeData(
      { id: 'urn:ui-temp:node-1', kind: 'dynamic', label: '  Chosen at run time  ', inputs: [], outputs: [] },
      {},
    );

    expect(data.label).toBe('Chosen at run time');
  });

  /*
   * The reading that makes the line above true. `label` holds the name an author
   * typed and nothing else, so a node nobody has named leaves it empty — and
   * that is the whole difference between a name winning over the attachment and
   * a placeholder hiding it, which is what a label pre-filled with the kind's
   * own name did.
   */
  it("an author's name wins over the query and the rule set a node is attached to", () => {
    const iriMap = { 'urn:version:select': 'City lookup', 'urn:version:rules': 'Postcode rules' };

    expect(
      canvasNodeLabel(
        { id: 'urn:n', kind: 'query', label: 'Step one', queryVersionId: 'urn:version:select', inputs: [], outputs: [] },
        iriMap,
      ),
    ).toBe('Step one');
    expect(
      canvasNodeLabel(
        { id: 'urn:n', kind: 'ruleset', label: 'Step two', ruleSetVersionId: 'urn:version:rules', inputs: [], outputs: [] },
        iriMap,
      ),
    ).toBe('Step two');
  });

  it('a loaded group names no node, so every card follows what it is attached to', () => {
    const loadedState = loaded();

    for (const node of loadedState.nodes) {
      expect(node.label).toBe('');
    }
    // And the card still reads as it always has.
    expect(canvasNodeLabel(loadedState.nodes.find(n => n.id === IDS.queryNode)!, loadedState.iriMap)).toBe('City lookup');
  });

  it('names a query, dynamic or patch node by its query version, and a ruleset node by its rule set', () => {
    const iriMap = { 'urn:version:select': 'City lookup', 'urn:version:rules': 'Postcode rules' };

    for (const kind of ['query', 'dynamic', 'patch'] as const) {
      const data = buildCanvasNodeData(
        { id: 'urn:n', kind, label: '', queryVersionId: 'urn:version:select', inputs: [], outputs: [] },
        iriMap,
      );
      expect(data.attachedName).toBe('City lookup');
      /*
       * The label follows for the two kinds that run the version they name. A
       * dynamic node keeps its kind's name however its `queryVersionId` reads,
       * because the query it runs is the one an edge hands it at run time —
       * naming the node after a version would name it after the wrong query.
       */
      expect(data.label).toBe(kind === 'dynamic' ? 'Dynamic Query Node' : 'City lookup');
    }

    const ruleset = buildCanvasNodeData(
      { id: 'urn:n', kind: 'ruleset', label: '', ruleSetVersionId: 'urn:version:rules', inputs: [], outputs: [] },
      iriMap,
    );
    // A ruleset node's name comes from its rule set version, never from a
    // query version it does not have (#379).
    expect(ruleset.attachedName).toBe('Postcode rules');
    expect(ruleset.ruleSetVersionId).toBe('urn:version:rules');
    expect(ruleset.label).toBe('Postcode rules');
  });

  it('keeps a queryEntityId the graph node has not learned yet', () => {
    const graphNode: GraphNodeState = {
      id: 'urn:n',
      kind: 'query',
      label: 'Query Node',
      queryVersionId: 'urn:version:select',
      inputs: [],
      outputs: [],
    };

    // The graph state learns the entity behind a version lazily, so a refresh
    // that arrives without one must not unname a node that was already named.
    expect(buildCanvasNodeData(graphNode, {}, { queryEntityId: 'urn:query:1' }).queryEntityId).toBe('urn:query:1');
    expect(
      buildCanvasNodeData({ ...graphNode, queryEntityId: 'urn:query:2' }, {}, { queryEntityId: 'urn:query:1' })
        .queryEntityId,
    ).toBe('urn:query:2');
  });
});
