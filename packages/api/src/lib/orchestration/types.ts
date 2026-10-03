import type { QueryVersionEntity } from '../../persistence/schemas/QueryVersionSchema.js';
import type { QueryNodeEntity } from '../../persistence/schemas/QueryNodeSchema.js';
import type { DynamicQueryNodeEntity } from '../../persistence/schemas/DynamicQueryNodeSchema.js';
import type { RuleSetNodeEntity } from '../../persistence/schemas/RuleSetNodeSchema.js';
import type { PatchNodeEntity } from '../../persistence/schemas/PatchNodeSchema.js';
import type { DuckDbEtlNodeEntity } from '../../persistence/schemas/DuckDbEtlNodeSchema.js';
import type { StartNodeEntity } from '../../persistence/schemas/StartNodeSchema.js';
import type { EndNodeEntity } from '../../persistence/schemas/EndNodeSchema.js';
import type { QueryEdgeEntity, WhenEmptyMode } from '../../persistence/schemas/QueryEdgeSchema.js';
import type { QueryGroupVersionEntity } from '../../persistence/schemas/QueryGroupVersionSchema.js';
import type { QueryInputVariableEntity } from '../../persistence/schemas/QueryInputVariableSchema.js';
import type { QueryOutputVariableEntity } from '../../persistence/schemas/QueryOutputVariableSchema.js';
import type { QueryInputTupleEntity } from '../../persistence/schemas/QueryInputTupleSchema.js';
import type { QueryOutputTupleEntity } from '../../persistence/schemas/QueryOutputTupleSchema.js';
import type { TupleMemberEntity } from '../../persistence/schemas/TupleMemberSchema.js';
import type { BackendEntity } from '../../persistence/schemas/BackendSchema.js';
import type { TriplesQuadsIOEntity } from '../../persistence/schemas/TriplesQuadsIOSchema.js';
import type { BooleanIOEntity } from '../../persistence/schemas/BooleanIOSchema.js';
import type { QueryIdInputEntity } from '../../persistence/schemas/QueryIdInputSchema.js';
import type { RuleSetVersionEntity } from '../../persistence/schemas/RuleSetVersionSchema.js';
import type { EtlJobVersionEntity } from '../../persistence/schemas/EtlJobVersionSchema.js';

import type { ArgumentSet, SparqlResultsJson } from '../query-chaining.js';
import type { QueryTypeValue } from '../../constants/queryTypes.js';

// Re-export types with shorter names for orchestration
export type {
  QueryVersionEntity as QueryVersion,
  QueryNodeEntity as QueryNode,
  DynamicQueryNodeEntity as DynamicQueryNode,
  RuleSetNodeEntity as RuleSetNode,
  PatchNodeEntity as PatchNode,
  DuckDbEtlNodeEntity as DuckDbEtlNode,
  StartNodeEntity as StartNode,
  EndNodeEntity as EndNode,
  QueryEdgeEntity as QueryEdge,
  QueryGroupVersionEntity as QueryGroupVersion,
  QueryInputVariableEntity as QueryInputVariable,
  QueryOutputVariableEntity as QueryOutputVariable,
  QueryInputTupleEntity as QueryInputTuple,
  QueryOutputTupleEntity as QueryOutputTuple,
  TupleMemberEntity as TupleMember,
  BackendEntity as Backend,
  TriplesQuadsIOEntity as TriplesQuadsIO,
  BooleanIOEntity as BooleanIO,
  QueryIdInputEntity as QueryIdInput,
  RuleSetVersionEntity as RuleSetVersion,
  EtlJobVersionEntity as EtlJobVersion,
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
  | 'QUERY_ID';           // QueryOutputTuple (length 1) → DynamicQueryNode's queryId

export const EDGE_FLOW_TYPES = [
  'CONTROL_FLOW',
  'VARIABLE_BINDINGS',
  'RDF_GRAPH',
  'BOOLEAN',
  'QUERY_ID'
] as const;

/**
 * Data flow types (subset of EdgeFlowType that actually transfer data)
 */
export type DataFlowType = Exclude<EdgeFlowType, 'CONTROL_FLOW'>;

export const DATA_FLOW_TYPES: DataFlowType[] = [
  'VARIABLE_BINDINGS',
  'RDF_GRAPH',
  'BOOLEAN',
  'QUERY_ID'
] as const;

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
  | QueryOutputTupleEntity
  | TriplesQuadsIOEntity
  | BooleanIOEntity;

/**
 * Input I/O entity types
 */
export type InputIOEntity =
  | QueryInputTupleEntity
  | TriplesQuadsIOEntity
  | BooleanIOEntity
  | QueryIdInputEntity;

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
  raw: QueryNodeEntity | DynamicQueryNodeEntity | RuleSetNodeEntity | PatchNodeEntity | DuckDbEtlNodeEntity | StartNodeEntity | EndNodeEntity | Record<string, any>;
  backendId: string | undefined;
  queryVersionId: string | undefined;
  queryVersion: QueryVersionEntity | undefined;
  queryString: string | undefined;
  queryType: QueryTypeValue | undefined | null;
  ruleSetVersionId?: string;
  ruleSetVersion?: RuleSetVersionEntity;
  etlJobVersionId?: string;
  etlJobVersion?: EtlJobVersionEntity;
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
  raw: QueryEdgeEntity;
  sourceNodeId: string;
  targetNodeId: string;
  dataFlowType?: EdgeFlowType | null;
  sourceOutputId?: string | null; // Generic reference to output I/O entity
  targetInputId?: string | null; // Generic reference to input I/O entity
  variableMappings?: string | null;
  whenEmpty?: WhenEmptyMode | null; // Policy when this connection supplies no rows
}

export interface ExecutionGraph {
  groupVersion: QueryGroupVersionEntity;
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
