import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CacheCoordinator } from '../../src/lib/CacheCoordinator.js';
import { EntityRepository } from '../../src/lib/EntityRepository.js';

describe('EntityRepository', () => {
  let coordinator: CacheCoordinator;
  let repo: EntityRepository<'Query'>;

  beforeEach(() => {
    coordinator = {
      get: vi.fn(),
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as CacheCoordinator;
    repo = new EntityRepository(coordinator, 'Query');
  });

  it('delegates read operations', () => {
    (coordinator.get as any).mockReturnValue({ $id: 'id', '@type': 'Query' });
    (coordinator.list as any).mockReturnValue([{ $id: 'id', '@type': 'Query' }]);

    // Straight delegation: projected fields arrive already filled in by the
    // read query and the assembler, so there is nothing to add here.
    expect(repo.get('id')).toEqual({ $id: 'id', '@type': 'Query' });
    expect(repo.list()).toEqual([{ $id: 'id', '@type': 'Query' }]);
  });

  it('delegates write operations', async () => {
    const entity = { $id: 'id', name: 'Query' };
    (coordinator.create as any).mockResolvedValue({ ...entity, '@type': 'Query' });
    (coordinator.update as any).mockResolvedValue({ ...entity, '@type': 'Query', name: 'Updated' });

    await repo.create(entity);
    await repo.update('id', { name: 'Updated' });
    await repo.delete('id');

    expect(coordinator.create).toHaveBeenCalledWith('Query', entity);
    expect(coordinator.update).toHaveBeenCalledWith('Query', 'id', { name: 'Updated' });
    expect(coordinator.delete).toHaveBeenCalledWith('Query', 'id');
  });
});
