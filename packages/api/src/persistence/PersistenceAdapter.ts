/**
 * The seam between the cache and whatever actually stores entities.
 *
 * `CacheCoordinator` and the entity repositories talk only to this interface.
 * `SelfHostedAdapter` — generated system queries plus a schema-driven mapper — is
 * the sole implementation; it replaced the LDKit lenses the seam was originally
 * carved to hide. See `docs/explanation/architecture.md`.
 *
 * The interface stays because it is what makes the storage layer substitutable
 * and stubbable, which is worth having with one implementation.
 */
import type { EntityByType, EntityType } from '../lib/EntityRegistry.js';
import type { LDKitEntity } from './EntityTypes.js';

export interface PersistenceAdapter {
  /** Boot-time load of every known entity type, keyed by IRI. */
  loadAll(): Promise<Map<string, LDKitEntity>>;
  findByIri<T extends EntityType>(type: T, id: string): Promise<EntityByType[T] | null>;
  findAll<T extends EntityType>(type: T): Promise<EntityByType[T][]>;
  insert<T extends EntityType>(type: T, entity: EntityByType[T]): Promise<void>;
  update<T extends EntityType>(type: T, id: string, patch: Partial<EntityByType[T]>): Promise<void>;
  delete(type: EntityType, id: string): Promise<void>;
}

/**
 * Operation classes are the rollout unit: each gets its own feature flag so a
 * phase can ship dark and be flipped (or reverted) on its own.
 */
export type PersistenceOperationClass = 'reads' | 'creates' | 'updates' | 'deletes';
