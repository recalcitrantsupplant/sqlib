/**
 * LDKit Schema for ArgumentScalarBinding Entity
 *
 * Represents LIMIT/OFFSET overrides captured inside an argument set.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib } from '../namespaces.js';

export const ArgumentScalarBindingSchema = {
  '@type': sqlib.ArgumentScalarBinding,
  parameterKind: {
    '@id': sqlib.parameterKind,
  },
  parameterName: {
    '@id': sqlib.parameterName,
  },
  numericValue: {
    '@id': sqlib.numericValue,
    '@type': xsd.integer,
  },
  parameterIri: {
    '@id': sqlib.parameterIri,
    '@type': ldkit.IRI,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitArgumentScalarBinding {
  '$id': string;
  '@type'?: 'ArgumentScalarBinding';
  parameterKind: 'limit' | 'offset';
  parameterName: string;
  numericValue: number;
  parameterIri?: string | null;
}
