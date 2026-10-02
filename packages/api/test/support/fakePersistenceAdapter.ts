/**
 * An in-memory store for tests that need entities to exist without a triple
 * store underneath them.
 *
 * What it replaces is mocking each `persistence/utils/*Utils` module by path: a
 * stand-in per module, each restating by hand what that module's functions
 * return. Those stand-ins are keyed to file paths rather than to a contract, so
 * they break when a module moves and keep passing when its behaviour changes,
 * and mocking any module moves a file into the slower `isolated` project (see
 * vitest.config.ts).
 *
 * Storage has two doors, and this fake stands behind both with one map:
 *
 * - the `PersistenceAdapter`, which the cache coordinator writes through and
 *   boot-loads from (`setPersistenceAdapter`);
 * - the repository lenses every `*Utils` module is built on, which go straight
 *   to the entity store (`overrideRepositoryLenses`).
 *
 * So the real `*Utils` functions, the real coordinator and the real routes all
 * run over seeded data, and a test asserts on what was stored:
 *
 *   let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;
 *   beforeEach(async () => {
 *     store = await installFakePersistenceAdapter([{ type: 'Query', entity: query }]);
 *   });
 *   afterEach(() => store.restore());
 *   ...
 *   expect(store.get(query.$id)).toMatchObject({ name: 'renamed' });
 */
import type { EntityByType, EntityType } from '../../src/lib/EntityRegistry.js';
import { clearCacheCoordinator, getCacheCoordinator } from '../../src/lib/CacheCoordinatorProvider.js';
import type { LDKitEntity } from '../../src/persistence/EntityTypes.js';
import type { PersistenceAdapter } from '../../src/persistence/PersistenceAdapter.js';
import { setPersistenceAdapter } from '../../src/persistence/adapterRegistry.js';
import type { Schema } from '../../src/persistence/schema.js';
import { SCHEMA_BY_TYPE } from '../../src/persistence/schemaRegistry.js';
import { overrideRepositoryLenses, type Lens } from '../../src/persistence/utils/entityRepository.js';

const TYPE_BY_SCHEMA = new Map<unknown, string>(Object.entries(SCHEMA_BY_TYPE).map(([type, schema]) => [schema, type]));

/**
 * The entity type a repository's schema stores. A few benchmark repositories
 * have schemas that are not registered cache types; those are named by their
 * class IRI's local name, which is what the registered ones are called too.
 */
function typeOfSchema(schema: Schema): string {
  const registered = TYPE_BY_SCHEMA.get(schema);
  if (registered) return registered;
  const iri = String((schema as { '@type'?: unknown })['@type'] ?? '');
  return iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1) || iri;
}

export class FakePersistenceAdapter implements PersistenceAdapter {
  private readonly rows = new Map<string, { type: string; entity: LDKitEntity }>();

  constructor(seed: ReadonlyArray<{ type: EntityType; entity: LDKitEntity }> = []) {
    for (const { type, entity } of seed) this.put(type, entity);
  }

  /** Seeds or replaces an entity without going through `insert`. */
  put(type: string, entity: LDKitEntity): this {
    this.rows.set(entity.$id, { type, entity: structuredClone({ ...entity, '@type': entity['@type'] ?? type }) });
    return this;
  }

  /** What is stored under `id` now, or undefined. */
  get(id: string): LDKitEntity | undefined {
    const row = this.rows.get(id);
    return row ? structuredClone(row.entity) : undefined;
  }

  /** Every stored entity of `type`. */
  all(type: string): LDKitEntity[] {
    return [...this.rows.values()].filter((row) => row.type === type).map((row) => structuredClone(row.entity));
  }

  /** A repository lens over this store, for `schema`'s type. */
  lens(schema: Schema): Lens<LDKitEntity> {
    const type = typeOfSchema(schema);
    return {
      find: async () => this.all(type),
      findByIri: async (id) => this.find(type, id),
      insert: async (entity) => this.add(type, entity),
      update: async ({ $id, ...patch }) => this.patch(type, $id, patch),
      delete: async (id) => {
        this.rows.delete(id);
      },
    };
  }

  async loadAll(): Promise<Map<string, LDKitEntity>> {
    return new Map([...this.rows].map(([id, row]) => [id, structuredClone(row.entity)]));
  }

  async findByIri<T extends EntityType>(type: T, id: string): Promise<EntityByType[T] | null> {
    return this.find(type, id) as unknown as EntityByType[T] | null;
  }

  async findAll<T extends EntityType>(type: T): Promise<EntityByType[T][]> {
    return this.all(type) as unknown as EntityByType[T][];
  }

  async insert<T extends EntityType>(type: T, entity: EntityByType[T]): Promise<void> {
    this.add(type, entity as unknown as LDKitEntity);
  }

  async update<T extends EntityType>(type: T, id: string, patch: Partial<EntityByType[T]>): Promise<void> {
    this.patch(type, id, patch as Record<string, unknown>);
  }

  async delete(_type: EntityType, id: string): Promise<void> {
    this.rows.delete(id);
  }

  /** A lookup under the wrong type misses, as a typed query against the store does. */
  private find(type: string, id: string): LDKitEntity | null {
    const row = this.rows.get(id);
    return row && row.type === type ? structuredClone(row.entity) : null;
  }

  private add(type: string, entity: LDKitEntity): void {
    if (this.rows.has(entity.$id)) throw new Error(`FakePersistenceAdapter: ${entity.$id} already exists`);
    this.put(type, entity);
  }

  private patch(type: string, id: string, patch: Record<string, unknown>): void {
    const row = this.rows.get(id);
    if (!row || row.type !== type) throw new Error(`FakePersistenceAdapter: no ${type} ${id} to update`);
    // `null` clears a field, as it does in the real store.
    const next: LDKitEntity = { ...row.entity };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = value;
    }
    this.rows.set(id, { type, entity: structuredClone(next) });
  }
}

/**
 * Puts a fake store over `seed` behind both storage doors and loads a fresh
 * real coordinator from it.
 *
 * The coordinator only writes to an adapter with write-through on, and only
 * boot-loads from one with preload on; the test environment turns
 * write-through off (test/setup-env.ts). Both are turned on for as long as the
 * fake is installed. `restore()` puts back the environment, the real adapter,
 * the real lenses and an empty coordinator: call it in `afterEach`.
 */
export async function installFakePersistenceAdapter(
  seed: ReadonlyArray<{ type: EntityType; entity: LDKitEntity }> = [],
): Promise<FakePersistenceAdapter & { restore(): void }> {
  const saved = { CACHE_WRITE_THROUGH: process.env.CACHE_WRITE_THROUGH, CACHE_PRELOAD: process.env.CACHE_PRELOAD };
  process.env.CACHE_WRITE_THROUGH = 'true';
  process.env.CACHE_PRELOAD = 'true';

  const store = Object.assign(new FakePersistenceAdapter(seed), {
    restore(): void {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      setPersistenceAdapter(null);
      overrideRepositoryLenses(null);
      clearCacheCoordinator();
    },
  });
  setPersistenceAdapter(store);
  overrideRepositoryLenses((schema) => store.lens(schema));
  clearCacheCoordinator();
  await getCacheCoordinator().loadAll();
  return store;
}
