/**
 * Entity schema for TupleMember Entity
 * 
 * Represents a single member in an ordered tuple with position and variable IRI.
 * Used by both QueryInputTuple and QueryOutputTuple to maintain order.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib } from '../namespaces.js';

export const TupleMemberSchema = {
  '@type': sqlib.TupleMember,
  position: {
    '@id': sqlib.position,
    '@type': xsd.integer,
  },
  variable: {
    '@id': sqlib.variable,
    '@type': sqlib.IRI,
  },
} as const satisfies Schema;

export interface PersistedTupleMember {
  '$id': string;
  '@type'?: 'TupleMember';
  position: number; // 0-based position in the tuple
  variable: string; // IRI reference to a QueryInputVariable or QueryOutputVariable entity
}
