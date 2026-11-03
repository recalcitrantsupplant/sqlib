/**
 * Entity schema for Notebook (stable pointer).
 *
 * A notebook is prose and cells over the library's queries, groups and rule
 * sets (`docs/guides/notebooks.md`). The pointer carries the name and the
 * library; the document itself is on the version. Who may read or edit it is
 * decided by the library it belongs to, as for every other library entity.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib, sdo } from '../namespaces.js';
import { AUTHORSHIP_PROPERTIES } from '../authorship.js';

export const NotebookSchema = {
  '@type': sqlib.Notebook,
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
    '@references': { types: ['NotebookVersion'] },
    '@projects': { as: 'currentVersionNumber', property: 'version' },
  },
  isPartOf: {
    '@id': sdo.isPartOf,
    '@array': true,
    '@type': sqlib.IRI,
    '@references': { types: ['Library'], exactlyOne: 'Library' },
  },
  tags: {
    '@id': sqlib.hasTag,
    '@array': true,
    '@type': sqlib.IRI,
    '@optional': true,
    '@references': { types: ['Tag'] },
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

export interface PersistedNotebook {
  $id: string;
  '@type'?: 'Notebook';
  name: string;
  description?: string | null;
  currentVersion?: string | null;
  isPartOf: string[];
  tags?: string[] | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  createdBy?: string | null;
  modifiedBy?: string | null;
}
