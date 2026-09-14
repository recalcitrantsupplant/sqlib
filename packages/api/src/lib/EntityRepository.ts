import type { EntityByType, EntityType } from './EntityRegistry.js';
import type { CacheCoordinator } from './CacheCoordinator.js';
/**
 * Entities arrive with their `@projects` fields already filled in: the read
 * query follows the reference and the assembler lands the value, so nothing
 * here has to. That was not the first arrangement — resolution started out in
 * this class, walking the entity cache after the read — and the store is the
 * right place for it because a join has no cache-residency condition to meet.
 */
export class EntityRepository<T extends EntityType> {
  constructor(
    private coordinator: CacheCoordinator,
    private entityType: T
  ) {}

  get(id: string): EntityByType[T] | null {
    return this.coordinator.get(id) as EntityByType[T] | null;
  }

  list(): EntityByType[T][] {
    return this.coordinator.list(this.entityType) as EntityByType[T][];
  }

  create(entity: Partial<EntityByType[T]> & { $id: string }): Promise<EntityByType[T]> {
    return this.coordinator.create(this.entityType, entity) as Promise<EntityByType[T]>;
  }

  update(id: string, updates: Partial<EntityByType[T]>): Promise<EntityByType[T] | null> {
    return this.coordinator.update(this.entityType, id, updates) as Promise<EntityByType[T] | null>;
  }

  delete(id: string): Promise<void> {
    return this.coordinator.delete(this.entityType, id);
  }
}

export function createEntityRepository<T extends EntityType>(
  coordinator: CacheCoordinator,
  entityType: T
): EntityRepository<T> {
  return new EntityRepository(coordinator, entityType);
}
