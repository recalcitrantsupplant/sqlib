/**
 * Graph mutations as domain commands.
 *
 * UI emits like "update-edge-target-input" describe a widget, not behaviour.
 * Each function here states a precondition, produces a new state, and returns
 * diagnostics instead of failing silently - a command that could not do what
 * was asked used to return the state unchanged and say nothing, which on the
 * canvas is indistinguishable from having worked.
 *
 * Everything is pure, so these can be tested without mounting VueFlow, and a
 * generated sequence of them can be checked against the invariants.
 */

import type { QueryGroupGraphState, GraphEdgeState, GraphNodeState } from './useQueryGroupGraph';
import { ioModelOf } from './useQueryGroupGraph';
import {
  mergeIoModels,
  portsForNode,
  pruneUnreferencedEntities,
  type QueryVersionInterface,
  type QueryVersionResolution,
} from './queryGroupIoModel';
import {
  checkEndpoint,
  checkNodeKinds,
  isEndNodePassThrough,
  parseVariableMappings,
  resolveEndpoints,
  validateVariableMappings,
  wouldCreateCycle,
  type Diagnostic,
  type EdgeFlowType,
} from './queryGroupCompatibility';
import { recommendFlowType } from './edgeFlowTypeDefaults';
import type { CanvasTemplate } from './canvasTemplates';

export type CommandResult = {
  state: QueryGroupGraphState;
  diagnostics: Diagnostic[];
  /** False when a precondition failed and nothing changed. */
  applied: boolean;
};

const unchanged = (state: QueryGroupGraphState, code: string, message: string): CommandResult => ({
  state,
  diagnostics: [{ level: 'error', code, message }],
  applied: false,
});

const nodeById = (state: QueryGroupGraphState, id: string) => state.nodes.find(node => node.id === id);
const edgeById = (state: QueryGroupGraphState, id: string) => state.edges.find(edge => edge.id === id);

const withEdges = (state: QueryGroupGraphState, edges: GraphEdgeState[]): QueryGroupGraphState => ({ ...state, edges });

/** Every port id the graph still points at, from nodes and from edge endpoints. */
function referencedPortIds(state: QueryGroupGraphState): Set<string> {
  const referenced = new Set<string>();
  for (const node of state.nodes) {
    for (const port of [...node.inputs, ...node.outputs]) referenced.add(port.id);
  }
  for (const edge of state.edges) {
    if (edge.sourceOutputId) referenced.add(edge.sourceOutputId);
    if (edge.targetInputId) referenced.add(edge.targetInputId);
  }
  return referenced;
}

/**
 * Point a node at a query version and adopt that version's canonical interface.
 *
 * Ports the group declared on the node are kept; ports the *previous* version
 * contributed are dropped, but only once the new port set is known and only if
 * nothing else still references them.
 */
export function assignQueryVersion(
  state: QueryGroupGraphState,
  nodeId: string,
  iface: QueryVersionInterface,
): CommandResult {
  const node = nodeById(state, nodeId);
  if (!node) return unchanged(state, 'node-missing', `No node ${nodeId} on the canvas.`);
  /*
   * A patch node takes one too: it names the update whose effect it derives.
   * Its two RDF ports are the group's, not the version's, so `retained` below
   * keeps them across an assignment the way it keeps any author-added port —
   * which is what lets an author change which update a wired-up node describes
   * without redrawing the edges that carry its halves.
   */
  if (node.kind !== 'query' && node.kind !== 'dynamic' && node.kind !== 'patch') {
    return unchanged(state, 'node-kind', `A ${node.kind} node does not take a query version.`);
  }

  const retained = (ports: GraphNodeState['inputs']) =>
    ports.filter(port => port.origin === 'query-group' || port.origin === 'synthetic').map(port => port.id);

  const merged = mergeIoModels(ioModelOf(state), iface.model);
  const { inputs, outputs } = portsForNode(
    { inputs: retained(node.inputs), outputs: retained(node.outputs) },
    merged.entities,
    iface,
  );

  const nodes = state.nodes.map(entry =>
    entry.id === nodeId
      ? {
          ...entry,
          queryId: iface.versionId,
          queryVersionId: iface.versionId,
          queryType: iface.queryType,
          queryString: iface.queryString,
          inputs,
          outputs,
          queryVersionResolution: { status: 'ready', versionId: iface.versionId } as QueryVersionResolution,
        }
      : entry,
  );

  const next: QueryGroupGraphState = {
    ...state,
    nodes,
    ioEntities: merged.entities,
    tupleMembers: merged.members,
    variables: merged.variables,
    queryVersionInterfaces: { ...state.queryVersionInterfaces, [iface.versionId]: iface },
  };

  // Edges attached to this node were bound to the *previous* version's ports,
  // which the node no longer has. Re-resolving them here rather than leaving it
  // to the caller means the state this command returns is always renderable.
  const reconciled = reconcileEdgesForNode(next, nodeId);

  return {
    state: {
      ...reconciled.state,
      ioEntities: pruneUnreferencedEntities(reconciled.state.ioEntities, referencedPortIds(reconciled.state)),
    },
    diagnostics: reconciled.diagnostics,
    applied: true,
  };
}

/**
 * Record how far along a node's query version is.
 *
 * Only `ready` makes a claim that can be wrong. The in-flight statuses are set
 * precisely when a node's query reference and its loaded interface legitimately
 * disagree - `useQueryGroupExecution` points the node at a new version, then
 * sets `loading` while it fetches - so they are accepted unconditionally.
 * `ready` asserts the interface is present and describes *this* node's version,
 * and nothing else in the state records that, so an unchecked `ready` was a
 * desync no invariant could see.
 */
export function setNodeQueryVersionResolution(
  state: QueryGroupGraphState,
  nodeId: string,
  resolution: QueryVersionResolution,
): CommandResult {
  const node = nodeById(state, nodeId);
  if (!node) return unchanged(state, 'node-missing', `No node ${nodeId} on the canvas.`);

  if (resolution.status === 'ready') {
    const referenced = node.queryVersionId ?? node.queryId ?? null;
    if (resolution.versionId !== referenced) {
      return unchanged(
        state,
        'resolution-version-mismatch',
        `Node ${nodeId} references ${referenced ?? 'no query version'}, so it cannot be ready for ${resolution.versionId}.`,
      );
    }
    if (!state.queryVersionInterfaces[resolution.versionId]) {
      return unchanged(
        state,
        'resolution-interface-missing',
        `Query version ${resolution.versionId} is not described, so node ${nodeId} cannot be ready.`,
      );
    }
  }

  return {
    state: {
      ...state,
      nodes: state.nodes.map(node => (node.id === nodeId ? { ...node, queryVersionResolution: resolution } : node)),
    },
    diagnostics: [],
    applied: true,
  };
}

/**
 * Create one edge, binding endpoints only where the choice is unambiguous.
 *
 * An edge with nothing bound is a legal draft; leaving it visibly unresolved is
 * better than binding the first candidate and calling it the author's intent.
 */
export function connectNodes(
  state: QueryGroupGraphState,
  params: { edgeId: string; sourceId: string; targetId: string; flowType: EdgeFlowType },
): CommandResult {
  const sourceNode = nodeById(state, params.sourceId);
  const targetNode = nodeById(state, params.targetId);
  if (!sourceNode || !targetNode) {
    return unchanged(state, 'node-missing', 'Both ends of a connection must be nodes on the canvas.');
  }
  if (edgeById(state, params.edgeId)) {
    return unchanged(state, 'edge-exists', `Edge ${params.edgeId} already exists.`);
  }
  const diagnostics = checkNodeKinds(params.flowType, sourceNode, targetNode);
  if (diagnostics.some(entry => entry.level === 'error')) {
    return { state, diagnostics, applied: false };
  }

  // After the kind rules, not before: "End nodes cannot have outgoing edges" is
  // the specific, actionable reason, and in a graph that already has an edge
  // *into* the End node it is also a cycle. Reporting the incidental
  // consequence in place of the actual rule tells the author less.
  if (wouldCreateCycle(state.edges, params.sourceId, params.targetId)) {
    return unchanged(
      state,
      'graph-cycle',
      params.sourceId === params.targetId
        ? `${sourceNode.label || sourceNode.id} cannot feed itself.`
        : `${targetNode.label || targetNode.id} already feeds ${sourceNode.label || sourceNode.id}, so this would make a loop.`,
    );
  }

  const resolution = resolveEndpoints(
    { flowType: params.flowType, sourceOutputId: null, targetInputId: null },
    sourceNode,
    targetNode,
    params.flowType,
  );

  const edge: GraphEdgeState = {
    id: params.edgeId,
    source: params.sourceId,
    target: params.targetId,
    flowType: params.flowType,
    sourceOutputId: resolution.sourceOutputId,
    targetInputId: resolution.targetInputId,
    variableMappings: null,
    whenEmpty: null,
  };

  return {
    state: withEdges(state, [...state.edges, edge]),
    diagnostics: [...diagnostics, ...resolution.diagnostics],
    applied: true,
  };
}

/**
 * Add a query node fed by one already on the canvas, as a single act.
 *
 * Most chains are linear, and building one out of the generic parts is four
 * moves — add a node, find where it landed, drag from one handle to the other,
 * then answer whatever the connection could not decide. This is that as one
 * button, and it is one command rather than two calls because a step is the
 * *pair*: a node the author did not ask for, left behind by a connection that
 * was then refused, is worse than nothing having happened. So the node exists
 * only in the state the connection is asked about, and reaches the canvas only
 * if it applied.
 *
 * The flow type is recommended in here rather than passed in, because only this
 * function has the node it just minted to recommend against. That recommendation
 * is nearly always the low-confidence fallback, and that is the honest answer
 * rather than a shortcoming: a step with no query yet has no query type, and the
 * table keys on exactly that. The Start node is the one source that decides —
 * what it emits is the group's own inputs, whatever the step turns out to run.
 * Which of the two happened is on the edge for the caller to name, so a
 * `CONTROL_FLOW` step is stated rather than discovered later.
 *
 * A recommendation the target's own kind forbids is downgraded to control flow
 * rather than followed into a refusal — see the note at the downgrade.
 */
export function addStep(
  state: QueryGroupGraphState,
  params: { sourceId: string; nodeId: string; edgeId: string; label: string },
): CommandResult {
  const sourceNode = nodeById(state, params.sourceId);
  if (!sourceNode) {
    return unchanged(state, 'node-missing', `No node ${params.sourceId} on the canvas.`);
  }
  if (nodeById(state, params.nodeId)) {
    return unchanged(state, 'node-exists', `Node ${params.nodeId} already exists.`);
  }

  const step: GraphNodeState = {
    id: params.nodeId,
    kind: 'query',
    label: params.label,
    queryId: null,
    queryVersionId: null,
    queryEntityId: null,
    backendId: null,
    inputs: [],
    outputs: [],
  };

  const recommendation = recommendFlowType(sourceNode, step);

  /*
   * The recommender answers about a pair of nodes in general; this command
   * knows its target is a query node with no store. A ruleset or patch source
   * is recommended RDF_GRAPH, and nothing SPARQL-shaped can read an RDF graph
   * from another node (`rdf-graph-target-cannot-consume`) — so following the
   * recommendation there would make the button dead on exactly two node kinds.
   *
   * Control flow is not a fallback guess in that case, it is the only edge the
   * pair can legally carry, and it is also what the author meant: "the next
   * step runs after this ruleset". The downgrade is stated rather than silent,
   * because the recommendation the author might have expected is the one that
   * did not happen.
   */
  const refusedByKind = checkNodeKinds(recommendation.defaultFlowType, sourceNode, step).some(
    entry => entry.level === 'error',
  );
  const downgraded = refusedByKind && recommendation.defaultFlowType !== 'CONTROL_FLOW';
  const flowType: EdgeFlowType = downgraded ? 'CONTROL_FLOW' : recommendation.defaultFlowType;

  const connected = connectNodes(
    { ...state, nodes: [...state.nodes, step] },
    { edgeId: params.edgeId, sourceId: params.sourceId, targetId: params.nodeId, flowType },
  );

  // Both or neither. `connectNodes` states the actual rule that was broken —
  // "End nodes cannot have outgoing edges" rather than "a step cannot go there"
  // — so its diagnostics are passed through rather than restated.
  if (!connected.applied) {
    return { state, diagnostics: connected.diagnostics, applied: false };
  }

  // The flow type that was taken needs no diagnostic — the caller has the edge
  // and `flowTypeLabel` names it. What wants saying is the one the author might
  // have expected and did not get, and the recommendation's own warnings, which
  // are about the flow type it named and so go with it when it was not taken.
  const notes: Diagnostic[] = downgraded
    ? [
        {
          level: 'warning',
          code: 'step-flow-type-downgraded',
          message: `A query node cannot read what a ${sourceNode.kind} node emits, so this step runs after it rather than taking its output.`,
        },
      ]
    : (recommendation.warnings ?? []).map(message => ({
        level: 'warning' as const,
        code: 'step-recommendation',
        message,
      }));

  return {
    state: connected.state,
    diagnostics: [...notes, ...connected.diagnostics],
    applied: true,
  };
}

/**
 * The endpoint warnings a freshly applied template cannot avoid.
 *
 * Every step it mints has no query, therefore no ports, so `resolveEndpoints`
 * has nothing to bind on either end of every edge. Repeating that once per
 * endpoint - ten lines for the fan-in - tells the author nothing except that
 * the thing they just asked for is the thing that happened. `-ambiguous` is a
 * different animal and is kept: it means a real choice is waiting, which only
 * happens when the Start node already carries the group's input tuples.
 */
const TEMPLATE_UNBOUND_CODES = new Set(['source-none', 'target-none']);

/**
 * Start a group from one of the shapes in `canvasTemplates.ts`.
 *
 * The other half of the guided empty state (§5). "Add your first query" answers
 * what to do next; a template answers what the group is going to look like,
 * which is the question a blank canvas asks that a node palette cannot.
 *
 * Applying one is a single act for the reason `addStep` is - a shape is its
 * nodes *and* its edges, and a template whose last edge was refused would leave
 * the author holding boxes they did not ask for and now have to delete. So the
 * whole shape is built against a candidate state and reaches the canvas only if
 * every edge applied.
 *
 * Ids come in rather than being minted here, because the command is pure and
 * the canvas is what knows which ids are free. They are checked: a caller that
 * passes too few, or reuses one, gets a refusal rather than a template missing
 * a step.
 *
 * **A template only starts a group.** Applying one to a canvas that already has
 * execution nodes is refused, not merged: every template wires Start to End, so
 * merging would silently give the group a second parallel branch - a legal
 * shape, and not one anybody clicks a *starting* shape to get. The affordance
 * lives in the empty state, so this is a precondition the UI cannot reach; it
 * is checked anyway, because a command that is only correct where its one
 * caller is careful is a command with an undocumented precondition.
 */
export function applyTemplate(
  state: QueryGroupGraphState,
  params: { template: CanvasTemplate; nodeIds: readonly string[]; edgeIds: readonly string[] },
): CommandResult {
  const { template, nodeIds, edgeIds } = params;

  const startNode = state.nodes.find(node => node.kind === 'start');
  const endNode = state.nodes.find(node => node.kind === 'end');
  if (!startNode || !endNode) {
    return unchanged(
      state,
      'template-boundary-missing',
      'A template wires the group from its Start node to its End node, and this canvas is missing one of them.',
    );
  }

  if (state.nodes.some(node => node.kind !== 'start' && node.kind !== 'end')) {
    return unchanged(
      state,
      'template-canvas-not-empty',
      'A template is a starting shape, so it applies to an empty canvas only. Use "Add step" to extend the group you have.',
    );
  }

  if (nodeIds.length !== template.steps.length || edgeIds.length !== template.edges.length) {
    return unchanged(
      state,
      'template-id-count',
      `The ${template.label} template needs ${template.steps.length} node ids and ${template.edges.length} edge ids, and was given ${nodeIds.length} and ${edgeIds.length}.`,
    );
  }

  const taken = new Set([...state.nodes.map(node => node.id), ...state.edges.map(edge => edge.id)]);
  const minted = [...nodeIds, ...edgeIds];
  if (new Set(minted).size !== minted.length || minted.some(id => taken.has(id))) {
    return unchanged(state, 'template-id-collision', 'The ids for this template are not all new and distinct.');
  }

  const idForStep = new Map(template.steps.map((step, index) => [step.key, nodeIds[index]]));
  if (idForStep.size !== template.steps.length) {
    // Two steps under one key are two nodes an edge list can only name once, so
    // one of them would be minted and wired to nothing - the half-built shape
    // this command exists to rule out, arriving through the catalogue rather
    // than through a refused edge.
    return unchanged(
      state,
      'template-step-keys-duplicated',
      `The ${template.label} template gives two steps the same name, so one of them cannot be wired.`,
    );
  }

  const steps: GraphNodeState[] = template.steps.map((step, index) => ({
    id: nodeIds[index],
    kind: step.kind,
    label: step.label,
    inputs: [],
    outputs: [],
    ...(step.kind === 'ruleset'
      ? { ruleSetId: null, ruleSetVersionId: null }
      : { queryId: null, queryVersionId: null, queryEntityId: null, backendId: null }),
  }));

  const nodeIdFor = (key: string): string | undefined =>
    key === 'start' ? startNode.id : key === 'end' ? endNode.id : idForStep.get(key);

  let candidate: QueryGroupGraphState = { ...state, nodes: [...state.nodes, ...steps] };
  const diagnostics: Diagnostic[] = [];

  for (const [index, edge] of template.edges.entries()) {
    const sourceId = nodeIdFor(edge.from);
    const targetId = nodeIdFor(edge.to);
    if (!sourceId || !targetId) {
      // A template naming a step its own `steps` list does not declare. Not
      // reachable from the catalogue - `canvasTemplates.test.ts` enumerates it -
      // but a caller may pass a template of its own, and a half-built shape is
      // the one outcome this command exists to rule out.
      return unchanged(
        state,
        'template-endpoint-unknown',
        `The ${template.label} template names "${!sourceId ? edge.from : edge.to}", which is neither one of its steps nor the Start or End node.`,
      );
    }

    const connected = connectNodes(candidate, {
      edgeId: edgeIds[index],
      sourceId,
      targetId,
      flowType: edge.flowType,
    });

    // Both or neither, as in `addStep`, and `connectNodes` states the actual
    // rule that was broken rather than this command paraphrasing it.
    if (!connected.applied) {
      return { state, diagnostics: connected.diagnostics, applied: false };
    }

    candidate = connected.state;
    diagnostics.push(...connected.diagnostics);
  }

  const kept = diagnostics.filter(entry => !TEMPLATE_UNBOUND_CODES.has(entry.code));
  const unbound = kept.length !== diagnostics.length;

  return {
    state: candidate,
    diagnostics: unbound
      ? [
          {
            level: 'info',
            code: 'template-ports-unbound',
            message: 'None of the steps has a query yet, so the edges carry nothing until you choose one — the ports bind themselves when you do.',
          },
          ...kept,
        ]
      : kept,
    applied: true,
  };
}

/** Change an edge's flow type, keeping bindings that survive it. */
export function setEdgeFlowType(
  state: QueryGroupGraphState,
  edgeId: string,
  flowType: EdgeFlowType,
): CommandResult {
  const edge = edgeById(state, edgeId);
  if (!edge) return unchanged(state, 'edge-missing', `No edge ${edgeId} on the canvas.`);

  const sourceNode = nodeById(state, edge.source);
  const targetNode = nodeById(state, edge.target);
  if (!sourceNode || !targetNode) {
    return unchanged(state, 'edge-dangling', `Edge ${edgeId} does not connect two nodes on the canvas.`);
  }

  // A flow type its endpoints cannot legally carry is refused outright. Applying
  // it and merely reporting the problem left the graph in a state the invariant
  // checker rejects, and the canvas with an edge that can never resolve.
  const kindIssues = checkNodeKinds(flowType, sourceNode, targetNode);
  if (kindIssues.some(issue => issue.level === 'error')) {
    return { state, diagnostics: kindIssues, applied: false };
  }

  const resolution = resolveEndpoints(edge, sourceNode, targetNode, flowType);
  const diagnostics = [...kindIssues, ...resolution.diagnostics];

  // A mapping written against the old endpoints means nothing on another flow
  // type, so leaving VARIABLE_BINDINGS clears it. *Entering* needs a check
  // too: no rule reads the mapping on a non-bindings edge, so a stale save can
  // park an unreadable string there without violating anything - and keeping
  // it on entry materialized that junk as a `mapping-malformed` violation out
  // of an applied command. Found by the transition matrix.
  let variableMappings: string | null = null;
  if (flowType === 'VARIABLE_BINDINGS') {
    variableMappings = edge.variableMappings ?? null;
    if (variableMappings !== null && parseVariableMappings(variableMappings) === null) {
      variableMappings = null;
      diagnostics.push({
        level: 'warning',
        code: 'mapping-dropped',
        message: 'The variable mapping stored on this edge could not be read, so it was cleared.',
      });
    }
  }

  return {
    state: withEdges(
      state,
      state.edges.map(entry =>
        entry.id === edgeId
          ? {
              ...entry,
              flowType,
              sourceOutputId: resolution.sourceOutputId,
              targetInputId: resolution.targetInputId,
              variableMappings,
            }
          : entry,
      ),
    ),
    diagnostics,
    applied: true,
  };
}

function bindEndpoint(
  state: QueryGroupGraphState,
  edgeId: string,
  portId: string | null,
  direction: 'source' | 'target',
): CommandResult {
  const edge = edgeById(state, edgeId);
  if (!edge) return unchanged(state, 'edge-missing', `No edge ${edgeId} on the canvas.`);

  const node = nodeById(state, direction === 'source' ? edge.source : edge.target);
  if (!node) return unchanged(state, 'edge-dangling', `Edge ${edgeId} does not connect two nodes on the canvas.`);

  const targetNode = nodeById(state, edge.target);
  const passThrough = targetNode ? isEndNodePassThrough(edge.flowType, targetNode) : false;

  // On a pass-through edge there is no separate target to set: the End node
  // aliases whatever the source produces, so the source is the only endpoint
  // there is to choose. The inspector hides the target selector for this reason.
  if (passThrough && direction === 'target') {
    return unchanged(
      state,
      'end-node-alias-not-bindable',
      'An edge into the End node returns whatever its source produces; choose the source port instead.',
    );
  }

  if (portId) {
    const issue = checkEndpoint(edge.flowType, node, portId, direction);
    if (issue) return { state, diagnostics: [issue], applied: false };
  }

  return {
    state: withEdges(
      state,
      state.edges.map(entry => {
        if (entry.id !== edgeId) return entry;
        if (direction === 'source') {
          // The alias moves with the source.
          return { ...entry, sourceOutputId: portId, targetInputId: passThrough ? portId : entry.targetInputId };
        }
        return { ...entry, targetInputId: portId };
      }),
    ),
    diagnostics: portId
      ? []
      : [{ level: 'warning', code: `${direction}-cleared`, message: `This edge has no ${direction} port selected.` }],
    applied: true,
  };
}

export const bindEdgeSource = (state: QueryGroupGraphState, edgeId: string, portId: string) =>
  bindEndpoint(state, edgeId, portId, 'source');
export const bindEdgeTarget = (state: QueryGroupGraphState, edgeId: string, portId: string) =>
  bindEndpoint(state, edgeId, portId, 'target');
export const clearEdgeSource = (state: QueryGroupGraphState, edgeId: string) =>
  bindEndpoint(state, edgeId, null, 'source');
export const clearEdgeTarget = (state: QueryGroupGraphState, edgeId: string) =>
  bindEndpoint(state, edgeId, null, 'target');

/**
 * Set an edge's explicit variable mapping.
 *
 * Unreadable JSON is refused: it is never something an author meant, and
 * writing it produced a state `checkInvariants` rejects while this command
 * reported success. A mapping that parses but names variables the current
 * tuples do not have is *accepted* - it is reachable without anyone doing
 * anything wrong (reassign a node's query version and yesterday's mapping
 * stops matching), so it is the author's problem to see and fix, surfaced by
 * `validateEdge` in the inspector, not a state the canvas refuses to hold.
 */
export function setEdgeVariableMappings(
  state: QueryGroupGraphState,
  edgeId: string,
  variableMappings: string | null,
): CommandResult {
  if (!edgeById(state, edgeId)) return unchanged(state, 'edge-missing', `No edge ${edgeId} on the canvas.`);
  if (parseVariableMappings(variableMappings) === null) {
    return unchanged(state, 'mapping-malformed', 'That variable mapping could not be read as a list of source/target pairs.');
  }
  return {
    state: withEdges(
      state,
      state.edges.map(edge => (edge.id === edgeId ? { ...edge, variableMappings } : edge)),
    ),
    diagnostics: [],
    applied: true,
  };
}

/**
 * Remove a node and the edges that touched it.
 *
 * Shared metadata stays: a tuple belongs to a query version, and another node
 * using the same version still needs it.
 */
export function deleteNode(state: QueryGroupGraphState, nodeId: string): CommandResult {
  const node = nodeById(state, nodeId);
  if (!node) return unchanged(state, 'node-missing', `No node ${nodeId} on the canvas.`);
  if (node.kind === 'start' || node.kind === 'end') {
    return unchanged(state, 'boundary-node', 'Start and End nodes are part of every group and cannot be deleted.');
  }

  const next: QueryGroupGraphState = {
    ...state,
    nodes: state.nodes.filter(entry => entry.id !== nodeId),
    edges: state.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId),
  };

  return {
    state: { ...next, ioEntities: pruneUnreferencedEntities(next.ioEntities, referencedPortIds(next)) },
    diagnostics: [],
    applied: true,
  };
}

export function deleteEdge(state: QueryGroupGraphState, edgeId: string): CommandResult {
  if (!edgeById(state, edgeId)) return unchanged(state, 'edge-missing', `No edge ${edgeId} on the canvas.`);
  const next = withEdges(state, state.edges.filter(edge => edge.id !== edgeId));
  return {
    state: { ...next, ioEntities: pruneUnreferencedEntities(next.ioEntities, referencedPortIds(next)) },
    diagnostics: [],
    applied: true,
  };
}

/**
 * Re-resolve the endpoints of every edge touching a node.
 *
 * Runs after a node's ports change - a query assignment can make a previously
 * impossible binding unambiguous, and can invalidate one that used to hold.
 *
 * Endpoints were the only thing this reconciled, which left the *mapping*
 * between them written against ports the edge no longer has: assign a node a
 * version whose input tuple names different variables and yesterday's
 * `city -> city` survived onto a tuple with no `city` in it. A mapping naming
 * variables that are simply gone describes nothing, so it is dropped whole
 * rather than half-kept, and the drop is reported - silently discarding an
 * author's mapping is as bad as silently keeping a broken one.
 *
 * Only variables *known to be absent* count. A tuple whose members were never
 * described has unknown variables, not zero of them, and must not trigger a
 * drop (`validateVariableMappings` reports that case as a warning, not an
 * error, for the same reason).
 */
export function reconcileEdgesForNode(state: QueryGroupGraphState, nodeId: string): CommandResult {
  const diagnostics: Diagnostic[] = [];
  const model = ioModelOf(state);

  const edges = state.edges.map(edge => {
    if (edge.source !== nodeId && edge.target !== nodeId) return edge;
    const sourceNode = nodeById(state, edge.source);
    const targetNode = nodeById(state, edge.target);
    if (!sourceNode || !targetNode) return edge;

    const resolution = resolveEndpoints(edge, sourceNode, targetNode);
    diagnostics.push(...resolution.diagnostics);

    const reconciled = {
      ...edge,
      sourceOutputId: resolution.sourceOutputId,
      targetInputId: resolution.targetInputId,
    };

    let variableMappings = edge.variableMappings ?? null;
    if (variableMappings) {
      const orphaned = validateVariableMappings(reconciled, model).some(
        issue => issue.code === 'mapping-unknown-source' || issue.code === 'mapping-unknown-target',
      );
      if (orphaned) {
        variableMappings = null;
        diagnostics.push({
          level: 'warning',
          code: 'mapping-dropped',
          message: 'The variable mapping on this edge named variables the new query version does not have, so it was cleared.',
        });
      }
    }

    if (
      resolution.sourceOutputId === (edge.sourceOutputId ?? null) &&
      resolution.targetInputId === (edge.targetInputId ?? null) &&
      variableMappings === (edge.variableMappings ?? null)
    ) {
      return edge;
    }
    return { ...reconciled, variableMappings };
  });

  return { state: withEdges(state, edges), diagnostics, applied: true };
}
