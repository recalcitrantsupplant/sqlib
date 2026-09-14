import { CacheCoordinator } from './CacheCoordinator.js';
import { createEntityRepositories, type EntityRepositories } from './EntityRepositories.js';

let cacheCoordinator: CacheCoordinator | null = null;
let entityRepositories: EntityRepositories | null = null;

export function getCacheCoordinator(): CacheCoordinator {
  if (!cacheCoordinator) {
    cacheCoordinator = new CacheCoordinator();
  }
  return cacheCoordinator;
}

export function getEntityRepositories(): EntityRepositories {
  if (!entityRepositories) {
    entityRepositories = createEntityRepositories(getCacheCoordinator());
  }
  return entityRepositories;
}

export function clearCacheCoordinator(): void {
  cacheCoordinator = null;
  entityRepositories = null;
}