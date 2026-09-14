/**
 * LDKit Schema for QueryEdge Entity
 * 
 * This entity represents connections between QueryNodes in a query graph.
 */

import type { Schema } from '../schema.js';
import { ldkit, sqlib, sdo } from '../namespaces.js';

export const QueryEdgeSchema = {
  '@type': sqlib.QueryEdge,
  sourceNodeId: {
    '@id': sqlib.sourceNodeId,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  targetNodeId: {
    '@id': sqlib.targetNodeId,
    '@type': ldkit.IRI,
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
    '@type': ldkit.IRI,
    '@optional': true,
  },
  targetInputId: {
    '@id': sqlib.targetInputId,
    '@type': ldkit.IRI,
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
} as const satisfies Schema;

/** How a parameter slot is rewritten when its input supplies no bound rows. */
export type WhenEmptyMode = 'unconstrained' | 'propagateEmpty' | 'require';

export const WHEN_EMPTY_MODES: readonly WhenEmptyMode[] = ['unconstrained', 'propagateEmpty', 'require'];

export interface LdkitQueryEdge {
  '$id': string;
  '@type'?: 'QueryEdge';
  sourceNodeId?: string | null; // Optional at creation, resolved from sourceLocalId
  targetNodeId?: string | null; // Optional at creation, resolved from targetLocalId
  sourceLocalId?: string | null; // Optional - local reference to source node (design-time)
  targetLocalId?: string | null; // Optional - local reference to target node (design-time)
  dataFlowType?: string | null; // "CONTROL_FLOW" | "VARIABLE_BINDINGS" | "RDF_GRAPH" | "BOOLEAN" | "QUERY_ID"
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
}
