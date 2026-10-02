/**
 * A `PersistenceAdapter` that reads and writes through the per-type `*Utils`
 * repositories.
 *
 * Several cache suites stub the repositories and `loadAllSystemEntities`, then
 * assert on what the cache did with them. They used to pin the coordinator to
 * `LdkitAdapter`, which happened to have exactly this shape; that class is gone
 * with LDKit, so the double is defined here instead of borrowed from production
 * code that no longer works this way.
 *
 * The point of those suites is cache logic, not storage, so routing through the
 * stubs is the behaviour under test — not a shortcut around it.
 *
 * Everything it touches is imported lazily. Suites install it from an async
 * `vi.mock` factory for `adapterRegistry`, and the repositories reach the cache,
 * which imports `adapterRegistry`: a static import here would make that factory
 * wait on itself and hang the file before a test runs.
 */
import type { EntityByType, EntityType } from '../../src/lib/EntityRegistry.js';
import type { LDKitEntity } from '../../src/persistence/EntityTypes.js';
import type { PersistenceAdapter } from '../../src/persistence/PersistenceAdapter.js';

interface Repository<T> {
  find(): Promise<T[]>;
  findByIri(id: string): Promise<T | null>;
  insert(entity: T): Promise<void>;
  update(entity: Partial<T>): Promise<void>;
  delete(id: string): Promise<void>;
}

async function getLensForType<T extends EntityType>(type: T): Promise<Repository<EntityByType[T]>> {
  const { REPOSITORY_BY_TYPE } = await import('./repositoryByType.js');
  const lens = REPOSITORY_BY_TYPE[type];
  if (!lens) {
    throw new Error(`Unknown entity type: ${type}`);
  }
  return lens as unknown as Repository<EntityByType[T]>;
}

export const lensBackedAdapter: PersistenceAdapter = {
  async loadAll(): Promise<Map<string, LDKitEntity>> {
    const { loadAllSystemEntities } = await import('../../src/persistence/utils/entityRepository.js');
    return loadAllSystemEntities();
  },

  async findByIri<T extends EntityType>(type: T, id: string): Promise<EntityByType[T] | null> {
    return (await getLensForType(type)).findByIri(id);
  },

  async findAll<T extends EntityType>(type: T): Promise<EntityByType[T][]> {
    return (await getLensForType(type)).find();
  },

  async insert<T extends EntityType>(type: T, entity: EntityByType[T]): Promise<void> {
    await (await getLensForType(type)).insert(entity);
  },

  async update<T extends EntityType>(type: T, id: string, patch: Partial<EntityByType[T]>): Promise<void> {
    await (await getLensForType(type)).update({ $id: id, ...patch } as Partial<EntityByType[T]>);
  },

  async delete(type: EntityType, id: string): Promise<void> {
    await (await getLensForType(type)).delete(id);
  },
};
