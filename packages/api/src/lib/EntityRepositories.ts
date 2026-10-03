import type { CacheCoordinator } from './CacheCoordinator.js';
import { createEntityRepository, type EntityRepository } from './EntityRepository.js';
import type { EntityType } from './EntityRegistry.js';
import { ENTITY_TYPE_NAMES } from '../persistence/entityTypeNames.js';

export type EntityRepositories = { [K in EntityType]: EntityRepository<K> };

export function createEntityRepositories(coordinator: CacheCoordinator): EntityRepositories {
  const repos = {} as EntityRepositories;

  ENTITY_TYPE_NAMES.forEach((entityType) => {
    (repos as Record<EntityType, EntityRepository<EntityType>>)[entityType] = createEntityRepository(coordinator, entityType);
  });

  return repos;
}
