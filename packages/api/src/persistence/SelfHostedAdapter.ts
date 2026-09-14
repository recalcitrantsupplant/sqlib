/**
 * The `PersistenceAdapter`: sqlib storing its own entities through its own query
 * execution path.
 *
 * Built up behind per-operation flags over plan §3 Phases 1-4, and since Phase 5
 * the only implementation — reads, creates, updates and deletes all land here.
 *
 * This is the type-keyed facade: it resolves an entity type to its schema and
 * hands off to `EntityStore`, which the per-entity repositories also use. Query
 * generation and assembly live there, so both entry points behave identically.
 *
 * Note the queries are generated and executed directly rather than looked up via
 * `SystemQueryRunner`: that runner resolves its query text from the entity cache,
 * and `loadAll()` is what populates the cache. Compiled-in generation is what plan
 * §1 specifies for exactly this reason ("no chicken-and-egg"); the executor path
 * being dogfooded is the same one either way.
 */
import type { EntityByType, EntityType } from '../lib/EntityRegistry.js';
import type { LDKitEntity } from './EntityTypes.js';
import type { PersistenceAdapter } from './PersistenceAdapter.js';
import { SCHEMA_BY_TYPE } from './schemaRegistry.js';
import {
  deleteByIri,
  findAllBySchema,
  findByIriBySchema,
  insertBySchema,
  loadAllEntities,
  updateBySchema,
  type EntitySchema,
} from './EntityStore.js';

export class SelfHostedAdapter implements PersistenceAdapter {
  private schemaFor(type: EntityType): EntitySchema {
    const schema = SCHEMA_BY_TYPE[type];
    if (!schema) throw new Error(`No entity schema registered for type: ${type}`);
    return schema as unknown as EntitySchema;
  }

  async findAll<T extends EntityType>(type: T): Promise<EntityByType[T][]> {
    return (await findAllBySchema(this.schemaFor(type))) as unknown as EntityByType[T][];
  }

  async findByIri<T extends EntityType>(type: T, id: string): Promise<EntityByType[T] | null> {
    return (await findByIriBySchema(this.schemaFor(type), id)) as unknown as EntityByType[T] | null;
  }

  /** Boot load of every registered type. See `EntityStore.loadAllEntities`. */
  async loadAll(): Promise<Map<string, LDKitEntity>> {
    return (await loadAllEntities(SCHEMA_BY_TYPE as unknown as Record<string, EntitySchema>)) as Map<string, LDKitEntity>;
  }

  async insert<T extends EntityType>(type: T, entity: EntityByType[T]): Promise<void> {
    await insertBySchema(this.schemaFor(type), entity as unknown as Record<string, unknown>);
  }

  async update<T extends EntityType>(type: T, id: string, patch: Partial<EntityByType[T]>): Promise<void> {
    await updateBySchema(this.schemaFor(type), id, patch as Record<string, unknown>);
  }

  /**
   * Deletes the entity's own triples. The type is not needed — the IRI identifies
   * the entity — but stays in the signature to match the interface.
   */
  async delete(_type: EntityType, id: string): Promise<void> {
    await deleteByIri(id);
  }
}

export const selfHostedAdapter = new SelfHostedAdapter();
