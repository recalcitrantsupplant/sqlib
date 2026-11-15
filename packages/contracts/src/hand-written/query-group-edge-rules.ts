/**
 * Which port kinds each end of a query group edge may use.
 *
 * The API and the canvas both read this table. The API checks every edge
 * against it when a group version is saved. The canvas uses it to offer ports
 * and to report errors. Before this table existed each side kept its own copy,
 * and the two disagreed about the Start node: the API accepted a
 * `QueryOutputTuple` there, and refused the `QueryInputTuple` that the canvas
 * writes for a QUERY_ID edge.
 *
 * The Start node's tuple ports are the group's input tuples, so they are
 * `QueryInputTuple` entities on every flow type that carries a table.
 *
 * DATASET edges are not in this table. The canvas cannot draw them, and the
 * API checks them in `GraphBuilder.validateDatasetEdge`.
 */

/** The edge flow types that this table covers. */
export const QUERY_GROUP_EDGE_FLOW_TYPES = [
  'CONTROL_FLOW',
  'VARIABLE_BINDINGS',
  'RDF_GRAPH',
  'BOOLEAN',
  'QUERY_ID',
] as const;

export type QueryGroupEdgeFlowType = (typeof QUERY_GROUP_EDGE_FLOW_TYPES)[number];

/** The entity types a query group port can have. */
export type QueryGroupPortKind =
  | 'QueryInputTuple'
  | 'QueryOutputTuple'
  | 'TriplesQuadsIO'
  | 'BooleanIO'
  | 'QueryIdInput';

/**
 * The part a node plays at one end of an edge. Every node that runs something
 * (query, dynamic, rule set, patch, ETL) is a `step`.
 */
export type QueryGroupNodeRole = 'start' | 'end' | 'step';

export const isQueryGroupEdgeFlowType = (value: unknown): value is QueryGroupEdgeFlowType =>
  typeof value === 'string' && (QUERY_GROUP_EDGE_FLOW_TYPES as readonly string[]).includes(value);

/**
 * The port kinds an edge of this flow type may leave from.
 *
 * A step may send an ASK result (`BooleanIO`) as a one-column binding table.
 */
export function edgeSourcePortKinds(
  flowType: QueryGroupEdgeFlowType,
  sourceRole: QueryGroupNodeRole,
): readonly QueryGroupPortKind[] {
  switch (flowType) {
    case 'CONTROL_FLOW':
      return [];
    case 'RDF_GRAPH':
      return ['TriplesQuadsIO'];
    case 'BOOLEAN':
      return ['BooleanIO'];
    case 'QUERY_ID':
      return sourceRole === 'start' ? ['QueryInputTuple'] : ['QueryOutputTuple'];
    case 'VARIABLE_BINDINGS':
      return sourceRole === 'start' ? ['QueryInputTuple'] : ['QueryOutputTuple', 'BooleanIO'];
  }
}

/**
 * The port kinds an edge of this flow type may arrive at.
 *
 * An edge into the End node names the source's port as its target (see
 * `isEndNodePassThrough`), so its target is checked as a source port.
 */
export function edgeTargetPortKinds(
  flowType: QueryGroupEdgeFlowType,
  targetRole: QueryGroupNodeRole,
): readonly QueryGroupPortKind[] {
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
      return targetRole === 'end' ? ['QueryOutputTuple'] : ['QueryInputTuple'];
  }
}

/** True when the edge's target port is the source port under another name. */
export const isEndNodePassThrough = (flowType: QueryGroupEdgeFlowType, targetRole: QueryGroupNodeRole): boolean =>
  flowType !== 'CONTROL_FLOW' && targetRole === 'end';

/**
 * Why a port cannot be this end of this edge, or null when it can.
 *
 * `portKind` is the entity type of the port the edge names. The message says
 * which kinds the edge accepts, and for a Start node port it says what to do.
 */
export function checkEdgePortKind(
  flowType: QueryGroupEdgeFlowType,
  role: QueryGroupNodeRole,
  direction: 'source' | 'target',
  portKind: string,
): string | null {
  if (direction === 'target' && isEndNodePassThrough(flowType, role)) return null;
  const allowed = direction === 'source'
    ? edgeSourcePortKinds(flowType, role)
    : edgeTargetPortKinds(flowType, role);
  if ((allowed as readonly string[]).includes(portKind)) return null;
  if (allowed.length === 0) {
    return `a ${flowType} edge takes no ${direction} port`;
  }
  const where = role === 'start' ? 'from the Start node' : role === 'end' ? 'into the End node' : `as its ${direction}`;
  const fix = role === 'start' && direction === 'source'
    ? '. Declare the group input as an input tuple of the Start node'
    : '';
  return `is a ${portKind}; a ${flowType} edge ${where} needs a ${allowed.join(' or ')}${fix}`;
}
