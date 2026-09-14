import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CacheCoordinator } from '../../src/lib/CacheCoordinator.js';
import { createEntityRepositories } from '../../src/lib/EntityRepositories.js';

describe('EntityRepositories', () => {
  let coordinator: CacheCoordinator;

  beforeEach(() => {
    coordinator = {
      // An array, because the real coordinator always returns one — reads now
      // map over the result to fill in projected fields.
      list: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
    } as unknown as CacheCoordinator;
  });

  it('creates repositories for known entity types', () => {
    const repos = createEntityRepositories(coordinator);

    expect(repos.Backend).toBeTruthy();
    expect(repos.Query).toBeTruthy();
  });

  it('repositories delegate to coordinator with their type', () => {
    const repos = createEntityRepositories(coordinator);

    repos.Backend.list();
    repos.Query.list();

    expect(coordinator.list).toHaveBeenCalledWith('Backend');
    expect(coordinator.list).toHaveBeenCalledWith('Query');
  });
});
