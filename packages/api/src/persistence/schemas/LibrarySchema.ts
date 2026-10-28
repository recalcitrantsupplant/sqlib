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
} as const satisfies Schema;

export interface LdkitLibrary {
  $id: string;
  '@type'?: 'Library';
  name: string;
  description?: string | null;
  defaultBackend?: string | null;
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
}
