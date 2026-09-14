export const DATA_FLOW_TYPES = [
  'VARIABLE_BINDINGS',
  'RDF_GRAPH',
  'BOOLEAN',
  'QUERY_ID',
] as const;

export type DataFlowType =
  | 'CONTROL_FLOW'
  | typeof DATA_FLOW_TYPES[number];

export const OUTPUT_IO_TYPES = [
  'QueryOutputTuple',
  'TriplesQuadsIO',
  'BooleanIO',
] as const;

export type OutputIOType = typeof OUTPUT_IO_TYPES[number];

export const INPUT_IO_TYPES = [
  'QueryInputTuple',
  'TriplesQuadsIO',
  'BooleanIO',
  'QueryIdInput',
] as const;

export type InputIOType = typeof INPUT_IO_TYPES[number];

export const IO_COMPATIBILITY = {
  VARIABLE_BINDINGS: {
    source: 'QueryOutputTuple' as OutputIOType,
    target: 'QueryInputTuple' as InputIOType,
  },
  RDF_GRAPH: {
    source: 'TriplesQuadsIO' as OutputIOType,
    target: 'TriplesQuadsIO' as InputIOType,
  },
  BOOLEAN: {
    source: 'BooleanIO' as OutputIOType,
    target: 'BooleanIO' as InputIOType,
  },
  QUERY_ID: {
    source: 'QueryOutputTuple' as OutputIOType,
    target: 'QueryIdInput' as InputIOType,
  },
} as const;
