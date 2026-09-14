import type { CacheCoordinator } from './CacheCoordinator.js';
import { createEntityRepository, type EntityRepository } from './EntityRepository.js';
import { LENS_BY_TYPE, type EntityType } from './EntityRegistry.js';

export type EntityRepositories = { [K in EntityType]: EntityRepository<K> };

export function createEntityRepositories(coordinator: CacheCoordinator): EntityRepositories {
  const repos = {} as EntityRepositories;

  (Object.keys(LENS_BY_TYPE) as EntityType[]).forEach((entityType) => {
    (repos as Record<EntityType, EntityRepository<EntityType>>)[entityType] = createEntityRepository(coordinator, entityType);
  });

  return repos;
}
