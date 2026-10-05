/**
 * LDKit Schema for Query Entity (Stable Pointer)
 * 
 * Represents a stable query entity that points to versioned query implementations.
 * The stable IRI never changes, but currentVersion points to the latest QueryVersion.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

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
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['QueryVersion'] },
    // The number lives on the version. Callers listing queries want it beside
    // the query ("v3"), and this is how they get it without it being stored
    // twice — see `Property['@projects']`.
    '@projects': { as: 'currentVersionNumber', property: 'version' },
  },
  defaultBackend: {
    '@id': sqlib.defaultBackend,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  isPartOf: {
    '@id': sdo.isPartOf,
    '@array': true,
    '@type': ldkit.IRI,
    '@references': { types: ['Library', 'QueryGroup'], exactlyOne: 'Library' },
  },
  tags: {
    '@id': sqlib.hasTag,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['Tag'] },
  },
  /**
   * The argument set the web app selects when this opens: a set, never a
   * version, because the switcher selects a set and picks its version per run.
   * A browser default: execution never reads it. Written through
   * `PUT /:id/browser-defaults`.
   */
  browserDefaultArgumentSet: {
    '@id': sqlib.browserDefaultArgumentSet,
    '@type': ldkit.IRI,
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
  argumentSets: {
    '@id': sqlib.argumentSets,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitQuery {
  $id: string;
  '@type'?: 'Query';
  name: string;
  description?: string | null;
  currentVersion?: string | null; // IRI pointing to latest QueryVersion
  defaultBackend?: string | null; // IRI pointing to default Backend for this query
  isPartOf: string[]; // IRIs - can include query groups and one library
  tags?: string[] | null;
  browserDefaultArgumentSet?: string | null;
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
  argumentSets?: string[] | null;
}
