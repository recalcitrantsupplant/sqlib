/**
 * LDKit Schema for QueryOutputTuple Entity
 * 
 * Represents user-defined ordered groupings of SELECT variables from a query.
 * These tuples are created at design time to enable linking query outputs 
 * to input parameter tuples of other queries through position-based mapping.
 */

import type { Schema } from '../schema.js';
import { ldkit, sqlib, sdo } from '../namespaces.js';

export const QueryOutputTupleSchema = {
  '@type': sqlib.QueryOutputTuple,
  name: {
    '@id': sdo.name,
  },
  outputType: {
    '@id': sqlib.outputType,
    '@optional': true,
  },
  memberEntries: {
    '@id': sqlib.memberEntries,
    '@array': true,
    '@type': ldkit.IRI,
  },
} as const satisfies Schema;

export interface LdkitQueryOutputTuple {
  '$id': string;
  '@type'?: 'QueryOutputTuple';
  name: string; // User-defined name for the tuple (e.g., "entity-properties")
  outputType?: 'outputTuple' | 'RDFGraph' | 'Boolean' | null; // Type of output data
  memberEntries: string[]; // Array of TupleMember IRIs (ordered by position field)
}
