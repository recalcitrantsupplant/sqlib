/**
 * Entity schema for QueryEdge Entity
 * 
 * This entity represents connections between QueryNodes in a query graph.
 */

import type { Schema } from '../schema.js';
import { sqlib } from '../namespaces.js';

export const QueryEdgeSchema = {
  '@type': sqlib.QueryEdge,
  sourceNodeId: {
    '@id': sqlib.sourceNodeId,
    '@type': sqlib.IRI,
    '@optional': true,
  },
  targetNodeId: {
    '@id': sqlib.targetNodeId,
    '@type': sqlib.IRI,
    '@optional': true,
  },
  sourceLocalId: {
    '@id': sqlib.sourceLocalId,
    '@optional': true,
  },
  targetLocalId: {
    '@id': sqlib.targetLocalId,
    '@optional': true,
  },
  dataFlowType: {
    '@id': sqlib.dataFlowType,
    '@optional': true,
  },
  sourceOutputId: {
    '@id': sqlib.sourceOutputId,
    '@type': sqlib.IRI,
    '@optional': true,
  },
  targetInputId: {
    '@id': sqlib.targetInputId,
    '@type': sqlib.IRI,
    '@optional': true,
  },
  // JSON array of { source: string, target: string }; variables are named rather
  // than addressed by member IDs so mappings survive query-version IRI remapping.
  variableMappings: {
    '@id': sqlib.variableMappings,
    '@optional': true,
  },
  whenEmpty: {
    '@id': sqlib.whenEmpty,
    '@optional': true,
  },
  // DATASET edges only: "default" | "named" | "both" (the default).
  datasetPart: {
    '@id': sqlib.datasetPart,
    '@optional': true,
  },
} as const satisfies Schema;

/** How a parameter slot is rewritten when its input supplies no bound rows. */
export type WhenEmptyMode = 'unconstrained' | 'propagateEmpty' | 'require';

export const WHEN_EMPTY_MODES: readonly WhenEmptyMode[] = ['unconstrained', 'propagateEmpty', 'require'];

export interface PersistedQueryEdge {
  '$id': string;
  '@type'?: 'QueryEdge';
  sourceNodeId?: string | null; // Optional at creation, resolved from sourceLocalId
  targetNodeId?: string | null; // Optional at creation, resolved from targetLocalId
  sourceLocalId?: string | null; // Optional - local reference to source node (design-time)
  targetLocalId?: string | null; // Optional - local reference to target node (design-time)
  dataFlowType?: string | null; // "CONTROL_FLOW" | "VARIABLE_BINDINGS" | "RDF_GRAPH" | "BOOLEAN" | "QUERY_ID" | "DATASET"
  sourceOutputId?: string | null; // Generic reference to output I/O entity (QueryOutputTuple, TriplesQuadsIO, BooleanIO)
  targetInputId?: string | null; // Generic reference to input I/O entity (QueryInputTuple, TriplesQuadsIO, BooleanIO)
  variableMappings?: string | null;
  /**
   * Author's policy for this connection when the upstream supplies no bound rows.
   * It lives on the edge, not the input tuple, because tuples are minted by the
   * QueryVersion (as `inferredInputs`) and shared by every group that uses that
   * query - a policy stored there would leak across groups and would mean writing
   * to a potentially immutable entity. Unset means the defaults apply: an empty
   * set that arrived propagates as empty; an absent external parameter runs open.
   */
  whenEmpty?: string | null; // "unconstrained" | "propagateEmpty" | "require"
  /**
   * For a DATASET edge, which part of the target query's dataset it fills.
   * Unset means `both`. A DATASET edge defaults to `propagateEmpty` and refuses
   * `unconstrained`: an upstream that selected no graphs must not let the
   * target run over the backend's whole dataset.
   */
  datasetPart?: string | null; // "default" | "named" | "both"
}
