/**
 * LDKit Schema for QueryInputVariable Entity
 * 
 * Represents individual input variables within input tuples for SPARQL queries.
 * Each input variable has its own IRI for cross-query linking.
 * 
 * NOTE: This is different from "inputs" on QueryNode/DynamicQueryNode, which are
 * generic I/O slots that reference tuples or RDF graphs.
 */

import type { Schema } from '../schema.js';
import { ldkit, sqlib } from '../namespaces.js';

export const QueryInputVariableSchema = {
  '@type': sqlib.QueryInputVariable,
  variableName: {
    '@id': sqlib.variableName,
  },
  allowedTypes: {
    '@id': sqlib.allowedTypes,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitQueryInputVariable {
  '$id': string;
  '@type'?: 'QueryInputVariable';
  variableName: string;
  allowedTypes?: string[];
}
