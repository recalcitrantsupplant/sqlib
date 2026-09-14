/**
 * LDKit Schema for QueryOutputVariable Entity
 * 
 * Represents individual output variables from SPARQL queries.
 * Each output variable has its own IRI for cross-query linking in query composition.
 * 
 * NOTE: This is different from "outputs" on QueryNode/DynamicQueryNode, which are
 * generic I/O slots that reference tuples or RDF graphs.
 */

import type { Schema } from '../schema.js';
import { sqlib, sdo } from '../namespaces.js';

export const QueryOutputVariableSchema = {
  '@type': sqlib.QueryOutputVariable,
  variableName: {
    '@id': sqlib.variableName,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitQueryOutputVariable {
  '$id': string;
  '@type'?: 'QueryOutputVariable';
  variableName: string;
  description?: string | null; // Optional description for documentation
}
