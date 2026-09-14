import { ref, computed, watch } from 'vue';
import type { Ref } from 'vue';
import { Position } from '@vue-flow/core';
import type { Node, Edge } from '@vue-flow/core';
import type { QueryVersionExpanded } from '@sparql-query-lib/contracts';
import {
  graphStateToFlatPayload,
  type GraphEdgeState,
  type GraphNodeState,
  type QueryGroupGraphState,
} from './useQueryGroupGraph';
import {
  queryVersionInterfaceFromExpanded,
  type GraphPort,
  type QueryVersionResolution,
} from './queryGroupIoModel';
import * as commands from './queryGroupCommands';
import type { CanvasTemplate } from './canvasTemplates';
import type { CommandResult } from './queryGroupCommands';
import type { Diagnostic } from './queryGroupCompatibility';
import { flowTypeLabel } from './edgeFlowTypeDefaults';
import { authoredNodeLabel, canvasNodeLabel } from './queryGroupNodeLabel';
// Re-exported because this module is where the canvas's own state lives, and
// where every caller already looks for it.
export { authoredNodeLabel, canvasNodeLabel } from './queryGroupNodeLabel';
import type {
  CanvasSelection,
  CanvasSelectionDetail,
  UseQueryGroupGraphStateDeps,
  UseQueryGroupGraphStateResult,
} from './queryGroupTypes';

/**
 * Which side of a node its edges leave and arrive on. VueFlow's built-in input
 * and output nodes default to bottom and top while the query card draws its
 * handles left and right, so leaving it unset gives one canvas two conventions
 * and every edge between them a detour. Start and End are the two built-ins
 * here, so they are exactly the nodes that need saying.
 */
export const LEFT_TO_RIGHT_HANDLES = {
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
} as const;

const DEFAULT_LANE_ORDER: Record<GraphNodeState['kind'], number> = {
  start: 0,
  query: 1,
  dynamic: 1,
  ruleset: 1,
  patch: 1,
  end: 2,
};

const BASE_POSITION = {
  x: 80,
  y: 80,
};

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 180;

type SerializableNode = {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  /*
   * The name the author typed for this node, when they typed one.
   *
   * It rides the canvas snapshot rather than the graph payload because the
   * execution-node contract has no field for it (`executionNodeDraftSchema` is
   * `.strict()`), and because it is the same kind of fact as a node's position:
   * how this canvas is drawn, owned by the editor rather than by the group that
   * runs. Absent for a node nobody has named, so an old snapshot and an unnamed
   * node are the same thing to read back.
   */
  label?: string;
};

type CanvasSnapshot = {
  nodes: SerializableNode[];
  viewport: {
    zoom: number;
    panX: number;
    panY: number;
  };
};

/**
 * VueFlow measures rendered nodes and writes `dimensions` back onto them, but
 * the `Node` type it accepts as *input* has no such field. Reading it needs a
 * narrow cast rather than pretending the input type carries it.
 */
const measuredSize = (node: Node): { width?: number; height?: number } | undefined => {
  const dimensions = (node as Node & { dimensions?: { width?: number; height?: number } }).dimensions;
  if (!dimensions) return undefined;
  return {
    width: typeof dimensions.width === 'number' ? dimensions.width : undefined,
    height: typeof dimensions.height === 'number' ? dimensions.height : undefined,
  };
};

const toVueFlowEdge = (edge: GraphEdgeState, parallelIndex = 0): Edge => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  /*
   * Orthogonal, rounded routing rather than VueFlow's default bezier. The
   * canvas asked for a `variable-bindings` type that was never registered, so
   * every edge fell back to a bezier drawn straight between two handles - which
   * on a ranked layout means a long diagonal that cuts through whatever cards
   * lie between its ends. The step path turns and follows the gaps instead, and
   * fans itself off any edge sharing its two nodes; see QueryGroupCanvasEdge.
   */
  type: 'query-group-edge',
  animated: edge.flowType === 'CONTROL_FLOW',
  // What travels along this edge, readable without selecting it. Reading a graph
  // meant opening the inspector edge by edge, which is a poor trade for a
  // property every edge has and most edges never change.
  label: flowTypeLabel(edge.flowType),
  data: {
    flowType: edge.flowType,
    parallelIndex,
    sourceOutputId: edge.sourceOutputId,
    targetInputId: edge.targetInputId,
    variableMappings: edge.variableMappings,
    showMiniMapping: false,
  },
});

/**
 * Map every edge for the canvas, numbering the ones that join the same pair of
 * nodes so they can be drawn apart from each other.
 */
/**
 * `ref()` typed at vue-flow `Node[]`/`Edge[]`, without asking TypeScript to
 * expand `UnwrapRef<Node[]>` — which past vue 3.5.41's reworked
 * `UnwrapRefSimple` exceeds the instantiation depth limit (TS2589) on this
 * composable's return statement. No runtime change: `ref()` still creates a
 * deeply reactive ref either way.
 */
function deepRef<T>(value: T): Ref<T> {
  return ref(value) as Ref<T>;
}

const toVueFlowEdges = (graphEdges: GraphEdgeState[]): Edge[] => {
  const seenPerPair = new Map<string, number>();
  return graphEdges.map((edge) => {
    const key = `${edge.source}\u0000${edge.target}`;
    const index = seenPerPair.get(key) ?? 0;
    seenPerPair.set(key, index + 1);
    return toVueFlowEdge(edge, index);
  });
};

const normalizeBackendId = (backendId: string | null) => {
  if (!backendId) {
    return null;
  }
  const trimmed = backendId.trim();
  return trimmed.length > 0 ? trimmed : null;
};

type SavedCanvasState = {
  positions: Map<string, { x: number; y: number }>;
  labels: Map<string, string>;
};

/**
 * Parse the canvas snapshot into what it says about each node: where it sits,
 * and what the author named it.
 *
 * Each is read on its own terms, so a snapshot written before labels were in it
 * still restores its positions, and a malformed label does not cost a node its
 * position.
 */
const parseCanvasData = (canvasDataString: string | null | undefined): SavedCanvasState => {
  const saved: SavedCanvasState = { positions: new Map(), labels: new Map() };

  if (!canvasDataString || typeof canvasDataString !== 'string') {
    return saved;
  }

  try {
    const canvasData = JSON.parse(canvasDataString) as CanvasSnapshot;
    if (canvasData?.nodes && Array.isArray(canvasData.nodes)) {
      for (const node of canvasData.nodes) {
        if (!node.id) {
          continue;
        }
        if (node.position && typeof node.position.x === 'number' && typeof node.position.y === 'number') {
          saved.positions.set(node.id, { x: node.position.x, y: node.position.y });
        }
        if (typeof node.label === 'string' && node.label.trim().length > 0) {
          saved.labels.set(node.id, node.label.trim());
        }
      }
    }
  } catch (error) {
    console.warn('[parseCanvasData] Failed to parse canvas data:', error);
  }

  return saved;
};

/**
 * Put the names the author gave back onto the nodes they belong to.
 *
 * The graph state is what the inspector edits and what `canvasNodeLabel` reads,
 * so a restored name has to land there rather than only on the drawn node.
 */
const withSavedLabels = (
  graphState: QueryGroupGraphState,
  labels: Map<string, string>,
): QueryGroupGraphState => {
  if (labels.size === 0) {
    return graphState;
  }
  return {
    ...graphState,
    nodes: graphState.nodes.map((node) => {
      const label = labels.get(node.id);
      return label && !authoredNodeLabel(node) ? { ...node, label } : node;
    }),
  };
};

export function useQueryGroupGraphState(
  deps: UseQueryGroupGraphStateDeps,
): UseQueryGroupGraphStateResult {
  const initialGraphState = deps.initialGraphState;
  const laneOrder = { ...DEFAULT_LANE_ORDER };

  // Saved positions and saved names for the initial state, if it carries any.
  const initialSaved = parseCanvasData(initialGraphState.version?.canvasData);
  const currentGraphState = ref<QueryGroupGraphState>(withSavedLabels(initialGraphState, initialSaved.labels));
  const nodes = deepRef<Node[]>(convertNodesToVueFlow(currentGraphState.value, laneOrder, initialSaved.positions));
  const edges = deepRef<Edge[]>(toVueFlowEdges(currentGraphState.value.edges));

  const selectedNodeId = ref<string | null>(null);
  const selectedEdgeId = ref<string | null>(null);
  const selectedCanvasObject = ref<CanvasSelection>(null);

  const applySelectionHighlight = () => {
    nodes.value = nodes.value.map((node) => ({
      ...node,
      selected: selectedNodeId.value === node.id,
    }));
    edges.value = edges.value.map((edge) => ({
      ...edge,
      selected: selectedEdgeId.value === edge.id,
    }));
  };

  const clearSelection = () => {
    selectedCanvasObject.value = null;
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    applySelectionHighlight();
  };

const selectedCanvasDetail = computed<CanvasSelectionDetail>(() => {
  const selection = selectedCanvasObject.value;
  if (!selection) {
    return null;
  }
    if (selection.type === 'node') {
      const node = currentGraphState.value.nodes.find((entry) => entry.id === selection.id);
      return node ? { type: 'node', node } : null;
    }
    if (selection.type === 'edge') {
      const edge = currentGraphState.value.edges.find((entry) => entry.id === selection.id);
      return edge ? { type: 'edge', edge } : null;
    }
    if (selection.type === 'io') {
      const entity = currentGraphState.value.ioEntities[selection.id];
      if (!entity) {
        return null;
      }
      return {
        type: 'io',
        entity,
        parentNodeId: selection.parentNodeId ?? selectedNodeId.value ?? null,
      };
    }
  return null;
});

watch(selectedCanvasDetail, (detail) => {
  if (!detail && selectedCanvasObject.value) {
    clearSelection();
  }
});

watch(selectedCanvasObject, (selection) => {
  deps.onSelectionChange?.(selection);
});

  const selectNode = (nodeId: string) => {
    selectedNodeId.value = nodeId;
    selectedEdgeId.value = null;
    selectedCanvasObject.value = { type: 'node', id: nodeId };
    applySelectionHighlight();
  };

  const selectEdge = (edgeId: string) => {
    selectedEdgeId.value = edgeId;
    selectedNodeId.value = null;
    selectedCanvasObject.value = { type: 'edge', id: edgeId };
    applySelectionHighlight();
  };

  const selectIoEntity = (entityId: string, parentNodeId?: string | null) => {
    selectedCanvasObject.value = {
      type: 'io',
      id: entityId,
      parentNodeId: parentNodeId ?? selectedNodeId.value ?? null,
    };
  };

  const applyGraphState = (graphState: QueryGroupGraphState) => {
    // Saved canvas positions and node names from canvasData, if it has any.
    const saved = parseCanvasData(graphState.version?.canvasData);
    const named = withSavedLabels(graphState, saved.labels);
    currentGraphState.value = named;
    nodes.value = convertNodesToVueFlow(named, laneOrder, saved.positions);
    edges.value = toVueFlowEdges(graphState.edges);
    clearSelection();
  };

  const refreshVueFlowNodesFromGraph = () => {
    nodes.value = nodes.value.map((node) => {
      const graphNode = currentGraphState.value.nodes.find((entry) => entry.id === node.id);
      if (!graphNode) {
        return node;
      }
      const data = buildCanvasNodeData(
        graphNode,
        currentGraphState.value.iriMap,
        node.data as Partial<CanvasNodeData> | undefined,
      );
      return {
        ...node,
        label: data.label,
        deletable: graphNode.kind !== 'start' && graphNode.kind !== 'end',
        // Spread first: `validation` and `execution` are written onto the node
        // by other composables and are not the graph state's to reproduce.
        data: { ...node.data, ...data },
      };
    });
    applySelectionHighlight();
  };

  const mergeIriMap = (entries?: Record<string, string>) => {
    if (!entries) {
      return;
    }

    const normalizedEntries = Object.entries(entries).filter(([, value]) => typeof value === 'string' && value.trim().length > 0);
    if (!normalizedEntries.length) {
      return;
    }

    const nextIriMap = { ...currentGraphState.value.iriMap };
    let mapChanged = false;

    for (const [key, value] of normalizedEntries) {
      if (nextIriMap[key] === value) {
        continue;
      }
      nextIriMap[key] = value;
      mapChanged = true;
    }

    if (!mapChanged) {
      return;
    }

    /*
     * Only the map moves. This used to write the version's new name over the
     * node's own `label` as well, which is how a name the author typed was lost
     * the next time any response named that version — a rename undone by
     * something the author never did. The canvas follows the rename regardless,
     * because `canvasNodeLabel` reads the name out of the `iriMap` for any node
     * nobody has named.
     */
    currentGraphState.value = {
      ...currentGraphState.value,
      iriMap: nextIriMap,
    };
    refreshVueFlowNodesFromGraph();
  };

  const updateGraphNodeState = (nodeId: string, updater: (node: GraphNodeState) => GraphNodeState) => {
    const existingNodes = currentGraphState.value.nodes;
    if (!existingNodes.some((node) => node.id === nodeId)) {
      return;
    }
    currentGraphState.value = {
      ...currentGraphState.value,
      nodes: existingNodes.map((node) => (node.id === nodeId ? updater(node) : node)),
    };
    refreshVueFlowNodesFromGraph();
  };

  const updateGraphEdges = (updater: (edges: GraphEdgeState[]) => GraphEdgeState[]) => {
    const nextEdges = updater(currentGraphState.value.edges);
    currentGraphState.value = {
      ...currentGraphState.value,
      edges: nextEdges,
    };
    edges.value = toVueFlowEdges(nextEdges);
    applySelectionHighlight();
  };

  /**
   * Run a domain command and adopt its result.
   *
   * The composable's job is to own the ref and keep VueFlow in step; what the
   * graph is allowed to become is decided in `queryGroupCommands`.
   */
  const runCommand = (command: (state: QueryGroupGraphState) => CommandResult): CommandResult => {
    const result = command(currentGraphState.value);
    if (!result.applied) {
      return result;
    }
    const edgesChanged = result.state.edges !== currentGraphState.value.edges;
    currentGraphState.value = result.state;
    if (edgesChanged) {
      edges.value = toVueFlowEdges(result.state.edges);
    }
    refreshVueFlowNodesFromGraph();
    return result;
  };

  /**
   * Mark a node's query-version dependency without changing its ports.
   *
   * The inspector needs to distinguish "still fetching" from "fetched, and this
   * query genuinely has no inputs", and only the caller doing the fetch knows
   * which is which.
   */
  const setNodeQueryVersionResolution = (nodeId: string, resolution: QueryVersionResolution) => {
    runCommand((state) => commands.setNodeQueryVersionResolution(state, nodeId, resolution));
  };

  /**
   * Apply a query version's canonical interface to a node.
   *
   * Goes through the same normalizers as `createGraphStateFromExpanded`, so a
   * node assigned here and the same node after save/reload expose the same
   * ports in the same order.
   */
  const updateNodeIoFromQueryVersion = (nodeId: string, queryVersion: QueryVersionExpanded) => {
    const iface = queryVersionInterfaceFromExpanded(queryVersion);
    if (!iface) {
      setNodeQueryVersionResolution(nodeId, {
        status: 'error',
        message: 'The query version response did not describe a version.',
      });
      return;
    }

    runCommand((state) => commands.assignQueryVersion(state, nodeId, iface));
    // New ports can make a previously impossible endpoint binding unambiguous.
    runCommand((state) => commands.reconcileEdgesForNode(state, nodeId));
  };

  const updateNodeLabel = (nodeId: string, label: string) => {
    updateGraphNodeState(nodeId, (node) => ({
      ...node,
      label,
    }));
  };

  const updateNodeBackend = (nodeId: string, backendId: string | null) => {
    updateGraphNodeState(nodeId, (node) => ({
      ...node,
      backendId: normalizeBackendId(backendId),
    }));
  };

  const updateNodeMediaType = (nodeId: string, mediaType: string | null) => {
    const normalized = mediaType && mediaType.trim().length > 0 ? mediaType.trim() : null;
    updateGraphNodeState(nodeId, (node) => ({
      ...node,
      mediaType: normalized,
    }));
  };

  const updateEdgeWhenEmpty = (edgeId: string, whenEmpty: string | null) => {
    updateGraphEdges((edges) =>
      edges.map((edge) => (edge.id === edgeId ? { ...edge, whenEmpty } : edge)),
    );
  };

  const updateEdgeVariableMappings = (edgeId: string, variableMappings: string | null) => {
    runCommand((state) => commands.setEdgeVariableMappings(state, edgeId, variableMappings));
  };

  /**
   * Connect two nodes.
   *
   * Endpoints bind only when exactly one candidate fits; the returned
   * diagnostics say why an edge came out unresolved so the caller can surface it.
   */
  const connectNodes = (params: {
    edgeId: string;
    sourceId: string;
    targetId: string;
    flowType: GraphEdgeState['flowType'];
  }): { applied: boolean; diagnostics: Diagnostic[] } => {
    const result = runCommand((state) => commands.connectNodes(state, params));
    return { applied: result.applied, diagnostics: result.diagnostics };
  };

  /**
   * Add a query node fed by an existing one.
   *
   * The edge's flow type comes back with the result rather than being asked for,
   * because the command is the thing that recommends it — the caller needs it
   * only to say what happened.
   */
  const addStep = (params: {
    sourceId: string;
    nodeId: string;
    edgeId: string;
    label: string;
  }): { applied: boolean; diagnostics: Diagnostic[]; flowType: GraphEdgeState['flowType'] | null } => {
    const result = runCommand((state) => commands.addStep(state, params));
    return {
      applied: result.applied,
      diagnostics: result.diagnostics,
      flowType: result.state.edges.find((edge) => edge.id === params.edgeId)?.flowType ?? null,
    };
  };

  /**
   * Start the group from one of `canvasTemplates.ts`'s shapes.
   *
   * The minted steps come back with the result rather than being looked up
   * afterwards: the caller has to draw each of them, and matching ids to
   * template steps a second time outside the command is how the two would
   * drift.
   */
  const applyTemplate = (params: {
    template: CanvasTemplate;
    nodeIds: readonly string[];
    edgeIds: readonly string[];
  }): { applied: boolean; diagnostics: Diagnostic[]; steps: GraphNodeState[] } => {
    const result = runCommand((state) => commands.applyTemplate(state, params));
    return {
      applied: result.applied,
      diagnostics: result.diagnostics,
      steps: result.applied
        ? params.nodeIds
            .map((id) => result.state.nodes.find((node) => node.id === id))
            .filter((node): node is GraphNodeState => node !== undefined)
        : [],
    };
  };

  /**
   * `setEdgeFlowType` refuses a flow type these endpoints cannot carry, so the
   * outcome is returned rather than dropped: a caller that ignores it leaves the
   * author staring at a picker showing the type they chose and an edge that
   * never took it.
   */
  const updateEdgeFlowType = (
    edgeId: string,
    flowType: GraphEdgeState['flowType'],
  ): { applied: boolean; diagnostics: Diagnostic[] } => {
    const result = runCommand((state) => commands.setEdgeFlowType(state, edgeId, flowType));
    return { applied: result.applied, diagnostics: result.diagnostics };
  };

  const updateEdgeSourceOutput = (edgeId: string, sourceOutputId: string | null) => {
    runCommand((state) =>
      sourceOutputId === null
        ? commands.clearEdgeSource(state, edgeId)
        : commands.bindEdgeSource(state, edgeId, sourceOutputId),
    );
  };

  const updateEdgeTargetInput = (edgeId: string, targetInputId: string | null) => {
    runCommand((state) =>
      targetInputId === null
        ? commands.clearEdgeTarget(state, edgeId)
        : commands.bindEdgeTarget(state, edgeId, targetInputId),
    );
  };

  const deleteNode = (nodeId: string): boolean => {
    const result = runCommand((state) => commands.deleteNode(state, nodeId));
    if (!result.applied) {
      return false;
    }

    nodes.value = nodes.value.filter((n) => n.id !== nodeId);

    if (selectedNodeId.value === nodeId) {
      clearSelection();
    }
    return true;
  };

  /**
   * Copy a node, keeping what it runs and dropping how it is wired.
   *
   * Ports are deliberately shared rather than cloned: an input or output tuple
   * belongs to the QueryVersion, not to the node, and several nodes referencing
   * the same tuple is the normal case (two nodes consuming one upstream output).
   * Cloning them would mint entities the query version does not know about.
   *
   * Edges are not copied. A duplicate that arrived pre-wired would be asserting
   * an intent the author has not expressed - the reason to duplicate a node is
   * usually to send it somewhere else.
   */
  const duplicateNode = (nodeId: string, newNodeId: string): boolean => {
    const source = currentGraphState.value.nodes.find((n) => n.id === nodeId);
    if (!source || source.kind === 'start' || source.kind === 'end') {
      return false;
    }

    /*
     * The copy is named after what the original is *called*, not after the
     * original's own label, which is empty for a node nobody has named. Two
     * cards reading "City lookup" would be the one thing a duplicate must not
     * be: indistinguishable from what it was copied from.
     */
    const copy: GraphNodeState = {
      ...source,
      id: newNodeId,
      label: `${canvasNodeLabel(source, currentGraphState.value.iriMap)} copy`,
      inputs: [...source.inputs],
      outputs: [...source.outputs],
    };

    currentGraphState.value = {
      ...currentGraphState.value,
      nodes: [...currentGraphState.value.nodes, copy],
    };

    const canvasNode = nodes.value.find((n) => n.id === nodeId);
    const position = canvasNode?.position ?? { x: 300, y: 80 };
    // A copy is never spawned selected, even if the original (spread below) was.
    const newCanvasNode = {
      ...canvasNode,
      id: newNodeId,
      // Offset so the copy is visible instead of landing exactly on the original.
      position: { x: position.x + 40, y: position.y + 40 },
      label: copy.label,
      deletable: true,
      selected: false,
      data: {
        ...((canvasNode?.data as Record<string, unknown>) ?? {}),
        label: copy.label,
        // A copy has not run; carrying the original's result over would be a lie.
        execution: null,
        validation: null,
      },
    };
    nodes.value.push(newCanvasNode);

    return true;
  };

  const deleteEdge = (edgeId: string): boolean => {
    const result = runCommand((state) => commands.deleteEdge(state, edgeId));
    if (!result.applied) {
      return false;
    }

    if (selectedEdgeId.value === edgeId) {
      clearSelection();
    }
    return true;
  };

  const deleteSelected = (): boolean => {
    const selection = selectedCanvasObject.value;

    if (!selection) {
      return false;
    }

    if (selection.type === 'node') {
      return deleteNode(selection.id);
    }

    if (selection.type === 'edge') {
      return deleteEdge(selection.id);
    }

    // Cannot delete I/O entities directly
    return false;
  };

  const serializeCanvasSnapshot = (): string | null => {
    if (nodes.value.length === 0) {
      return null;
    }
    // Read off the graph state rather than off `node.data.label`, which holds
    // what the node is called — the query's name for an unnamed node, which is
    // not a name to save.
    const authored = new Map(
      currentGraphState.value.nodes.flatMap((node) => {
        const label = authoredNodeLabel(node);
        return label ? [[node.id, label] as const] : [];
      }),
    );
    const snapshot: CanvasSnapshot = {
      nodes: nodes.value.map((node) => ({
        id: node.id,
        position: {
          x: node.position?.x ?? 0,
          y: node.position?.y ?? 0,
        },
        width: measuredSize(node)?.width,
        height: measuredSize(node)?.height,
        label: authored.get(node.id),
      })),
      viewport: {
        zoom: 1,
        panX: 0,
        panY: 0,
      },
    };
    return JSON.stringify(snapshot);
  };

  const toFlatPayload = () => graphStateToFlatPayload(currentGraphState.value);

  return {
    currentGraphState,
    nodes,
    edges,
    selectedCanvasDetail,
    selectNode,
    selectEdge,
    selectIoEntity,
    clearSelection,
    applyGraphState,
    updateGraphNodeState,
    updateGraphEdges,
    toFlatPayload,
    serializeCanvasSnapshot,
    updateNodeLabel,
    updateNodeBackend,
    updateNodeMediaType,
    updateNodeIoFromQueryVersion,
    setNodeQueryVersionResolution,
    connectNodes,
    addStep,
    applyTemplate,
    updateEdgeFlowType,
    updateEdgeWhenEmpty,
    updateEdgeVariableMappings,
    updateEdgeSourceOutput,
    updateEdgeTargetInput,
    deleteNode,
    duplicateNode,
    deleteEdge,
    deleteSelected,
    initialGraphState,
    mergeIriMap,
  };
}

/**
 * What the canvas needs to draw one node, as one value.
 *
 * `kind` is required, and that is the whole point of the type existing. The
 * canvas node component defaults a missing `kind` to `query` — a sane default
 * for a component reading data it did not build, and a trap for the code that
 * builds it. Six places did, each by hand, so every node kind had to be
 * remembered at every one, and forgetting produced a node titled "Query Node"
 * rather than an error: that is what a ruleset node read until #379, and what
 * the toolbar's dynamic node data has said ever since (harmlessly, as it turns
 * out — see `drawAddedNode` in `QueryGroupWorkArea.vue`).
 *
 * Deriving the data from the `GraphNodeState` instead makes the two agree by
 * construction, and makes a missing field a type error rather than a label that
 * reads plausibly and is wrong.
 */
export type CanvasNodeData = {
  kind: GraphNodeState['kind'];
  label: string;
  attachedName: string | null;
  backendId: string | null;
  queryId: string | null;
  queryVersionId: string | null;
  queryEntityId: string | null;
  ruleSetVersionId: string | null;
  queryString: string | null;
  mediaType: string | null;
  inputs: GraphPort[];
  outputs: GraphPort[];
};

/**
 * Build a canvas node's `data` from the graph node it draws.
 *
 * `previous` is the data the canvas node already carries, and is consulted for
 * one field only: `queryEntityId` survives a refresh that arrives without one,
 * because the graph state learns the entity behind a version lazily and losing
 * it would unname a node that was already named.
 */
export function buildCanvasNodeData(
  graphNode: GraphNodeState,
  iriMap: Record<string, string>,
  previous?: Partial<CanvasNodeData> | null,
): CanvasNodeData {
  const queryVersionId = graphNode.queryVersionId ?? graphNode.queryId ?? null;
  // A patch node is named by its update query version, like a query node.
  const lookupId = graphNode.kind === 'ruleset' ? graphNode.ruleSetVersionId : queryVersionId;

  return {
    kind: graphNode.kind,
    label: canvasNodeLabel(graphNode, iriMap),
    attachedName: lookupId ? iriMap[lookupId] ?? null : null,
    backendId: graphNode.backendId ?? null,
    queryId: queryVersionId,
    queryVersionId,
    queryEntityId: graphNode.queryEntityId ?? previous?.queryEntityId ?? null,
    ruleSetVersionId: graphNode.ruleSetVersionId ?? null,
    queryString: graphNode.queryString ?? null,
    mediaType: graphNode.mediaType ?? null,
    inputs: graphNode.inputs,
    outputs: graphNode.outputs,
  };
}

function convertNodesToVueFlow(
  graphState: QueryGroupGraphState,
  laneOrder: Record<GraphNodeState['kind'], number>,
  savedPositions?: Map<string, { x: number; y: number }>,
): Node[] {
  const laneCounters: Record<number, number> = {};

  return graphState.nodes.map((graphNode) => {
    const lane = laneOrder[graphNode.kind] ?? 1;
    const index = laneCounters[lane] ?? 0;
    laneCounters[lane] = index + 1;

    // Use saved position if available, otherwise calculate default position
    const savedPosition = savedPositions?.get(graphNode.id);
    const position = savedPosition ?? {
      x: BASE_POSITION.x + lane * COLUMN_WIDTH,
      y: BASE_POSITION.y + index * ROW_HEIGHT,
    };

    const nodeType =
      graphNode.kind === 'start'
        ? 'input'
        : graphNode.kind === 'end'
        ? 'output'
        : 'query-group-node';

    const data = buildCanvasNodeData(graphNode, graphState.iriMap);

    return {
      id: graphNode.id,
      type: nodeType,
      position,
      ...LEFT_TO_RIGHT_HANDLES,
      label: data.label,
      deletable: graphNode.kind !== 'start' && graphNode.kind !== 'end',
      data,
    };
  });
}
