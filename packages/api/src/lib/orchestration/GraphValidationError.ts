/**
 * Structural validation failures for a query group graph.
 *
 * Every check in `GraphBuilder.validateGraph` raises one of these, so consumers
 * (`GET /query-groups/:id/v/:version/validate`, the canvas, the legality matrix
 * tests) can branch on a stable `code` and highlight `entityId` directly rather
 * than parsing the human-readable message.
 */
export type GraphValidationCode =
  // Whole-graph shape
  | 'GRAPH_CYCLE'
  | 'GRAPH_NO_EXECUTABLE_NODE'
  | 'END_NODE_MIXED_RESULT_TYPES'
  | 'END_NODE_NO_DATA_INPUT'
  // Edge wiring
  | 'EDGE_FLOW_TYPE_UNSUPPORTED'
  | 'EDGE_NODE_MISSING'
  | 'EDGE_SOURCE_OUTPUT_UNDECLARED'
  | 'EDGE_TARGET_INPUT_UNDECLARED'
  | 'EDGE_CONTROL_FLOW_HAS_IO'
  | 'EDGE_DATA_FLOW_MISSING_IO'
  | 'EDGE_END_NODE_PASSTHROUGH_MISMATCH'
  | 'EDGE_SOURCE_IO_MISSING'
  | 'EDGE_TARGET_IO_MISSING'
  // Port type compatibility
  | 'EDGE_SOURCE_PORT_TYPE'
  | 'EDGE_TARGET_PORT_TYPE'
  | 'EDGE_QUERY_ID_TARGET_NODE_TYPE'
  | 'EDGE_QUERY_ID_ARITY'
  | 'EDGE_BOOLEAN_TARGET_ARITY'
  | 'EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME'
  // Tuple shape
  | 'EDGE_TUPLE_ARITY_MISMATCH'
  | 'EDGE_TUPLE_NAME_EMPTY'
  | 'TUPLE_MISSING'
  // Node/query agreement
  | 'NODE_OUTPUT_VARIABLE_MISSING'
  | 'NODE_VALUES_GROUP_MISSING'
  | 'NODE_RULESET_INBOUND_FLOW_TYPE'
  | 'NODE_RULESET_OUTBOUND_FLOW_TYPE'
  | 'NODE_PATCH_OUTPUT_PORTS_MISSING'
  | 'NODE_PATCH_QUERY_NOT_UPDATE'
  | 'NODE_PATCH_OUTBOUND_FLOW_TYPE'
  | 'EDGE_PATCH_SOURCE_PORT_UNNAMED'
  | 'EDGE_PATCH_HALVES_MERGED'
  | 'NODE_TERMINAL_BINDINGS_OUTPUT';

export type GraphValidationEntityType = 'graph' | 'node' | 'edge' | 'tuple';

export class GraphValidationError extends Error {
  constructor(
    public readonly code: GraphValidationCode,
    message: string,
    public readonly entityType: GraphValidationEntityType = 'graph',
    public readonly entityId: string | null = null,
  ) {
    super(message);
    this.name = 'GraphValidationError';
  }
}

export const isGraphValidationError = (error: unknown): error is GraphValidationError =>
  error instanceof GraphValidationError;
