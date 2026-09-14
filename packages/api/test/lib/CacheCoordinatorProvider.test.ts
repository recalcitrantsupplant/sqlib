import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCacheCoordinator, getEntityRepositories, clearCacheCoordinator } from '../../src/lib/CacheCoordinatorProvider.js';

vi.mock('../../src/lib/MemoryCacheManager.js', () => ({
  memoryCacheManager: {},
}));

describe('CacheCoordinatorProvider', () => {
  beforeEach(() => {
    clearCacheCoordinator();
  });

  it('returns a stable coordinator instance', () => {
    const first = getCacheCoordinator();
    const second = getCacheCoordinator();

    expect(first).toBe(second);
  });

  it('returns repositories for known entity types', () => {
    const repos = getEntityRepositories();

    expect(repos.Backend).toBeTruthy();
    expect(repos.Query).toBeTruthy();
  });

  it('rebuilds instances after clearing cache', () => {
    const first = getCacheCoordinator();
    clearCacheCoordinator();
    const second = getCacheCoordinator();

    expect(first).not.toBe(second);
  });
});
