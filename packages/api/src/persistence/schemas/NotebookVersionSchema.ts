/**
 * Entity schema for NotebookVersion.
 *
 * An immutable snapshot of a notebook document. The document is held as one
 * JSON string in `contentString`, the pattern the catalog uses for content: a
 * query version stores no AST and a data graph version no triples. The format
 * is `sqlib-notebook/1`, checked on write by `NotebookVersionWriter`.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib, sdo } from '../namespaces.js';

export const NotebookVersionSchema = {
  '@type': sqlib.NotebookVersion,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': sqlib.IRI,
    '@references': { types: ['Notebook'] },
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
  contentString: {
    '@id': sqlib.contentString,
    '@type': xsd.string,
  },
  byteSize: {
    '@id': sqlib.byteSize,
    '@type': xsd.integer,
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

export interface PersistedNotebookVersion {
  $id: string;
  '@type'?: 'NotebookVersion';
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  /** The notebook document, `sqlib-notebook/1`, as JSON. */
  contentString: string;
  byteSize?: number | null;
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
