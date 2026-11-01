/**
 * LDKit Schema for Library Entity
 * 
 * This entity represents collections or libraries of queries and query groups.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const LibrarySchema = {
  '@type': sqlib.Library,
  name: {
    '@id': sdo.name,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  defaultBackend: {
    '@id': sqlib.defaultBackend,
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
  /**
   * The library's name in URLs: `/mcp/{slug}` and `/tools/{slug}/{name}`.
   *
   * Set by the author, never derived from `name`: a rename would then move
   * every client URL. Unique among libraries (checked by the routes, since it
   * needs the store), and required only to publish tools — see
   * `docs/guides/publishing-tools.md`.
   */
  slug: {
    '@id': sqlib.slug,
    '@optional': true,
    '@pattern': '^[a-z0-9-]+$',
  },
  /**
   * Publish every query and group in the library as a tool. An entry whose
   * current version has a `tool` object uses it, one with `tool: false` is
   * left out, and every other entry gets a default tool.
   */
  publishAll: {
    '@id': sqlib.publishAll,
    '@type': xsd.boolean,
    '@optional': true,
  },
} as const satisfies Schema;

export interface LdkitLibrary {
  $id: string;
  '@type'?: 'Library';
  name: string;
  description?: string | null;
  defaultBackend?: string | null;
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
  slug?: string | null;
  publishAll?: boolean | null;
}
