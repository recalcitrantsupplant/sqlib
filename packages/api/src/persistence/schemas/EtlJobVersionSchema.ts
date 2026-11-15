/**
 * Entity schema for EtlJobVersion Entity (Immutable Version)
 *
 * Represents an immutable version of an ETL job. Each version has a stable
 * parent EtlJob and contains the SQL query, SPARQL template, and configuration.
 *
 * The SPARQL template comes from one of two places:
 *
 * - `sparqlTemplate`: the template text, stored on the version.
 * - `templateQuery`: a saved CONSTRUCT query. A `QueryVersion` IRI pins that
 *   version. A `Query` IRI floats: each run uses the query's current version,
 *   and the run records which version that was (`EtlExecution.templateQueryVersion`).
 *
 * A version has exactly one of the two. `lib/etlTemplate.ts` resolves both to text.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib, sdo } from '../namespaces.js';
import { AUTHORSHIP_PROPERTIES } from '../authorship.js';

export const EtlJobVersionSchema = {
  '@type': sqlib.EtlJobVersion,
  isPartOf: {
    '@id': sdo.isPartOf, // points to the parent EtlJob
    '@type': sqlib.IRI,
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
  /** Inline template text. Absent when `templateQuery` is set. */
  sparqlTemplate: {
    '@id': sqlib.sparqlTemplate,
    '@type': xsd.string,
    '@optional': true,
  },
  /** A `QueryVersion` (pinned) or a `Query` (floats to its current version). */
  templateQuery: {
    '@id': sqlib.templateQuery,
    '@type': sqlib.IRI,
    '@optional': true,
    '@references': { types: ['Query', 'QueryVersion'] },
  },
  backendId: {
    '@id': sqlib.backendId,
    '@type': sqlib.IRI,
  },
  currentColumnMappingVersion: {
    '@id': sqlib.currentColumnMappingVersion,
    '@type': sqlib.IRI,
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
  ...AUTHORSHIP_PROPERTIES,
} as const satisfies Schema;

export interface PersistedEtlJobVersion {
  $id: string;
  '@type'?: 'EtlJobVersion';
  isPartOf: string; // IRI back to stable EtlJob
  version: number; // 1, 2, 3...
  immutable?: boolean | null;
  sql: string; // DuckDB SQL query
  sparqlTemplate?: string | null; // SPARQL query with VALUES placeholder; absent when templateQuery is set
  templateQuery?: string | null; // IRI of a QueryVersion (pinned) or a Query (floating)
  backendId: string; // IRI to target Backend for SPARQL execution
  currentColumnMappingVersion?: string | null; // IRI to EtlColumnMappingVersion
  chunkSize?: number | null; // default chunk size for pagination
  comment?: string | null;
  dateCreated?: string | null; // ISO string format
  dateModified?: string | null; // ISO string for optimistic concurrency control
  createdBy?: string | null;
  modifiedBy?: string | null;
}
