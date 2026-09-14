/**
 * A `PersistenceAdapter` that reads and writes through `EntityRegistry`'s
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
 */
import { loadAllSystemEntities } from '../../src/persistence/utils/entityRepository.js';
import { getLensForType, type EntityByType, type EntityType } from '../../src/lib/EntityRegistry.js';
import type { LDKitEntity } from '../../src/persistence/EntityTypes.js';
import type { PersistenceAdapter } from '../../src/persistence/PersistenceAdapter.js';

export const lensBackedAdapter: PersistenceAdapter = {
  async loadAll(): Promise<Map<string, LDKitEntity>> {
    return loadAllSystemEntities();
  },

  async findByIri<T extends EntityType>(type: T, id: string): Promise<EntityByType[T] | null> {
    return getLensForType(type).findByIri(id);
  },

  async findAll<T extends EntityType>(type: T): Promise<EntityByType[T][]> {
    return getLensForType(type).find();
  },

  async insert<T extends EntityType>(type: T, entity: EntityByType[T]): Promise<void> {
    await getLensForType(type).insert(entity);
  },

  async update<T extends EntityType>(type: T, id: string, patch: Partial<EntityByType[T]>): Promise<void> {
    await getLensForType(type).update({ $id: id, ...patch } as Partial<EntityByType[T]>);
  },

  async delete(type: EntityType, id: string): Promise<void> {
    await getLensForType(type).delete(id);
  },
};
