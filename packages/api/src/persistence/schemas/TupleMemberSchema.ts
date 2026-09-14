/**
 * LDKit Schema for TupleMember Entity
 * 
 * Represents a single member in an ordered tuple with position and variable IRI.
 * Used by both QueryInputTuple and QueryOutputTuple to maintain order.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib } from '../namespaces.js';

export const TupleMemberSchema = {
  '@type': sqlib.TupleMember,
  position: {
    '@id': sqlib.position,
    '@type': xsd.integer,
  },
  variable: {
    '@id': sqlib.variable,
    '@type': ldkit.IRI,
  },
} as const satisfies Schema;

export interface LdkitTupleMember {
  '$id': string;
  '@type'?: 'TupleMember';
  position: number; // 0-based position in the tuple
  variable: string; // IRI reference to a QueryInputVariable or QueryOutputVariable entity
}
