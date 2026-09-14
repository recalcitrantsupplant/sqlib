/**
 * LDKit Schema for OffsetParameter Entity
 * 
 * This entity represents offset parameter definitions for queries.
 * Each offset parameter has an identifier used in SPARQL queries.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib, sdo } from '../namespaces.js';

export const OffsetParameterSchema = {
  '@type': sqlib.OffsetParameter,
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

export interface LdkitOffsetParameter {
  '$id': string;
  '@type'?: 'OffsetParameter';
  name: string; // Required - the name used in SPARQL (e.g., "results-offset")
  value?: number | null; // The actual offset value (e.g., 10 for OFFSET 0001 = 10)
  defaultValue?: number | null; // Default offset value
}
