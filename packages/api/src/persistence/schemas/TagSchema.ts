/**
 * LDKit Schema for Tag Entity
 *
 * A tag classifies entities inside one library. It is not a container: nothing
 * is `sdo:isPartOf` a tag, and deleting one unlabels rather than cascading.
 * That is the whole distinction this entity exists to hold.
 *
 * Unversioned on purpose. A tag has no revision semantics worth saving, so
 * it stays off the `currentVersion`/`*Version` machinery every other
 * library-scoped entity carries.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const TagSchema = {
  '@type': sqlib.Tag,
  name: {
    '@id': sdo.name,
  },
  description: {
    '@id': sdo.description,
    '@optional': true,
  },
  /**
   * A `#rrggbb` hex colour.
   *
   * Hex rather than a palette token name, for three reasons that outweigh the
   * theme-awareness a token would buy:
   *
   * - **The data stays self-describing.** `"tag-3"` means nothing without this
   *   app's current token table, and the library store is exported as RDF
   *   (`GET /libraries/:id/export`), where a private token is unreadable and a
   *   hex is universal.
   * - **Custom colours are expressible at all.** A fixed token vocabulary can
   *   only ever offer what it enumerates.
   * - **It is what comparable systems store** — GitHub labels and Linear both
   *   keep hex and compute a readable foreground at render time, which is the
   *   standard answer to the contrast problem a raw colour creates.
   *
   * Dark mode is the UI's job, not the model's: pick swatches that read in both
   * themes, and derive the foreground from luminance. Storing a token would
   * have pushed a rendering concern into the RDF.
   */
  color: {
    '@id': sqlib.color,
    '@optional': true,
    '@pattern': '^#[0-9a-fA-F]{6}$',
  },
  /**
   * Scalar, like `QueryGroup.isPartOf`: a tag belongs to exactly one library
   * and cannot be shared across them. This is what keeps tags from leaking
   * across authz boundaries — seeing a library's tags requires seeing the
   * library.
   */
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['Library'] },
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

export interface LdkitTag {
  $id: string;
  '@type'?: 'Tag';
  name: string;
  description?: string | null;
  color?: string | null;
  isPartOf: string; // Reference to Library (required)
  dateCreated?: string | null; // ISO string format for RDF/JSON-LD compatibility
  dateModified?: string | null; // ISO string format for RDF/JSON-LD compatibility
}
