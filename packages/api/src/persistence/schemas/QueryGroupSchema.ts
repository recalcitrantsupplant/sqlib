/**
 * LDKit Schema for QueryGroup Entity (Stable Pointer)
 * 
 * Represents a stable query group entity that points to versioned group implementations.
 * The stable IRI never changes, but currentVersion points to the latest QueryGroupVersion.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const QueryGroupSchema = {
  '@type': sqlib.QueryGroup,
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
    '@references': { types: ['QueryGroupVersion'] },
    // The number lives on the version; callers listing these want it
    // beside the entity. See `Property['@projects']`.
    '@projects': { as: 'currentVersionNumber', property: 'version' },
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
  /**
   * The data graph the web app selects for each input when this opens, by
   * position. A browser default: execution never reads it. Written through
   * `PUT /:id/browser-defaults`.
   */
  browserDefaultDataGraphs: {
    '@id': sqlib.browserDefaultDataGraphs,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
    '@readOnly': true,
    '@references': { types: ['BrowserDefaultDataGraph'] },
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
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['Library'] },
  },
  tags: {
    '@id': sqlib.hasTag,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
    '@references': { types: ['Tag'] },
  },
  argumentSets: {
    '@id': sqlib.argumentSets,
    '@array': true,
    '@type': ldkit.IRI,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitQueryGroup {
  $id: string;
  '@type'?: 'QueryGroup';
  name: string;
  description?: string | null;
  currentVersion?: string | null; // IRI pointing to latest QueryGroupVersion
  browserDefaultArgumentSet?: string | null;
  browserDefaultDataGraphs?: string[] | null;
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
  isPartOf: string; // Reference to Library (required)
  tags?: string[] | null;
  argumentSets?: string[] | null;
}
