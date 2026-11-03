/**
 * Backend-neutral entity shapes shared by every persistence adapter.
 *
 * These live outside `persistence/` so that consumers (the cache, routes)
 * do not have to import from the repository module. `utils/entityRepository.ts` re-exports them
 * for the existing import sites.
 */

/**
 * Base interface for all entities in the system.
 * Uses $id for identity following single ID conventions.
 */
export interface BaseEntity {
  '$id': string;
  '@type'?: string;
  dateCreated?: string;
  dateModified?: string;
  /** Principal IRI of whoever created the entity (`persistence/authorship.ts`). */
  createdBy?: string | null;
  /** Principal IRI of whoever made the write `dateModified` dates. */
  modifiedBy?: string | null;
}

/**
 * Generic entity type with unknown properties.
 * Use strict typed repositories or type guards when accessing specific fields.
 */
export interface PersistedEntity extends BaseEntity {
  [key: string]: unknown;
}
