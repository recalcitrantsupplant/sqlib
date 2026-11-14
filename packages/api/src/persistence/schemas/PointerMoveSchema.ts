/**
 * Entity schema for PointerMove entity.
 *
 * One move of one environment pointer: environment "prod" moved query Q from
 * version 3 to version 4. `PUT /environments/:id/pointers` writes one record
 * for each move that changes the pointer. The record answers "who moved this,
 * and when", which the environment itself cannot: it holds only the versions
 * it points to now. See `docs/explanation/environments.md`.
 *
 * The record is an event, like a patch. It is written once and never edited,
 * so it has no versions.
 *
 * - `isPartOf` is the environment. Read access follows the environment's
 *   library, and deleting the environment deletes its moves.
 * - `movedEntity`, `fromVersion` and `toVersion` are plain IRIs with no
 *   `@references`. A move records history, and history must not stop a delete
 *   of the query or of a version that the environment no longer holds. A
 *   reader that resolves one of these IRIs must expect it to be gone.
 * - `createdBy` and `dateCreated` say who moved the pointer and when. The
 *   stamp in `CacheCoordinator.create` sets them, as for every other entity.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib, sdo } from '../namespaces.js';
import { AUTHORSHIP_PROPERTIES } from '../authorship.js';

export const PointerMoveSchema = {
  '@type': sqlib.PointerMove,
  /** The environment whose pointer moved. */
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': sqlib.IRI,
    '@references': { types: ['Environment'] },
  },
  /** The query, query group or rule set whose pointer moved. */
  movedEntity: {
    '@id': sqlib.movedEntity,
    '@type': sqlib.IRI,
  },
  /** The version the pointer held before the move. Absent when it held none. */
  fromVersion: {
    '@id': sqlib.fromVersion,
    '@type': sqlib.IRI,
    '@optional': true,
  },
  /** The version the pointer holds after the move. Absent when the move cleared it. */
  toVersion: {
    '@id': sqlib.toVersion,
    '@type': sqlib.IRI,
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

export interface PersistedPointerMove {
  $id: string;
  '@type'?: 'PointerMove';
  isPartOf: string;
  movedEntity: string;
  fromVersion?: string | null;
  toVersion?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  createdBy?: string | null;
  modifiedBy?: string | null;
}
