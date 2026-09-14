import { computed } from 'vue';
import type {
  QueryGroupVersionExpandedWithIriMap,
  QueryGroupVersionExpanded,
  QueryGroupVersion,
  QueryNode,
} from '@sparql-query-lib/contracts';

/**
 * The per-run store a node reads instead of a registered backend.
 *
 * Derived from the contract rather than restated. This composable used to
 * declare it as `string | null`, mirroring a wire contract that was itself
 * wrong (#294), and nothing could notice the disagreement — which is how a
 * canvas save came to drop the field silently (#301).
 */
type EphemeralBackendConfig = NonNullable<QueryNode['backendConfig']>;
import {
  DATA_FLOW_TYPES,
  IO_COMPATIBILITY,
  type DataFlowType,
} from '@sparql-query-lib/types';
import type { Covers } from './exhaustiveDomain';
import {
  emptyIoModel,
  normalizeIoModel,
  portFor,
  portsForNode,
  queryVersionInterfacesFromGroup,
  type GraphPort,
  type IoEntityRecord,
  type IoModel,
  type QueryVersionInterface,
  type QueryVersionResolution,
  type TupleMemberRecord,
  type VariableRecord,
} from './queryGroupIoModel';

type EdgeFlowType = 'CONTROL_FLOW' | DataFlowType;

type ExecutionNodeEntity = {
  id: string;
  inputs?: string[] | null;
  outputs?: string[] | null;
  queryId?: string | null;
  backendId?: string | null;
  nodeType?: string | null;
  /*
   * `RuleSetNode` belongs here: `toNodeKind` tests for it, the expansion below
   * builds nodes with it, and `ruleSetVersion`/`ruleSetVersionId` are on this
   * very type. Leaving it out made that test unreachable as far as TypeScript
   * was concerned — the `nodeType` half of the same condition is a bare string,
   * so the check still worked at runtime and the declaration simply lied.
   */
  '@type'?: 'QueryNode' | 'DynamicQueryNode' | 'RuleSetNode' | 'PatchNode';
  backendConfig?: EphemeralBackendConfig | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  ruleSetVersion?: string | null;
  ruleSetVersionId?: string | null;
  /**
   * A PatchNode's two output ports, named rather than positional.
   *
   * Which half of a patch a port carries is a property of the node, because an
   * array index is not a contract: reordering `outputs` would otherwise swap
   * deletions for additions with nothing anywhere to notice it.
   */
  deletionsOutput?: string | null;
  additionsOutput?: string | null;
};

type QueryEdgeEntity = {
  id: string;
  sourceNodeId?: string | null;
  targetNodeId?: string | null;
  dataFlowType?: string | null;
  sourceOutputId?: string | null;
  targetInputId?: string | null;
  variableMappings?: string | null;
};

type StartNodeEntity = {
  id: string;
  outputs?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
};

type EndNodeEntity = {
  id: string;
  inputs?: string[] | null;
  mediaType?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
};

type QueryInputTupleEntity = {
  id: string;
  name?: string | null;
  memberEntries?: string[] | null;
};

type QueryOutputTupleEntity = {
  id: string;
  name?: string | null;
  memberEntries?: string[] | null;
};

type TriplesQuadsEntity = {
  id: string;
  name?: string | null;
  description?: string | null;
  outputType?: string | null;
};

type BooleanEntity = {
  id: string;
  name?: string | null;
  description?: string | null;
};

type QueryIdInputEntity = {
  id: string;
  name?: string | null;
  description?: string | null;
};

export type GraphNodeKind = 'start' | 'query' | 'dynamic' | 'ruleset' | 'patch' | 'end';

/** Every `GraphNodeKind`, for enumeration. See `exhaustiveDomain.ts`. */
export const GRAPH_NODE_KINDS = [
  'start',
  'query',
  'dynamic',
  'ruleset',
  'patch',
  'end',
] as const satisfies readonly GraphNodeKind[];
export const _graphNodeKindsCover: Covers<GraphNodeKind, (typeof GRAPH_NODE_KINDS)[number]> = true;

export type GraphNodeState = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  queryId?: string | null;
  queryVersionId?: string | null;
  queryEntityId?: string | null;
  queryType?: string | null; // Query type IRI (e.g., "https://sparql-query-lib/query-type/select")
  queryString?: string | null;
  backendId?: string | null;
  /**
   * The node's ephemeral store, when it has one instead of a backend.
   *
   * Carried through the graph state rather than read straight off the entity
   * because the state is what a save is built from: a field the state does not
   * hold is a field the next "Save v2" drops, however faithfully the read path
   * loaded it (issue #301).
   */
  backendConfig?: EphemeralBackendConfig | null;
  ruleSetId?: string | null;
  ruleSetVersionId?: string | null;
  /**
   * Which of a patch node's outputs carries the quads the update would remove,
   * and which the quads it would add.
   *
   * Held on the node rather than inferred from the order of `outputs` for the
   * reason the entity holds them that way: the two halves are opposite facts
   * and only distinguishable by which port they left through, so a positional
   * convention would silently send deletions where additions were meant.
   */
  deletionsOutputId?: string | null;
  additionsOutputId?: string | null;
  mediaType?: string | null;
  inputs: GraphPort[];
  outputs: GraphPort[];
  /**
   * How far along the node's referenced query version is. Distinguishing these
   * is what lets the inspector say "loading" or "could not load" instead of
   * rendering a query with no ports, which is also a legal state.
   */
  queryVersionResolution?: QueryVersionResolution;
};

export type GraphEdgeState = {
  id: string;
  source: string;
  target: string;
  flowType: EdgeFlowType;
  sourceOutputId?: string | null;
  targetInputId?: string | null;
  variableMappings?: string | null;
  /** Author policy for an input that arrives with no bound rows. */
  whenEmpty?: string | null;
};

export type QueryGroupGraphState = {
  version: QueryGroupVersion;
  nodes: GraphNodeState[];
  edges: GraphEdgeState[];
  ioEntities: Record<string, IoEntityRecord>;
  /** Tuple members and variables, so the inspector can name a tuple's columns. */
  tupleMembers: Record<string, TupleMemberRecord>;
  variables: Record<string, VariableRecord>;
  /** Canonical interfaces of every query version any node references. */
  queryVersionInterfaces: Record<string, QueryVersionInterface>;
  iriMap: Record<string, string>;
};

/** The normalized I/O model held by a graph state, as one value. */
export const ioModelOf = (state: QueryGroupGraphState): IoModel => ({
  entities: state.ioEntities,
  members: state.tupleMembers,
  variables: state.variables,
});

function toNodeKind(node: ExecutionNodeEntity): GraphNodeKind {
  if (node.nodeType === 'RuleSetNode' || node['@type'] === 'RuleSetNode') {
    return 'ruleset';
  }
  /*
   * Read before the query kinds, and never defaulted to: a PatchNode carries a
   * `queryId` like an ordinary query node, so a canvas that did not know the
   * type would load one as a QueryNode and send it back as one — turning a node
   * that only *describes* an update into one that runs it. The server refuses
   * that carry-over (GroupVersionWriter's PatchNode guard); recognising the type
   * here is what stops the canvas from proposing it in the first place.
   */
  if (node.nodeType === 'PatchNode' || node['@type'] === 'PatchNode') {
    return 'patch';
  }
  if (node.nodeType === 'DynamicQueryNode' || node['@type'] === 'DynamicQueryNode') {
    return 'dynamic';
  }
  return 'query';
}

function normalizeFlowType(edge: QueryEdgeEntity): EdgeFlowType {
  const candidate = edge.dataFlowType ?? 'CONTROL_FLOW';
  if (candidate === 'CONTROL_FLOW') {
    return 'CONTROL_FLOW';
  }
  if ((DATA_FLOW_TYPES as readonly string[]).includes(candidate)) {
    return candidate as DataFlowType;
  }
  return 'CONTROL_FLOW';
}

function buildStartNode(start: StartNodeEntity | null | undefined, ioEntities: Record<string, IoEntityRecord>): GraphNodeState | null {
  if (!start) {
    return null;
  }

  // A start node's outputs are the *group's* input tuples - it saves what
  // callers supply. They belong to the group, not to any query version.
  const outputs = (start.outputs ?? []).map((id) => portFor(id, 'output', ioEntities));

  return {
    id: start.id,
    kind: 'start',
    // Structural, and the editor disables its label field, so it never carries
    // an author's name. `canvasNodeLabel` supplies "Start" for the canvas.
    label: '',
    inputs: [],
    outputs,
  };
}

function buildExecutionNodes(
  executionNodes: ExecutionNodeEntity[] | undefined,
  ioEntities: Record<string, IoEntityRecord>,
  queryVersionInterfaces: Record<string, QueryVersionInterface>,
): GraphNodeState[] {
  if (!executionNodes?.length) {
    return [];
  }

  return executionNodes.map((node) => {
    const kind = toNodeKind(node);
    const queryVersionId = node.queryId ?? null;
    const queryVersion = queryVersionId ? queryVersionInterfaces[queryVersionId] ?? null : null;
    const { inputs, outputs } = portsForNode(node, ioEntities, kind === 'ruleset' ? null : queryVersion);

    const ruleSetVersionId = node.ruleSetVersion ?? node.ruleSetVersionId ?? null;

    // A node that names a query version the expansion did not describe is not
    // the same thing as a node whose query has no ports, so say which it is.
    const resolution: QueryVersionResolution =
      kind === 'ruleset' || !queryVersionId
        ? { status: 'unloaded' }
        : queryVersion
          ? { status: 'ready', versionId: queryVersionId }
          : { status: 'error', message: 'The saved group did not describe this query version.' };

    return {
      id: node.id,
      kind,
      /*
       * Empty, because a loaded node has no name of its own until an author
       * gives it one. This used to be filled with the kind's own name ("Query",
       * "Ruleset"), which made `label` unreadable: `canvasNodeLabel` takes a
       * non-empty label to mean "the author named this node", and a field that
       * is never empty cannot say that. Saved labels are applied afterwards from
       * the canvas snapshot, which is where a name the author typed lives.
       */
      label: '',
      queryId: kind === 'ruleset' ? null : queryVersionId,
      queryVersionId: kind === 'ruleset' ? null : queryVersionId,
      queryType: queryVersion?.queryType ?? null,
      queryString: queryVersion?.queryString ?? null,
      ruleSetVersionId: kind === 'ruleset' ? ruleSetVersionId : null,
      ruleSetId: null,
      // A patch node reads a store to work out what its update would change, so
      // it names a backend exactly as a query node does. Only the ruleset node
      // has neither.
      deletionsOutputId: kind === 'patch' ? node.deletionsOutput ?? null : null,
      additionsOutputId: kind === 'patch' ? node.additionsOutput ?? null : null,
      queryEntityId: null,
      backendId: kind === 'ruleset' ? null : (node.backendId ?? null),
      backendConfig: kind === 'ruleset' ? null : (node.backendConfig ?? null),
      inputs,
      outputs,
      queryVersionResolution: resolution,
    };
  });
}

function buildEndNode(end: EndNodeEntity | null | undefined, ioEntities: Record<string, IoEntityRecord>): GraphNodeState | null {
  if (!end) {
    return null;
  }

  const inputs = (end.inputs ?? []).map((id) => portFor(id, 'input', ioEntities));

  return {
    id: end.id,
    kind: 'end',
    // As the start node: structural, unnameable, named by `canvasNodeLabel`.
    label: '',
    mediaType: end.mediaType ?? null,
    inputs,
    outputs: [],
  };
}

function buildEdges(edges: QueryEdgeEntity[] | undefined): GraphEdgeState[] {
  if (!edges?.length) {
    return [];
  }

  return edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId ?? '',
    target: edge.targetNodeId ?? '',
    flowType: normalizeFlowType(edge),
    sourceOutputId: edge.sourceOutputId ?? null,
    targetInputId: edge.targetInputId ?? null,
    variableMappings: edge.variableMappings ?? null,
    whenEmpty: (edge as { whenEmpty?: string | null }).whenEmpty ?? null,
  }));
}

type ExpandedPayload = QueryGroupVersionExpanded | QueryGroupVersionExpandedWithIriMap;

export function createGraphStateFromExpanded(expanded: ExpandedPayload): QueryGroupGraphState {
  // Everything a query version owns is marked as such first, so that what is
  // left over - boundary tuples, author-added RDF ports - is correctly
  // attributed to the group and survives a query-version switch.
  const queryVersionInterfaces = queryVersionInterfacesFromGroup(expanded);
  const queryVersionModel = normalizeIoModel(expanded, 'query-version');
  const groupModel = normalizeIoModel(expanded, 'query-group');

  const ownedByQueryVersion = new Set<string>();
  for (const iface of Object.values(queryVersionInterfaces)) {
    for (const id of [...iface.inputPortIds, ...iface.outputPortIds]) ownedByQueryVersion.add(id);
  }

  const ioEntities: Record<string, IoEntityRecord> = {};
  for (const [id, entity] of Object.entries(groupModel.entities)) {
    ioEntities[id] = ownedByQueryVersion.has(id) ? queryVersionModel.entities[id] ?? entity : entity;
  }
  for (const iface of Object.values(queryVersionInterfaces)) {
    for (const [id, entity] of Object.entries(iface.model.entities)) {
      if (!ioEntities[id]) ioEntities[id] = entity;
    }
  }

  const startNode = buildStartNode(expanded.startNode, ioEntities);
  const executionNodes = buildExecutionNodes(
    expanded.executionNodes as ExecutionNodeEntity[],
    ioEntities,
    queryVersionInterfaces,
  );
  const endNode = buildEndNode(expanded.endNode, ioEntities);
  const edges = buildEdges(expanded.edges as QueryEdgeEntity[]);

  const nodes: GraphNodeState[] = [];

  if (startNode) {
    nodes.push(startNode);
  }
  nodes.push(...executionNodes);
  if (endNode) {
    nodes.push(endNode);
  }

  return {
    version: expanded.queryGroupVersion,
    nodes,
    edges,
    ioEntities,
    tupleMembers: groupModel.members,
    variables: groupModel.variables,
    queryVersionInterfaces,
    iriMap: 'iriMap' in expanded ? expanded.iriMap ?? {} : {},
  };
}

export type FlatGraphPayload = {
  startNode?: {
    id: string;
    outputs: string[];
  };
  executionNodes: Array<
    | {
        id: string;
        nodeType: 'QueryNode' | 'DynamicQueryNode';
        queryId?: string | null;
        backendId: string | null | undefined;
        backendConfig?: EphemeralBackendConfig | null;
        inputs: string[];
        outputs: string[];
      }
    | {
        id: string;
        nodeType: 'RuleSetNode';
        ruleSetVersion?: string | null;
        inputs: string[];
        outputs: string[];
      }
    | {
        id: string;
        nodeType: 'PatchNode';
        queryId?: string | null;
        backendId: string | null | undefined;
        backendConfig?: EphemeralBackendConfig | null;
        inputs: string[];
        outputs: string[];
        deletionsOutput?: string | null;
        additionsOutput?: string | null;
      }
  >;
  endNode?: {
    id: string;
    inputs: string[];
    mediaType?: string | null;
  };
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    dataFlowType: EdgeFlowType;
    sourceOutputId?: string | null;
    targetInputId?: string | null;
    whenEmpty?: string | null;
  }>;
};

function resolveNodeByKind(nodes: GraphNodeState[], kind: GraphNodeKind): GraphNodeState | undefined {
  return nodes.find((node) => node.kind === kind);
}

export function graphStateToFlatPayload(state: QueryGroupGraphState): FlatGraphPayload {
  const start = resolveNodeByKind(state.nodes, 'start');
  const end = resolveNodeByKind(state.nodes, 'end');
  const executionNodes = state.nodes.filter(
    (node) => node.kind === 'query' || node.kind === 'dynamic' || node.kind === 'ruleset' || node.kind === 'patch',
  );

  const resolveQueryVersionId = (node: GraphNodeState): string | null => {
    return node.queryVersionId ?? node.queryId ?? null;
  };

  return {
    startNode: start
      ? {
          id: start.id,
          outputs: start.outputs.map((port) => port.id),
        }
      : undefined,
    executionNodes: executionNodes.map((node) => ({
      ...(node.kind === 'patch'
        ? {
            id: node.id,
            /*
             * Said explicitly, on every save. A patch node carried over as a
             * QueryNode would run the update it exists only to describe, which
             * is why the server refuses the type change outright (#290). The
             * canvas is the client that guard was written about, so this is the
             * line that keeps it honest.
             */
            nodeType: 'PatchNode',
            queryId: resolveQueryVersionId(node),
            ...(node.backendConfig
              ? { backendId: null, backendConfig: node.backendConfig }
              : { backendId: node.backendId }),
            inputs: node.inputs.map((port) => port.id),
            outputs: node.outputs.map((port) => port.id),
            // The writer requires both, requires them to differ, and requires
            // each to be one of the node's own outputs.
            deletionsOutput: node.deletionsOutputId ?? null,
            additionsOutput: node.additionsOutputId ?? null,
          }
        : node.kind === 'ruleset'
        ? {
            id: node.id,
            nodeType: 'RuleSetNode',
            // The wire name, matching the property, the predicate and every
            // read response. `node.ruleSetVersionId` is this composable's own
            // graph-state field, not the payload's.
            ruleSetVersion: node.ruleSetVersionId,
            inputs: node.inputs.map((port) => port.id),
            outputs: node.outputs.map((port) => port.id),
          }
        : {
            id: node.id,
            nodeType: node.kind === 'dynamic' ? 'DynamicQueryNode' : 'QueryNode',
            queryId: resolveQueryVersionId(node),
            // An ephemeral node's config *is* its backend, and the server now
            // rejects a payload naming both (#297). Sending `backendId` beside
            // it would turn every save of an ephemeral group into a 400.
            ...(node.backendConfig
              ? { backendId: null, backendConfig: node.backendConfig }
              : { backendId: node.backendId }),
            inputs: node.inputs.map((port) => port.id),
            outputs: node.outputs.map((port) => port.id),
          }),
    })),
    endNode: end
      ? {
          id: end.id,
          inputs: end.inputs.map((port) => port.id),
          mediaType: end.mediaType ?? null,
        }
      : undefined,
    edges: state.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      dataFlowType: edge.flowType,
      sourceOutputId: edge.sourceOutputId ?? null,
      targetInputId: edge.targetInputId ?? null,
      variableMappings: edge.variableMappings ?? null,
      whenEmpty: edge.whenEmpty ?? null,
    })),
  };
}

export function useQueryGroupGraph(expanded: QueryGroupVersionExpandedWithIriMap) {
  const graphState = computed(() => createGraphStateFromExpanded(expanded));

  return {
    graphState,
    toFlatPayload: () => graphStateToFlatPayload(graphState.value),
  };
}
