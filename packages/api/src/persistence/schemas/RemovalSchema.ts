/**
 * Entity schema for Removal entity.
 *
 * One delete of one library entity: who deleted query "Old churn", and when.
 * `CacheCoordinator.delete` writes it, so every delete route records one
 * without code of its own (`lib/removals.ts` says which deletes count). The
 * library Activity feed reads it; the deleted entity is gone, so the record
 * keeps its name and kind.
 *
 * The record is an event, written once and never edited, so it has no
 * versions. `removedEntity` is a plain IRI with no `@references`: it names
 * something that no longer exists, unless a later create reuses the IRI.
 */

import type { Schema } from '../schema.js';
import { xsd, sqlib, sdo } from '../namespaces.js';
import { AUTHORSHIP_PROPERTIES } from '../authorship.js';

export const RemovalSchema = {
  '@type': sqlib.Removal,
  /** The library the entity belonged to. */
  isPartOf: {
    '@id': sdo.isPartOf,
    '@type': sqlib.IRI,
    '@references': { types: ['Library'] },
  },
  /** The deleted entity. */
  removedEntity: {
    '@id': sqlib.removedEntity,
    '@type': sqlib.IRI,
  },
  /** Its entity type, such as `Query`. */
  removedType: {
    '@id': sqlib.removedType,
    '@type': xsd.string,
  },
  /** Its name when it was deleted. */
  name: {
    '@id': sdo.name,
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

export interface PersistedRemoval {
  $id: string;
  '@type'?: 'Removal';
  isPartOf: string;
  removedEntity: string;
  removedType: string;
  name?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  createdBy?: string | null;
  modifiedBy?: string | null;
}
