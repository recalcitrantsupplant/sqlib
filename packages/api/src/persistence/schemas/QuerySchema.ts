/**
 * Entity schema for Query Entity (Stable Pointer)
 * 
 * Represents a stable query entity that points to versioned query implementations.
 * The stable IRI never changes, but currentVersion points to the latest QueryVersion.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib, sdo } from '../namespaces.js';
import { AUTHORSHIP_PROPERTIES } from '../authorship.js';

export const QuerySchema = {
  '@type': sqlib.Query,
  name: {
    '@id': sdo.name,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  currentVersion: {
    '@id': sqlib.currentVersion,
    '@type': sqlib.IRI,
    '@optional': true,
    '@references': { types: ['QueryVersion'] },
    // The number lives on the version. Callers listing queries want it beside
    // the query ("v3"), and this is how they get it without it being stored
    // twice — see `Property['@projects']`.
    '@projects': { as: 'currentVersionNumber', property: 'version' },
  },
  defaultBackend: {
    '@id': sqlib.defaultBackend,
    '@type': sqlib.IRI,
    '@optional': true,
  },
  isPartOf: {
    '@id': sdo.isPartOf,
    '@array': true,
    '@type': sqlib.IRI,
    '@references': { types: ['Library', 'QueryGroup'], exactlyOne: 'Library' },
  },
  tags: {
    '@id': sqlib.hasTag,
    '@array': true,
    '@type': sqlib.IRI,
    '@optional': true,
    '@references': { types: ['Tag'] },
  },
  /**
   * A query that exists only to be a part of a query group. It is never
   * promoted on its own: a group version pins the exact version it runs, so
   * the group carries it into an environment. Published tools leave it out.
   * See `docs/explanation/environments.md`.
   */
  groupOnly: {
    '@id': sqlib.groupOnly,
    '@type': xsd.boolean,
    '@optional': true,
  },
  /**
   * The argument set the web app selects when this opens: a set, never a
   * version, because the switcher selects a set and picks its version per run.
   * A browser default: execution never reads it. Written through
   * `PUT /:id/browser-defaults`.
   */
  browserDefaultArgumentSet: {
    '@id': sqlib.browserDefaultArgumentSet,
    '@type': sqlib.IRI,
    '@optional': true,
    '@readOnly': true,
    '@references': { types: ['ArgumentSet'] },
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
  argumentSets: {
    '@id': sqlib.argumentSets,
    '@array': true,
    '@type': sqlib.IRI,
    '@optional': true,
  },
} as const satisfies Schema;

export interface PersistedQuery {
  $id: string;
  '@type'?: 'Query';
  name: string;
  description?: string | null;
  currentVersion?: string | null; // IRI pointing to latest QueryVersion
  defaultBackend?: string | null; // IRI pointing to default Backend for this query
  isPartOf: string[]; // IRIs - can include query groups and one library
  tags?: string[] | null;
  groupOnly?: boolean | null;
  browserDefaultArgumentSet?: string | null;
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
  createdBy?: string | null;
  modifiedBy?: string | null;
  argumentSets?: string[] | null;
}
