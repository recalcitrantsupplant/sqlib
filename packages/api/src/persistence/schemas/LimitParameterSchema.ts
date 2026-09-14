/**
 * LDKit Schema for LimitParameter Entity
 * 
 * This entity represents limit parameter definitions for queries.
 * Each limit parameter has an identifier used in SPARQL queries.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib, sdo } from '../namespaces.js';

export const LimitParameterSchema = {
  '@type': sqlib.LimitParameter,
  name: {
    '@id': sdo.name,
  },
  value: {
    '@id': sqlib.value,
    '@type': xsd.integer,
    '@optional': true,
  },
  defaultValue: {
    '@id': sqlib.defaultValue,
    '@type': xsd.integer,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitLimitParameter {
  '$id': string;
  '@type'?: 'LimitParameter';
  name: string; // Required - the name used in SPARQL (e.g., "page-size-limit")
  value?: number | null; // The actual limit value (e.g., 1 for LIMIT 0001 = 1)
  defaultValue?: number | null; // Default limit value
}
