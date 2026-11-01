import type { PersistedQueryVersion } from '../../persistence/schemas/QueryVersionSchema.js';
import type { PersistedQueryNode } from '../../persistence/schemas/QueryNodeSchema.js';
import type { PersistedDynamicQueryNode } from '../../persistence/schemas/DynamicQueryNodeSchema.js';
import type { PersistedRuleSetNode } from '../../persistence/schemas/RuleSetNodeSchema.js';
import type { PersistedPatchNode } from '../../persistence/schemas/PatchNodeSchema.js';
import type { PersistedDuckDbEtlNode } from '../../persistence/schemas/DuckDbEtlNodeSchema.js';
import type { PersistedStartNode } from '../../persistence/schemas/StartNodeSchema.js';
import type { PersistedEndNode } from '../../persistence/schemas/EndNodeSchema.js';
import type { PersistedQueryEdge, WhenEmptyMode } from '../../persistence/schemas/QueryEdgeSchema.js';
import type { PersistedQueryGroupVersion } from '../../persistence/schemas/QueryGroupVersionSchema.js';
import type { PersistedQueryInputVariable } from '../../persistence/schemas/QueryInputVariableSchema.js';
import type { PersistedQueryOutputVariable } from '../../persistence/schemas/QueryOutputVariableSchema.js';
import type { PersistedQueryInputTuple } from '../../persistence/schemas/QueryInputTupleSchema.js';
import type { PersistedQueryOutputTuple } from '../../persistence/schemas/QueryOutputTupleSchema.js';
import type { PersistedTupleMember } from '../../persistence/schemas/TupleMemberSchema.js';
import type { PersistedBackend } from '../../persistence/schemas/BackendSchema.js';
import type { PersistedTriplesQuadsIO } from '../../persistence/schemas/TriplesQuadsIOSchema.js';
import type { PersistedBooleanIO } from '../../persistence/schemas/BooleanIOSchema.js';
import type { PersistedQueryIdInput } from '../../persistence/schemas/QueryIdInputSchema.js';
import type { PersistedRuleSetVersion } from '../../persistence/schemas/RuleSetVersionSchema.js';
import type { PersistedEtlJobVersion } from '../../persistence/schemas/EtlJobVersionSchema.js';

import type { ArgumentSet, SparqlResultsJson } from '../query-chaining.js';
import type { QueryTypeValue } from '../../constants/queryTypes.js';

// Re-export types with shorter names for orchestration
export type {
  PersistedQueryVersion as QueryVersion,
  PersistedQueryNode as QueryNode,
  PersistedDynamicQueryNode as DynamicQueryNode,
  PersistedRuleSetNode as RuleSetNode,
  PersistedPatchNode as PatchNode,
  PersistedDuckDbEtlNode as DuckDbEtlNode,
  PersistedStartNode as StartNode,
  PersistedEndNode as EndNode,
  PersistedQueryEdge as QueryEdge,
  PersistedQueryGroupVersion as QueryGroupVersion,
  PersistedQueryInputVariable as QueryInputVariable,
  PersistedQueryOutputVariable as QueryOutputVariable,
  PersistedQueryInputTuple as QueryInputTuple,
  PersistedQueryOutputTuple as QueryOutputTuple,
  PersistedTupleMember as TupleMember,
  PersistedBackend as Backend,
  PersistedTriplesQuadsIO as TriplesQuadsIO,
  PersistedBooleanIO as BooleanIO,
  PersistedQueryIdInput as QueryIdInput,
  PersistedRuleSetVersion as RuleSetVersion,
  PersistedEtlJobVersion as EtlJobVersion,
  ArgumentSet,
  SparqlResultsJson,
};

/**
 * Edge flow type - distinguishes between control flow and data flow edges
 */
export type EdgeFlowType =
  | 'CONTROL_FLOW'        // Execution dependency only (no data transfer)
  | 'VARIABLE_BINDINGS'   // SELECT tuple → VALUES tuple (standard query chaining)
  | 'RDF_GRAPH'           // CONSTRUCT/DESCRIBE RDF → RDF input
  | 'BOOLEAN'             // ASK boolean → boolean input
  | 'QUERY_ID'            // QueryOutputTuple (length 1) → DynamicQueryNode's queryId
  | 'DATASET';            // QueryOutputTuple (length 1) of graph IRIs → the target query's FROM / FROM NAMED

export const EDGE_FLOW_TYPES = [
  'CONTROL_FLOW',
  'VARIABLE_BINDINGS',
  'RDF_GRAPH',
  'BOOLEAN',
  'QUERY_ID',
  'DATASET'
] as const;

/**
 * Data flow types (subset of EdgeFlowType that actually transfer data)
 */
export type DataFlowType = Exclude<EdgeFlowType, 'CONTROL_FLOW'>;

export const DATA_FLOW_TYPES: DataFlowType[] = [
  'VARIABLE_BINDINGS',
  'RDF_GRAPH',
  'BOOLEAN',
  'QUERY_ID',
  'DATASET'
] as const;

/**
 * Which part of its target's dataset a `DATASET` edge fills: the default
 * graph (`FROM`), the named graphs (`FROM NAMED`), or both, which restricts
 * the whole query to the selected graphs.
 */
export type DatasetPart = 'default' | 'named' | 'both';

export const DATASET_PARTS: readonly DatasetPart[] = ['default', 'named', 'both'];

/**
 * Checks if an edge flow type requires I/O entity references
 */
export function requiresIOReferences(flowType: EdgeFlowType | null | undefined): boolean {
  return flowType !== null && flowType !== undefined && flowType !== 'CONTROL_FLOW';
}

/**
 * Checks if target node must be DynamicQueryNode
 */
export function requiresDynamicQueryNode(flowType: EdgeFlowType | null | undefined): boolean {
  return flowType === 'QUERY_ID';
}

/**
 * Output I/O entity types
 */
export type OutputIOEntity =
  | PersistedQueryOutputTuple
  | PersistedTriplesQuadsIO
  | PersistedBooleanIO;

/**
 * Input I/O entity types
 */
export type InputIOEntity =
  | PersistedQueryInputTuple
  | PersistedTriplesQuadsIO
  | PersistedBooleanIO
  | PersistedQueryIdInput;

export const OUTPUT_IO_TYPES = [
  'QueryOutputTuple',
  'TriplesQuadsIO',
  'BooleanIO'
] as const;

export const INPUT_IO_TYPES = [
  'QueryInputTuple',
  'TriplesQuadsIO',
  'BooleanIO',
  'QueryIdInput'
] as const;

export type OutputIOType = typeof OUTPUT_IO_TYPES[number];
export type InputIOType = typeof INPUT_IO_TYPES[number];

export interface BackendConfig {
  type: 'ephemeral-oxigraph';
  storeId: string;
}

export interface ResolvedNode {
  id: string;
  raw: PersistedQueryNode | PersistedDynamicQueryNode | PersistedRuleSetNode | PersistedPatchNode | PersistedDuckDbEtlNode | PersistedStartNode | PersistedEndNode | Record<string, any>;
  backendId: string | undefined;
  queryVersionId: string | undefined;
  queryVersion: PersistedQueryVersion | undefined;
  queryString: string | undefined;
  queryType: QueryTypeValue | undefined | null;
  ruleSetVersionId?: string;
  ruleSetVersion?: PersistedRuleSetVersion;
  etlJobVersionId?: string;
  etlJobVersion?: PersistedEtlJobVersion;
  /** PatchNode: the port carrying the quads the update would remove. */
  deletionsOutputId?: string;
  /** PatchNode: the port carrying the quads the update would add. */
  additionsOutputId?: string;
  inputTupleIds: string[];
  outputTupleIds: string[];
  backendConfig?: BackendConfig;
  /**
   * True when downstream nodes need this node's results materialized into an ephemeral store.
   * Computed by the execution graph planner; defaults to false.
   */
  needsEphemeralMaterialization?: boolean;
}

export interface ResolvedEdge {
  id: string;
  raw: PersistedQueryEdge;
  sourceNodeId: string;
  targetNodeId: string;
  dataFlowType?: EdgeFlowType | null;
  sourceOutputId?: string | null; // Generic reference to output I/O entity
  targetInputId?: string | null; // Generic reference to input I/O entity
  variableMappings?: string | null;
  whenEmpty?: WhenEmptyMode | null; // Policy when this connection supplies no rows
  /** `DATASET` edges only: the part of the target's dataset it fills. Defaults to `both`. */
  datasetPart?: DatasetPart;
}

export interface ExecutionGraph {
  groupVersion: PersistedQueryGroupVersion;
  nodes: Map<string, ResolvedNode>;
  edges: ResolvedEdge[];
  incomingEdges: Map<string, ResolvedEdge[]>;
  outgoingEdges: Map<string, ResolvedEdge[]>;
  startNodeIds: string[];
  endNodeIds: string[];
}

export type UpdateAck = { success: true };

export type NodeResult = SparqlResultsJson | string | boolean | UpdateAck | undefined;

export type FinalResult = {
  result: NodeResult;
  resultNodeId?: string;
};
