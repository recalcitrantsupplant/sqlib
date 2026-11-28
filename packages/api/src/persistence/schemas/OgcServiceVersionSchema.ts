/**
 * Entity schema for OgcServiceVersion.
 *
 * An immutable snapshot of a service's collections. Each collection names a
 * query in the service's library, optionally pins one of its versions, and
 * holds the `ogc` mapping and the optional JSON-LD terms. Checked on write by
 * `OgcServiceVersionWriter`.
 */

import type { Schema } from '../schema.js';
import type { OgcServiceCollection } from '@sparql-query-lib/tools';
import { rdf, xsd, sqlib, sdo } from '../namespaces.js';
import { AUTHORSHIP_PROPERTIES } from '../authorship.js';

export const OgcServiceVersionSchema = {
  '@type': sqlib.OgcServiceVersion,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': sqlib.IRI,
    '@references': { types: ['OgcService'] },
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
  collections: {
    '@id': sqlib.ogcCollections,
    '@type': rdf.JSON,
    '@jsonShape': 'OgcServiceCollections',
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

export interface PersistedOgcServiceVersion {
  $id: string;
  '@type'?: 'OgcServiceVersion';
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  collections: OgcServiceCollection[];
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  createdBy?: string | null;
  modifiedBy?: string | null;
}
