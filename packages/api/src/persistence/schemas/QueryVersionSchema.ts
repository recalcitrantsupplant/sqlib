/**
 * LDKit Schema for QueryVersion Entity (Immutable Version)
 * 
 * Represents an immutable version of a query. Each version has a stable
 * parent Query and contains the actual SPARQL query string and metadata.
 * Previously called StoredQuerySchema.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';
import { QueryTypeIri as QueryTypeIriConst, type QueryTypeKey, type QueryTypeValue } from '../../constants/queryTypes.js';

export const QueryTypeIri = QueryTypeIriConst;
export type { QueryTypeKey, QueryTypeValue };

export const QueryVersionSchema = {
  '@type': sqlib.QueryVersion,
  isPartOf: {
    '@id': sdo.isPartOf,  // points to the parent QuerySchema
    '@type': ldkit.IRI,
    '@references': { types: ['Query'] },
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
  queryString: {
    '@id': sqlib.query,
    '@type': xsd.string,
  },
  comment: {
    '@id': sdo.comment,
    '@optional': true,
  },
  queryType: {
    '@id': sqlib.queryType,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /*
   * Whether this version's query converts to a single SRL rule — the filter the
   * rule-import picker runs on, so a library of mostly-SELECT queries does not
   * offer rows that all refuse to import.
   *
   * Stored rather than computed per request because the picker would otherwise
   * parse every query in the library on every open, while a version is immutable
   * and the write path already parses its query once. It is a *hint*, though,
   * not the authority: the import itself still runs the converter, which is what
   * decides. A stale flag can therefore only mis-list a query, never produce a
   * wrong rule — see `srlImportRevision`.
   */
  srlImportable: {
    '@id': sqlib.srlImportable,
    '@type': xsd.boolean,
    '@optional': true,
  },
  /**
   * The `SRL_IMPORT_REVISION` that decided `srlImportable`.
   *
   * The whitelist keeps moving — accepting INSERT … WHERE alongside CONSTRUCT
   * just turned a class of stored `false`s into lies — and a version is
   * immutable, so the flag cannot be corrected in place by the thing that
   * invalidated it. Recording the revision lets a reader tell a current verdict
   * from a superseded one, and lets a backfill select exactly the versions worth
   * recomputing.
   */
  srlImportRevision: {
    '@id': sqlib.srlImportRevision,
    '@type': xsd.integer,
    '@optional': true,
  },
  limitParameters: {
    '@id': sqlib.limitParameters,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  offsetParameters: {
    '@id': sqlib.offsetParameters,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  inferredInputs: {
    '@id': sqlib.inferredInputs,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  inferredOutputs: {
    '@id': sqlib.inferredOutputs,
    '@array': true,
    '@type': ldkit.IRI,
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

export interface LdkitQueryVersion {
  $id: string;
  '@type'?: 'QueryVersion';
  isPartOf: string; // IRI back to stable Query
  version: number; // 1, 2, 3... (API/UI-friendly numeric version)
  immutable?: boolean | null;
  queryString: string;
  comment?: string | null;
  queryType?: QueryTypeValue | null;
  srlImportable?: boolean | null; // Converts to a single SRL rule (advisory; see schema)
  srlImportRevision?: number | null; // The SRL_IMPORT_REVISION that decided srlImportable
  limitParameters?: string[];
  offsetParameters?: string[];
  inferredInputs?: string[]; // References to inferred QueryInputTuple entities (from VALUES clauses)
  inferredOutputs?: string[]; // References to inferred/canonical outputs based on query type
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string for optimistic concurrency control
}
