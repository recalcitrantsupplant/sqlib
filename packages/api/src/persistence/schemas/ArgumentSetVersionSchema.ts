/**
 * Entity schema for ArgumentSetVersion Entity
 *
 * Immutable versions of argument set bindings for reproducible execution.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib, sdo } from '../namespaces.js';

export const ArgumentSetVersionSchema = {
  '@type': sqlib.ArgumentSetVersion,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': sqlib.IRI,
    '@references': { types: ['ArgumentSet'] },
  },
  version: {
    '@id': sdo.version,
    '@type': xsd.integer,
  },
  tupleBindings: {
    '@id': sqlib.tupleBindings,
    '@array': true,
    '@type': sqlib.IRI,
    '@optional': true,
    '@references': { types: ['ArgumentTupleBinding'] },
  },
  scalarBindings: {
    '@id': sqlib.scalarBindings,
    '@array': true,
    '@type': sqlib.IRI,
    '@optional': true,
    '@references': { types: ['ArgumentScalarBinding'] },
  },
  dateCreated: {
    '@id': sdo.dateCreated,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  dateModified: {
    '@id': sdo.dateModified,
    '@type': xsd.dateTime,
    '@optional': true,
  },
} as const satisfies Schema;

export interface PersistedArgumentSetVersion {
  '$id': string;
  '@type'?: 'ArgumentSetVersion';
  isPartOf: string;
  version: number;
  tupleBindings?: string[] | null;
  scalarBindings?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
