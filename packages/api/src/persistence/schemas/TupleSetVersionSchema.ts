/**
 * LDKit Schema for TupleSetVersion Entity
 *
 * Immutable tabular content, so a run naming a version id is reproducible
 * forever — the same contract `DataGraphVersion` offers for RDF.
 *
 * `contentString` holds a **standard SPARQL Results JSON document**
 * (`{"head": {"vars": […]}, "results": {"bindings": […]}}`), never the app's
 * arguments-JSON. The two are different serialisations of different things: SRJ
 * serialises a table, arguments-JSON serialises a *call* (it adds `whenEmpty`
 * and one element per clause of a target's signature). Calls are stored as
 * pins, tables as SRJ, so each format has exactly one home.
 *
 * Content is one string rather than an entity per cell. The catalog's existing
 * pattern is *content is a string; shape and metadata are entities* —
 * `QueryVersion.queryString` stores no AST, `DataGraphVersion.contentString` no
 * triples-as-entities — and `tupleColumns`/`rowCount` are that metadata, lifted
 * out so listings and compatibility verdicts never parse content.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

/**
 * Where a version's rows came from. Provenance only — content is always SRJ.
 *
 * `etl-results` is its own value rather than a reuse of `query-results`
 * (issue #211): `query-results` means "a SPARQL query's SRJ, saved in place",
 * and an ETL run is a different production — DuckDB rows typed by a column
 * mapping, with no SPARQL query and no backend anywhere in the story. The two
 * differ in what a reader can conclude about the content, which is the only
 * thing this field is for.
 */
export const TUPLE_SOURCE_FORMATS = [
  'csv',
  'tsv',
  'sparql-results-tsv',
  'sparql-results-json',
  'query-results',
  'etl-results',
] as const;

export type TupleSourceFormat = (typeof TUPLE_SOURCE_FORMATS)[number];

export const TupleSetVersionSchema = {
  '@type': sqlib.TupleSetVersion,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['TupleSet'] },
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
  /** A SPARQL Results JSON document. */
  contentString: {
    '@id': sqlib.contentString,
    '@type': xsd.string,
  },
  sourceFormat: {
    '@id': sqlib.sourceFormat,
    '@optional': true,
  },
  /**
   * `head.vars`, in order — the version's signature. Stored rather than derived
   * so a library listing can draw arity and column names, and a compatibility
   * verdict can be computed, without reading a megabyte of content.
   */
  tupleColumns: {
    '@id': sqlib.tupleColumns,
    '@array': true,
    '@optional': true,
  },
  rowCount: {
    '@id': sqlib.rowCount,
    '@type': xsd.integer,
    '@optional': true,
  },
  byteSize: {
    '@id': sqlib.byteSize,
    '@type': xsd.integer,
    '@optional': true,
  },
  /**
   * Provenance for a version materialized by running an ETL job's SQL
   * (issue #211), the tabular twin of `DataGraphVersion.sourceQueryVersion`
   * and friends. Versions are immutable snapshots, so this records what
   * produced the rows, not a live link that could drift: the mapping version
   * is here because it — not the SQL alone — decides the columns and their
   * types.
   */
  sourceEtlJobVersion: {
    '@id': sqlib.sourceEtlJobVersion,
    '@type': ldkit.IRI,
    '@references': { types: ['EtlJobVersion'] },
    '@optional': true,
  },
  sourceColumnMappingVersion: {
    '@id': sqlib.sourceColumnMappingVersion,
    '@type': ldkit.IRI,
    '@references': { types: ['EtlColumnMappingVersion'] },
    '@optional': true,
  },
  sourceExecutedAt: {
    '@id': sqlib.sourceExecutedAt,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  /** SHA-256 over the stored SRJ document — rows are ordered, so no sorting. */
  sourceResultHash: {
    '@id': sqlib.sourceResultHash,
    '@type': xsd.string,
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

export interface LdkitTupleSetVersion {
  $id: string;
  '@type'?: 'TupleSetVersion';
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  contentString: string;
  sourceFormat?: TupleSourceFormat | null;
  tupleColumns?: string[] | null;
  rowCount?: number | null;
  byteSize?: number | null;
  sourceEtlJobVersion?: string | null;
  sourceColumnMappingVersion?: string | null;
  sourceExecutedAt?: string | null;
  sourceResultHash?: string | null;
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
