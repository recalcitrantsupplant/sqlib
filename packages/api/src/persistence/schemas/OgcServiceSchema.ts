/**
 * Entity schema for OgcService (stable pointer).
 *
 * An OGC API Features service: a slug, which is its path under `/ogc/`, a
 * title and a description. Its collections are on the version
 * (`OgcServiceVersion`). See `docs/proposals/ogc-services.md`.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib, sdo } from '../namespaces.js';
import { AUTHORSHIP_PROPERTIES } from '../authorship.js';

export const OgcServiceSchema = {
  '@type': sqlib.OgcService,
  name: {
    '@id': sdo.name,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  /** The service's path under `/ogc/`: one segment, unique in the deployment. */
  slug: {
    '@id': sqlib.slug,
    '@type': xsd.string,
  },
  currentVersion: {
    '@id': sqlib.currentVersion,
    '@type': sqlib.IRI,
    '@optional': true,
    '@references': { types: ['OgcServiceVersion'] },
    '@projects': { as: 'currentVersionNumber', property: 'version' },
  },
  isPartOf: {
    '@id': sdo.isPartOf,
    '@array': true,
    '@type': sqlib.IRI,
    '@references': { types: ['Library'], exactlyOne: 'Library' },
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

export interface PersistedOgcService {
  $id: string;
  '@type'?: 'OgcService';
  name: string;
  description?: string | null;
  slug: string;
  currentVersion?: string | null;
  isPartOf: string[];
  dateCreated?: string | null;
  dateModified?: string | null;
  createdBy?: string | null;
  modifiedBy?: string | null;
}
