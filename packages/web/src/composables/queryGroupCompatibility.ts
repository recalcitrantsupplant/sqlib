/**
 * What may connect to what, decided once.
 *
 * Connection creation, flow-type changes, inspector option lists, auto-binding
 * and validation each used to carry their own copy of these rules, and they had
 * already drifted - the work area could auto-bind a QUERY_ID edge and the graph
 * composable could not. Every one of those callers now asks this module.
 *
 * Two decisions are encoded here rather than implied:
 *
 * - **Control Flow anchors are runtime handles.** A Control Flow edge orders
 *   execution and moves no data, so it carries null endpoint ids. The anchors
 *   the canvas draws are synthetic descriptors, not persisted ports.
 * - **EndNode pass-through is an alias.** An edge into the End node names the
 *   *source's* port as its target, and the End node's input array is written
 *   from the edges. No second entity is minted for the group's own output, so
 *   the target list for such an edge is empty by construction.
 */

import type { GraphNodeKind, GraphNodeState, GraphEdgeState } from './useQueryGroupGraph';
import { canvasNodeLabel } from './queryGroupNodeLabel';
import {
  describeArity,
  tupleArity,
  variablesForPort,
  type GraphPort,
  type IoEntityKind,
  type IoModel,
} from './queryGroupIoModel';

export type EdgeFlowType = GraphEdgeState['flowType'];

export const EDGE_FLOW_TYPES: readonly EdgeFlowType[] = [
  'CONTROL_FLOW',
  'VARIABLE_BINDINGS',
  'RDF_GRAPH',
  'BOOLEAN',
  'QUERY_ID',
];

export type Diagnostic = {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
};

const diagnostic = (level: Diagnostic['level'], code: string, message: string): Diagnostic => ({ level, code, message });

/** Which node kinds may sit at each end of an edge of this flow type. */
const NODE_KIND_RULES: Record<EdgeFlowType, { source?: GraphNodeKind[]; target?: GraphNodeKind[] }> = {
  CONTROL_FLOW: {},
  VARIABLE_BINDINGS: {},
  RDF_GRAPH: {},
  BOOLEAN: {},
  // A query selector only means anything to a node that picks its query at run time.
  QUERY_ID: { target: ['dynamic'] },
};

/**
 * The port kinds a source node may offer for a flow type.
 *
 * The Start node is the exception worth spelling out: what it *saves* is
 * the group's input tuples, so its outputs are QueryInputTuple entities.
 */
export function legalSourcePortKinds(flowType: EdgeFlowType, sourceNode: GraphNodeState): IoEntityKind[] {
  switch (flowType) {
    case 'CONTROL_FLOW':
      return [];
    case 'RDF_GRAPH':
      return ['TriplesQuadsIO'];
    case 'BOOLEAN':
      return ['BooleanIO'];
    case 'QUERY_ID':
      // The caller choosing which query a dynamic node runs is a group input
      // like any other, so the Start node saves it the way it saves
      // bindings. Without this the backend feature was not authorable: the
      // canvas offered no candidate port and the edge could never resolve.
      return sourceNode.kind === 'start' ? ['QueryInputTuple'] : ['QueryOutputTuple'];
    case 'VARIABLE_BINDINGS':
      return sourceNode.kind === 'start' ? ['QueryInputTuple'] : ['QueryOutputTuple'];
    default:
      return [];
  }
}

/**
 * The port kinds a target node may offer for a flow type.
 *
 * The End node consumes the group's results, which are output tuples, and it
 * aliases the source port rather than owning one (see the note at the top).
 */
export function legalTargetPortKinds(flowType: EdgeFlowType, targetNode: GraphNodeState): IoEntityKind[] {
  switch (flowType) {
    case 'CONTROL_FLOW':
      return [];
    case 'RDF_GRAPH':
      return ['TriplesQuadsIO'];
    case 'BOOLEAN':
      return ['BooleanIO'];
    case 'QUERY_ID':
      return ['QueryIdInput'];
    case 'VARIABLE_BINDINGS':
      return targetNode.kind === 'end' ? ['QueryOutputTuple'] : ['QueryInputTuple'];
    default:
      return [];
  }
}

/** True when the edge's target port is an alias of its source port. */
export function isEndNodePassThrough(flowType: EdgeFlowType, targetNode: GraphNodeState): boolean {
  return flowType !== 'CONTROL_FLOW' && targetNode.kind === 'end';
}

/**
 * Candidate ports on an endpoint.
 *
 * A candidate that could not be resolved to an I/O entity is still returned:
 * the author needs to see that the port exists and is unresolved, not an empty
 * list that reads as "this node has nothing to connect".
 */
export function sourceCandidates(flowType: EdgeFlowType, sourceNode: GraphNodeState): GraphPort[] {
  const kinds = legalSourcePortKinds(flowType, sourceNode);
  return sourceNode.outputs.filter(port => kinds.includes(port.entityType));
}

export function targetCandidates(flowType: EdgeFlowType, targetNode: GraphNodeState): GraphPort[] {
  if (isEndNodePassThrough(flowType, targetNode)) {
    // Nothing to choose: the endpoint follows the source.
    return [];
  }
  const kinds = legalTargetPortKinds(flowType, targetNode);
  return targetNode.inputs.filter(port => kinds.includes(port.entityType));
}

/** Whether a specific port is a legal endpoint, and why not when it is not. */
export function checkEndpoint(
  flowType: EdgeFlowType,
  node: GraphNodeState,
  portId: string | null | undefined,
  direction: 'source' | 'target',
): Diagnostic | null {
  if (!portId) return null;

  if (flowType === 'CONTROL_FLOW') {
    return diagnostic(
      'error',
      'control-flow-has-endpoint',
      'Control Flow edges order execution and carry no data, so they take no endpoint ports.',
    );
  }

  if (direction === 'target' && isEndNodePassThrough(flowType, node)) {
    // The alias case: the target id legitimately names a port of the *source*.
    return null;
  }

  const ports = direction === 'source' ? node.outputs : node.inputs;
  const port = ports.find(entry => entry.id === portId);
  if (!port) {
    return diagnostic(
      'error',
      'endpoint-not-on-node',
      `Port ${portId} is not ${direction === 'source' ? 'an output of' : 'an input of'} ${canvasNodeLabel(node)}.`,
    );
  }

  const kinds = direction === 'source' ? legalSourcePortKinds(flowType, node) : legalTargetPortKinds(flowType, node);
  if (!kinds.includes(port.entityType)) {
    return diagnostic(
      'error',
      'endpoint-kind-mismatch',
      `${port.label} is a ${port.entityType}, which a ${flowType} edge cannot use as its ${direction}.`,
    );
  }

  return null;
}

/** Node-kind restrictions for a flow type. */
export function checkNodeKinds(
  flowType: EdgeFlowType,
  sourceNode: GraphNodeState,
  targetNode: GraphNodeState,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (sourceNode.kind === 'end') {
    diagnostics.push(diagnostic('error', 'end-node-source', 'End nodes cannot have outgoing edges.'));
  }
  if (targetNode.kind === 'start') {
    diagnostics.push(diagnostic('error', 'start-node-target', 'Start nodes cannot have incoming edges.'));
  }

  const rule = NODE_KIND_RULES[flowType];
  if (rule?.source && !rule.source.includes(sourceNode.kind)) {
    diagnostics.push(
      diagnostic('error', 'source-node-kind', `${flowType} cannot originate from a ${sourceNode.kind} node.`),
    );
  }
  if (rule?.target && !rule.target.includes(targetNode.kind)) {
    diagnostics.push(
      diagnostic('error', 'target-node-kind', `${flowType} must target a ${rule.target.join(' or ')} node.`),
    );
  }

  // A ruleset only speaks RDF, in either direction.
  if ((sourceNode.kind === 'ruleset' || targetNode.kind === 'ruleset') &&
      flowType !== 'RDF_GRAPH' && flowType !== 'CONTROL_FLOW') {
    diagnostics.push(
      diagnostic('error', 'ruleset-requires-rdf', 'Ruleset nodes exchange data as RDF graphs.'),
    );
  }

  // What leaves a patch node is half a patch, which is RDF and nothing else -
  // the backend's `NODE_PATCH_OUTBOUND_FLOW_TYPE`. A patch has no tabular shape
  // and no truth value, so bindings and booleans are not narrower readings of
  // it, they are different things.
  if (sourceNode.kind === 'patch' && flowType !== 'RDF_GRAPH' && flowType !== 'CONTROL_FLOW') {
    diagnostics.push(
      diagnostic(
        'error',
        'patch-outbound-flow-type',
        'A patch node emits RDF: send deletions or additions as an RDF graph, or order execution with a control flow edge.',
      ),
    );
  }

  // Only a RuleSetNode or the End node can actually read an RDF graph. A SPARQL
  // node would need the producer materialized into a shared store, which the
  // flat API cannot express, so the backend rejects the edge as inert
  // (`EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME`) - and the canvas used to draw it
  // without comment, which is exactly the drift the legality artifact exists
  // to catch.
  /*
   * A patch node is on this list as a target for the same reason a query node
   * is - it reads its store over SPARQL and nothing hands it a graph - and it
   * is worth naming separately as a *source*, because that case fails for the
   * opposite reason. A patch node has an ephemeral store of its own, which is
   * how it derives over a graph the caller supplied; nothing is ever
   * materialized into it, so a SPARQL consumer would query an empty store and
   * answer as if the patch were empty (`EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME`).
   */
  if (flowType === 'RDF_GRAPH'
    && (targetNode.kind === 'query' || targetNode.kind === 'dynamic' || targetNode.kind === 'patch')) {
    diagnostics.push(
      sourceNode.kind === 'patch'
        ? diagnostic(
            'error',
            'rdf-graph-target-cannot-consume',
            'A patch node derives without writing, so there is no store for a query node to read; send this half to a Ruleset node or the End node.',
          )
        : diagnostic(
            'error',
            'rdf-graph-target-cannot-consume',
            'A query node cannot read an RDF graph from another node; route it to a Ruleset node or the End node.',
          ),
    );
  }

  return diagnostics;
}

/**
 * Graph shape: the canvas may not build something the executor cannot order.
 *
 * `GraphBuilder.validateGraph` topologically sorts with Kahn's algorithm over
 * **every** edge and throws `GRAPH_CYCLE` when it cannot finish. Flow type is
 * irrelevant there - a control flow edge orders execution as surely as a data
 * edge does - so these walk every edge too. Enforcing it here rather than only
 * at save time is what stops the canvas from accepting a group the API can
 * never execute, silently.
 *
 * Edges are created one at a time, so a cycle is never transiently necessary:
 * refusing the closing edge costs the author nothing.
 */
type EdgeEnds = Pick<GraphEdgeState, 'source' | 'target'>;

/** Whether `to` is reachable from `from` by following edges forwards. */
export function reaches(edges: readonly EdgeEnds[], from: string, to: string): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.source);
    if (targets) targets.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }

  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === to) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

/** Whether adding this edge would close a cycle. A self-loop is a cycle. */
export const wouldCreateCycle = (edges: readonly EdgeEnds[], sourceId: string, targetId: string): boolean =>
  sourceId === targetId || reaches(edges, targetId, sourceId);

/** Whether the graph already contains a cycle, by the executor's own method. */
export function hasCycle(nodeIds: readonly string[], edges: readonly EdgeEnds[]): boolean {
  const indegree = new Map<string, number>(nodeIds.map(id => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    // An edge naming a node that is not on the canvas is `edge-dangling`, a
    // different violation; ignore it here rather than reporting it twice.
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    const targets = outgoing.get(edge.source);
    if (targets) targets.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }

  const queue = nodeIds.filter(id => (indegree.get(id) ?? 0) === 0);
  let visited = 0;
  while (queue.length) {
    const current = queue.shift()!;
    visited++;
    for (const target of outgoing.get(current) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }
  return visited !== nodeIds.length;
}

export type BindOutcome =
  | { status: 'bound'; portId: string }
  | { status: 'none'; reason: string }
  | { status: 'ambiguous'; reason: string; candidates: GraphPort[] };

/**
 * Bind automatically only when the choice cannot be wrong.
 *
 * Picking the first of several candidates is a guess presented as a decision;
 * the author is the only one who knows which output they meant.
 */
export function autoBind(candidates: GraphPort[], what: string): BindOutcome {
  if (candidates.length === 0) {
    return { status: 'none', reason: `No compatible ${what} is available.` };
  }
  if (candidates.length === 1) {
    return { status: 'bound', portId: candidates[0].id };
  }
  return {
    status: 'ambiguous',
    reason: `${candidates.length} compatible ${what}s are available; choose one.`,
    candidates,
  };
}

export type EndpointResolution = {
  sourceOutputId: string | null;
  targetInputId: string | null;
  diagnostics: Diagnostic[];
};

/**
 * Work out an edge's endpoints for a flow type, keeping bindings that are still
 * legal and clearing - with a reason - the ones that are not.
 */
export function resolveEndpoints(
  edge: Pick<GraphEdgeState, 'flowType' | 'sourceOutputId' | 'targetInputId'>,
  sourceNode: GraphNodeState,
  targetNode: GraphNodeState,
  flowType: EdgeFlowType = edge.flowType,
): EndpointResolution {
  const diagnostics: Diagnostic[] = [];

  if (flowType === 'CONTROL_FLOW') {
    return { sourceOutputId: null, targetInputId: null, diagnostics };
  }

  let sourceOutputId = edge.sourceOutputId ?? null;
  if (sourceOutputId && checkEndpoint(flowType, sourceNode, sourceOutputId, 'source')) {
    diagnostics.push(
      diagnostic('info', 'source-cleared', `The previous source port is not valid for ${flowType} and was cleared.`),
    );
    sourceOutputId = null;
  }
  if (!sourceOutputId) {
    const outcome = autoBind(sourceCandidates(flowType, sourceNode), 'source output');
    if (outcome.status === 'bound') sourceOutputId = outcome.portId;
    else diagnostics.push(diagnostic('warning', `source-${outcome.status}`, outcome.reason));
  }

  if (isEndNodePassThrough(flowType, targetNode)) {
    // The alias: whatever the source produces is what the group returns.
    return { sourceOutputId, targetInputId: sourceOutputId, diagnostics };
  }

  let targetInputId = edge.targetInputId ?? null;
  if (targetInputId && checkEndpoint(flowType, targetNode, targetInputId, 'target')) {
    diagnostics.push(
      diagnostic('info', 'target-cleared', `The previous target port is not valid for ${flowType} and was cleared.`),
    );
    targetInputId = null;
  }
  if (!targetInputId) {
    const outcome = autoBind(targetCandidates(flowType, targetNode), 'target input');
    if (outcome.status === 'bound') targetInputId = outcome.portId;
    else diagnostics.push(diagnostic('warning', `target-${outcome.status}`, outcome.reason));
  }

  return { sourceOutputId, targetInputId, diagnostics };
}

export type VariableMapping = { source: string; target: string };

export function parseVariableMappings(raw: string | null | undefined): VariableMapping[] | null {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const mappings: VariableMapping[] = [];
    for (const entry of parsed) {
      if (typeof entry?.source !== 'string' || typeof entry?.target !== 'string') return null;
      mappings.push({ source: entry.source, target: entry.target });
    }
    return mappings;
  } catch {
    return null;
  }
}

/**
 * Check a mapping against the variables that actually exist.
 *
 * Partial, subset and reordered mappings are all legal - a mapping's job is to
 * say which of the source's variables feed which of the target's, and it is
 * allowed to leave either side out. Only a reference to a variable that does
 * not exist is an error. Differing arity is reported as a warning about
 * behaviour, never as a reason to reject.
 */
export function validateVariableMappings(
  edge: Pick<GraphEdgeState, 'flowType' | 'sourceOutputId' | 'targetInputId' | 'variableMappings'>,
  model: IoModel,
): Diagnostic[] {
  if (edge.flowType !== 'VARIABLE_BINDINGS') return [];
  const diagnostics: Diagnostic[] = [];

  const mappings = parseVariableMappings(edge.variableMappings);
  if (mappings === null) {
    return [diagnostic('error', 'mapping-malformed', 'The variable mapping on this edge could not be read.')];
  }

  const sourceVariables = edge.sourceOutputId ? variablesForPort(edge.sourceOutputId, model) : null;
  const targetVariables = edge.targetInputId ? variablesForPort(edge.targetInputId, model) : null;

  if (mappings.length > 0) {
    if (sourceVariables) {
      const names = new Set(sourceVariables.map(v => v.variableName));
      for (const mapping of mappings) {
        if (!names.has(mapping.source)) {
          diagnostics.push(
            diagnostic('error', 'mapping-unknown-source', `?${mapping.source} is not a variable of the source tuple.`),
          );
        }
      }
    }
    if (targetVariables) {
      const names = new Set(targetVariables.map(v => v.variableName));
      for (const mapping of mappings) {
        if (!names.has(mapping.target)) {
          diagnostics.push(
            diagnostic('error', 'mapping-unknown-target', `?${mapping.target} is not a variable of the target tuple.`),
          );
        }
      }
    }
  }

  diagnostics.push(...arityDiagnostics(edge.sourceOutputId, edge.targetInputId, model));
  return diagnostics;
}

/**
 * Say what differing or unknown arity will do at run time.
 *
 * Descriptive and diagnostic only. Arity equality was once used as a filter,
 * which hid legal targets and made "unknown" behave like "zero".
 */
export function arityDiagnostics(
  sourceOutputId: string | null | undefined,
  targetInputId: string | null | undefined,
  model: IoModel,
): Diagnostic[] {
  if (!sourceOutputId || !targetInputId) return [];
  const source = model.entities[sourceOutputId];
  const target = model.entities[targetInputId];
  if (!source || !target) return [];
  if (source.kind !== 'QueryInputTuple' && source.kind !== 'QueryOutputTuple') return [];

  const sourceArity = tupleArity(source);
  const targetArity = tupleArity(target);

  if (sourceArity == null || targetArity == null) {
    return [
      diagnostic(
        'warning',
        'mapping-arity-unknown',
        'One of these tuples has no member information, so the variable mapping cannot be checked here.',
      ),
    ];
  }
  if (sourceArity === targetArity) return [];

  return [
    diagnostic(
      'warning',
      'mapping-arity-differs',
      sourceArity > targetArity
        ? `The source supplies ${describeArity(sourceArity)} and the target takes ${describeArity(targetArity)}; the unmapped source variables are dropped.`
        : `The source supplies ${describeArity(sourceArity)} and the target takes ${describeArity(targetArity)}; the unmapped target variables stay unbound.`,
    ),
  ];
}

/**
 * An RDF edge leaving a patch node has to say which half of the patch it carries.
 *
 * The node's two outputs are opposite facts, so "the RDF output" is not a thing
 * a patch node has. The backend refuses an unnamed one outright
 * (`EDGE_PATCH_SOURCE_PORT_UNNAMED`) rather than answering it with the patch
 * document, which is not a graph; saying so here means the author hears it while
 * drawing rather than at the run.
 */
export function checkPatchSourcePort(
  edge: Pick<GraphEdgeState, 'flowType' | 'sourceOutputId'>,
  sourceNode: GraphNodeState,
): Diagnostic | null {
  if (sourceNode.kind !== 'patch' || edge.flowType !== 'RDF_GRAPH') return null;

  const halves = [sourceNode.deletionsOutputId, sourceNode.additionsOutputId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (!edge.sourceOutputId) {
    return diagnostic(
      'error',
      'patch-source-port-unnamed',
      'This edge leaves a patch node without saying which half it carries; choose its deletions or additions port.',
    );
  }
  if (halves.length > 0 && !halves.includes(edge.sourceOutputId)) {
    return diagnostic(
      'error',
      'patch-source-port-unnamed',
      'This edge leaves a patch node from a port that is neither its deletions nor its additions output.',
    );
  }
  return null;
}

/** Everything wrong with one edge, in one call. */
export function validateEdge(
  edge: GraphEdgeState,
  sourceNode: GraphNodeState | undefined,
  targetNode: GraphNodeState | undefined,
  model: IoModel,
): Diagnostic[] {
  if (!sourceNode || !targetNode) {
    return [diagnostic('error', 'edge-dangling', 'This edge does not connect two nodes on the canvas.')];
  }

  const diagnostics = checkNodeKinds(edge.flowType, sourceNode, targetNode);

  const sourceIssue = checkEndpoint(edge.flowType, sourceNode, edge.sourceOutputId, 'source');
  if (sourceIssue) diagnostics.push(sourceIssue);
  const targetIssue = checkEndpoint(edge.flowType, targetNode, edge.targetInputId, 'target');
  if (targetIssue) diagnostics.push(targetIssue);

  // Asked only of a source `checkEndpoint` had nothing to say about. "Which
  // half does this carry" is a question about a port that is already a legal
  // one; adding it to a port that is on the wrong node, or of the wrong kind,
  // would report the same mistake twice in two vocabularies.
  if (!sourceIssue) {
    const patchIssue = checkPatchSourcePort(edge, sourceNode);
    if (patchIssue) diagnostics.push(patchIssue);
  }

  diagnostics.push(...validateVariableMappings(edge, model));
  return diagnostics;
}
