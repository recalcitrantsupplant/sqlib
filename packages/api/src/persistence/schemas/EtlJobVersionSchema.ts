/**
 * LDKit Schema for EtlJobVersion Entity (Immutable Version)
 *
 * Represents an immutable version of an ETL job. Each version has a stable
 * parent EtlJob and contains the SQL query, SPARQL template, and configuration.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const EtlJobVersionSchema = {
  '@type': sqlib.EtlJobVersion,
  isPartOf: {
    '@id': sdo.isPartOf, // points to the parent EtlJob
    '@type': ldkit.IRI,
    '@references': { types: ['EtlJob'] },
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
  sql: {
    '@id': sqlib.sql,
    '@type': xsd.string,
  },
  sparqlTemplate: {
    '@id': sqlib.sparqlTemplate,
    '@type': xsd.string,
  },
  backendId: {
    '@id': sqlib.backendId,
    '@type': ldkit.IRI,
  },
  currentColumnMappingVersion: {
    '@id': sqlib.currentColumnMappingVersion,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  chunkSize: {
    '@id': sqlib.chunkSize,
    '@type': xsd.integer,
    '@optional': true,
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

export interface LdkitEtlJobVersion {
  $id: string;
  '@type'?: 'EtlJobVersion';
  isPartOf: string; // IRI back to stable EtlJob
  version: number; // 1, 2, 3...
  immutable?: boolean | null;
  sql: string; // DuckDB SQL query
  sparqlTemplate: string; // SPARQL query with VALUES placeholder
  backendId: string; // IRI to target Backend for SPARQL execution
  currentColumnMappingVersion?: string | null; // IRI to EtlColumnMappingVersion
  chunkSize?: number | null; // default chunk size for pagination
  comment?: string | null;
  dateCreated?: string | null; // ISO string format
  dateModified?: string | null; // ISO string for optimistic concurrency control
}
