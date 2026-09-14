/**
 * LDKit Schema for EtlColumnMappingVersion Entity (Immutable Version)
 *
 * Represents an immutable snapshot of column mapping configuration.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const EtlColumnMappingVersionSchema = {
  '@type': sqlib.EtlColumnMappingVersion,
  isPartOf: {
    '@id': sdo.isPartOf, // points to the parent EtlColumnMapping
    '@type': ldkit.IRI,
    '@references': { types: ['EtlColumnMapping'] },
  },
  version: {
    '@id': sdo.version,
    '@type': xsd.integer,
  },
  immutable: {
    '@id': sqlib.isImmutable,
    '@type': xsd.boolean,
    '@optional': true,
  },
  columns: {
    '@id': sqlib.columns,
    '@type': xsd.string, // JSON string
  },
  comment: {
    '@id': sdo.comment,
    '@optional': true,
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

/**
 * Column definition structure (parsed from JSON string in columns field)
 */
export interface ColumnDefinition {
  columnName: string; // must match SQL output alias
  targetVariable: string; // without '?', e.g. 'customer', 'price'
  termType: 'uri' | 'literal';
  datatypeIri?: string; // for literals, e.g. 'http://www.w3.org/2001/XMLSchema#decimal'
  lang?: string; // for literals, e.g. 'en'
  iriTemplate?: string; // e.g. 'http://ex/customer/{value}'
  nullPolicy: 'undef' | 'skipRow'; // default 'undef'
}

export interface LdkitEtlColumnMappingVersion {
  $id: string;
  '@type'?: 'EtlColumnMappingVersion';
  isPartOf: string; // IRI back to stable EtlColumnMapping
  version: number; // 1, 2, 3...
  immutable?: boolean | null;
  columns: string; // JSON string of ColumnDefinition[]
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
