/**
 * The edge-legality oracle, as data.
 *
 * Extracted from `legality-matrix.test.ts` so the table can be written to a
 * checked-in artifact (`packages/contracts/fixtures/query-group-edge-legality.json`)
 * that the web suite asserts its own connection rules against. The two sides
 * had already drifted twice by the time the artifact existed - the canvas knew
 * nothing of `EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME`, and refused the
 * ASK-as-bindings source the engine accepts - and nothing could see either
 * until both suites read the same table.
 *
 * Mirrors `GraphBuilder.validateGraph` in its own checking order. Written out
 * long-hand rather than derived from the implementation on purpose: an oracle
 * that imports the thing it judges cannot catch the thing being wrong.
 */

export type SourceKind = 'select' | 'construct' | 'describe' | 'ask' | 'update' | 'dynamic' | 'ruleset' | 'start';
export type TargetKind = 'query' | 'dynamic' | 'ruleset' | 'end';
export type MatrixFlowType = 'CONTROL_FLOW' | 'VARIABLE_BINDINGS' | 'RDF_GRAPH' | 'BOOLEAN' | 'QUERY_ID';

export const SOURCE_KINDS: SourceKind[] = ['select', 'construct', 'describe', 'ask', 'update', 'dynamic', 'ruleset', 'start'];
export const TARGET_KINDS: TargetKind[] = ['query', 'dynamic', 'ruleset', 'end'];
export const MATRIX_FLOW_TYPES: MatrixFlowType[] = ['CONTROL_FLOW', 'VARIABLE_BINDINGS', 'RDF_GRAPH', 'BOOLEAN', 'QUERY_ID'];

/** Port entity type a source of this kind naturally exposes. */
export type PortType = 'QueryOutputTuple' | 'TriplesQuadsIO' | 'BooleanIO' | 'QueryIdInput' | 'QueryInputTuple' | 'none';

export const SOURCE_PORT_TYPE: Record<SourceKind, PortType> = {
  select: 'QueryOutputTuple',
  construct: 'TriplesQuadsIO',
  describe: 'TriplesQuadsIO',
  ask: 'BooleanIO',
  update: 'none',
  dynamic: 'QueryOutputTuple',
  ruleset: 'TriplesQuadsIO',
  start: 'QueryOutputTuple',
};

/** Port entity type a data flow requires on the target side. */
export const FLOW_TARGET_PORT_TYPE: Record<Exclude<MatrixFlowType, 'CONTROL_FLOW'>, PortType> = {
  VARIABLE_BINDINGS: 'QueryInputTuple',
  RDF_GRAPH: 'TriplesQuadsIO',
  BOOLEAN: 'BooleanIO',
  QUERY_ID: 'QueryIdInput',
};

export interface Expectation {
  /** `null` means the graph is expected to validate cleanly. */
  code: string | null;
  /** Which entity the issue should point at. */
  at?: 'edge' | 'sourceNode' | 'targetNode' | 'graph';
}

export function expectationFor(source: SourceKind, flow: MatrixFlowType, target: TargetKind): Expectation {
  // StartNode straight to EndNode leaves the group with nothing to execute, so
  // the whole-graph check fires before any edge is looked at. The cell cannot
  // isolate a port-type question; it only ever tests the degenerate graph.
  if (source === 'start' && target === 'end') return { code: 'GRAPH_NO_EXECUTABLE_NODE', at: 'graph' };

  if (flow === 'CONTROL_FLOW') {
    // Control flow carries no ports, so any pair is structurally fine - except
    // that an EndNode reached only by control flow has nothing to return.
    return target === 'end' ? { code: 'END_NODE_NO_DATA_INPUT', at: 'targetNode' } : { code: null };
  }

  const sourceType = SOURCE_PORT_TYPE[source];
  // An UPDATE node exposes no port at all, so the edge cannot name one.
  if (sourceType === 'none') return { code: 'EDGE_DATA_FLOW_MISSING_IO', at: 'edge' };

  // EndNode edges are pass-through: the source port is reused as the target
  // port, which is what makes "ASK into a bindings EndNode" a target-type error.
  const targetType: PortType = target === 'end' ? sourceType : FLOW_TARGET_PORT_TYPE[flow];

  if (flow === 'QUERY_ID') {
    if (target !== 'dynamic') return { code: 'EDGE_QUERY_ID_TARGET_NODE_TYPE', at: 'edge' };
    if (sourceType !== 'QueryOutputTuple') return { code: 'EDGE_SOURCE_PORT_TYPE', at: 'edge' };
    if (targetType !== 'QueryIdInput') return { code: 'EDGE_TARGET_PORT_TYPE', at: 'edge' };
    // A QUERY_ID source must be a single-variable tuple; every source template
    // used here projects one variable, so arity never trips.
    return { code: null };
  }

  if (flow === 'RDF_GRAPH') {
    if (sourceType !== 'TriplesQuadsIO') return { code: 'EDGE_SOURCE_PORT_TYPE', at: 'edge' };
    if (targetType !== 'TriplesQuadsIO') return { code: 'EDGE_TARGET_PORT_TYPE', at: 'edge' };
    // Only a RuleSetNode or the EndNode can actually read an RDF graph. A SPARQL
    // node needs the producer to materialize into a shared ephemeral store,
    // which the flat creation API cannot express, so the edge is inert.
    if (target === 'query' || target === 'dynamic') {
      return { code: 'EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME', at: 'edge' };
    }
    return { code: null };
  }

  if (flow === 'BOOLEAN') {
    if (sourceType !== 'BooleanIO' || targetType !== 'BooleanIO') {
      return { code: 'EDGE_SOURCE_PORT_TYPE', at: 'edge' };
    }
    // A RuleSetNode consumes RDF and nothing else, checked once the edge itself
    // is well typed.
    if (target === 'ruleset') return { code: 'NODE_RULESET_INBOUND_FLOW_TYPE', at: 'targetNode' };
    return { code: null };
  }

  // VARIABLE_BINDINGS
  if (sourceType !== 'QueryOutputTuple' && sourceType !== 'BooleanIO') {
    return { code: 'EDGE_SOURCE_PORT_TYPE', at: 'edge' };
  }
  if (target === 'end') {
    if (targetType !== 'QueryOutputTuple') return { code: 'EDGE_TARGET_PORT_TYPE', at: 'edge' };
    return { code: null };
  }
  if (targetType !== 'QueryInputTuple') return { code: 'EDGE_TARGET_PORT_TYPE', at: 'edge' };
  // Past the port-type gate, node-level rules apply. Edges are checked before
  // nodes, so these only surface once the edge itself is well typed.
  if (target === 'ruleset') return { code: 'NODE_RULESET_INBOUND_FLOW_TYPE', at: 'targetNode' };
  if (source === 'ruleset') return { code: 'NODE_RULESET_OUTBOUND_FLOW_TYPE', at: 'sourceNode' };
  return { code: null };
}

export type LegalityCell = {
  source: SourceKind;
  flow: MatrixFlowType;
  target: TargetKind;
  code: string | null;
  at?: 'edge' | 'sourceNode' | 'targetNode' | 'graph';
};

/** The whole table, in a stable order, ready to serialize. */
export function legalityTable(): LegalityCell[] {
  return SOURCE_KINDS.flatMap(source =>
    MATRIX_FLOW_TYPES.flatMap(flow =>
      TARGET_KINDS.map((target): LegalityCell => {
        const expected = expectationFor(source, flow, target);
        return { source, flow, target, code: expected.code, ...(expected.at ? { at: expected.at } : {}) };
      }),
    ),
  );
}
