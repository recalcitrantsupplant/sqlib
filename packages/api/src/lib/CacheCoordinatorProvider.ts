import { CacheCoordinator } from './CacheCoordinator.js';
import { createEntityRepositories, type EntityRepositories } from './EntityRepositories.js';

let cacheCoordinator: CacheCoordinator | null = null;
let entityRepositories: EntityRepositories | null = null;

/**
 * Stand-ins for the two getters below. Tests use this to serve a fake
 * coordinator without `vi.mock`, which lets them share a module registry with
 * other files (see vitest.config.ts). Each getter left out falls through to the
 * real one.
 */
export interface CacheCoordinatorProviderOverride {
  getCacheCoordinator?: () => unknown;
  getEntityRepositories?: () => unknown;
}

let override: CacheCoordinatorProviderOverride | null = null;

export function getCacheCoordinator(): CacheCoordinator {
  if (override?.getCacheCoordinator) {
    return override.getCacheCoordinator() as CacheCoordinator;
  }
  if (!cacheCoordinator) {
    cacheCoordinator = new CacheCoordinator();
  }
  return cacheCoordinator;
}

export function getEntityRepositories(): EntityRepositories {
  if (override?.getEntityRepositories) {
    return override.getEntityRepositories() as EntityRepositories;
  }
  if (!entityRepositories) {
    entityRepositories = createEntityRepositories(getCacheCoordinator());
  }
  return entityRepositories;
}

/** For tests. `null` removes the override; `clearCacheCoordinator` does too. */
export function overrideCacheCoordinatorProvider(next: CacheCoordinatorProviderOverride | null): void {
  override = next;
}

export function clearCacheCoordinator(): void {
  cacheCoordinator = null;
  entityRepositories = null;
  override = null;
}
