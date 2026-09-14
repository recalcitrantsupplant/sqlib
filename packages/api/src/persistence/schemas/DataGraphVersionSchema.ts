/**
 * LDKit Schema for DataGraphVersion entity.
 *
 * An immutable snapshot of a data graph's content. Text-first storage, as the
 * design calls for: the content is held as a string and loaded into the
 * ephemeral execution store on demand through the executor's `initialGraph`
 * seam. A persistent named-graph cache is a later optimisation, not a
 * correctness requirement.
 *
 * `tripleCount` and `byteSize` are computed at write from the parsed content,
 * so a caller cannot claim a size the content does not have; the size caps in
 * `DataGraphVersionWriter` are enforced against the same numbers.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const DataGraphVersionSchema = {
  '@type': sqlib.DataGraphVersion,
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': ldkit.IRI,
    '@references': { types: ['DataGraph'] },
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
  contentFormat: {
    '@id': sqlib.contentFormat,
    '@type': xsd.string,
  },
  tripleCount: {
    '@id': sqlib.tripleCount,
    '@type': xsd.integer,
    '@optional': true,
  },
  byteSize: {
    '@id': sqlib.byteSize,
    '@type': xsd.integer,
    '@optional': true,
  },
  grammarValid: {
    '@id': sqlib.grammarValid,
    '@type': xsd.boolean,
    '@optional': true,
  },
  validationError: {
    '@id': sqlib.validationError,
    '@type': xsd.string,
    '@optional': true,
  },
  /**
   * Provenance for a version materialized from a CONSTRUCT/DESCRIBE query
   * rather than hand-authored or uploaded content (issue #153). Absent means
   * the ordinary text-first path. Versions are immutable snapshots — this
   * records what produced the snapshot, not a live link that could drift.
   */
  sourceQueryVersion: {
    '@id': sqlib.sourceQueryVersion,
    '@type': ldkit.IRI,
    '@references': { types: ['QueryVersion'] },
    '@optional': true,
  },
  sourceArgumentSetVersion: {
    '@id': sqlib.sourceArgumentSetVersion,
    '@type': ldkit.IRI,
    '@references': { types: ['ArgumentSetVersion'] },
    '@optional': true,
  },
  sourceBackend: {
    '@id': sqlib.sourceBackend,
    '@type': ldkit.IRI,
    '@references': { types: ['Backend'] },
    '@optional': true,
  },
  sourceExecutedAt: {
    '@id': sqlib.sourceExecutedAt,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  /** SHA-256 over the sorted N-Quads lines of the materialized content. */
  sourceResultHash: {
    '@id': sqlib.sourceResultHash,
    '@type': xsd.string,
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

export interface LdkitDataGraphVersion {
  $id: string;
  '@type'?: 'DataGraphVersion';
  isPartOf: string;
  version: number;
  immutable?: boolean | null;
  contentString: string;
  /** `text/turtle`, `application/n-triples` or `application/n-quads`. */
  contentFormat: string;
  tripleCount?: number | null;
  byteSize?: number | null;
  grammarValid?: boolean | null;
  validationError?: string | null;
  sourceQueryVersion?: string | null;
  sourceArgumentSetVersion?: string | null;
  sourceBackend?: string | null;
  sourceExecutedAt?: string | null;
  sourceResultHash?: string | null;
  comment?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
}
