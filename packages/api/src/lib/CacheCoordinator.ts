import type { BaseEntity } from '../persistence/EntityTypes.js';
import { getPersistenceAdapter } from '../persistence/adapterRegistry.js';
import { getKnownSystemEntityIds, loadSystemStore } from '../system-store/SystemStoreLoader.js';
import { assertMutableEntity } from './immutability.js';
import { EntityByType, EntityType, getLensForType, getTtlForType } from './EntityRegistry.js';

type CacheErrorMode = 'log' | 'throw';

/** A create named an id that already belongs to an entity. Routes answer 409. */
export class EntityExistsError extends Error {
  readonly statusCode = 409;

  constructor(readonly id: string, readonly existingType: string) {
    super(`${id} already exists. Update it instead, or create without an id.`);
    this.name = 'EntityExistsError';
  }
}

/**
 * An update was written through but the store does not hold the entity
 * afterwards — typically one that only ever lived in the cache. Returning the
 * merged copy would report a write that never happened. Routes answer 500.
 */
export class EntityNotPersistedError extends Error {
  readonly statusCode = 500;

  constructor(readonly id: string, readonly entityType: string) {
    super(`${entityType} ${id} is not in the store, so the update was not saved.`);
    this.name = 'EntityNotPersistedError';
  }
}

class EntityCache<T extends EntityType | 'Unknown'> {
  public cache = new Map<string, unknown>();
  public lastRefreshedById = new Map<string, number>();
  public lastRefreshedByType = 0;
  public inFlightIdRefresh = new Set<string>();
  public inFlightTypeRefresh = false;

  constructor(public type: T) {}

  clear() {
    this.cache.clear();
    this.lastRefreshedById.clear();
    this.lastRefreshedByType = 0;
    this.inFlightIdRefresh.clear();
    this.inFlightTypeRefresh = false;
  }
}

export class CacheCoordinator {
  private _caches: Map<EntityType | 'Unknown', EntityCache<EntityType | 'Unknown'>> = new Map();
  private _idToType: Map<string, EntityType | 'Unknown'> = new Map();
  private isLoaded = false;
  private preloadEnabled = true;
  private systemEntityIds = getKnownSystemEntityIds();
  private _ephemeralIds = new Set<string>();
  private errorMode: CacheErrorMode = 'log';

  /*
   * Write sequence, so a refresh can tell what was written while it awaited
   * the store. Every write takes the next number and records it against its
   * id and its type; a refresh notes the number it started at, and afterwards
   * leaves alone anything whose number is higher — that write is newer than
   * the snapshot the refresh is holding. The per-id map only has to outlive
   * the refreshes in flight, so it is emptied whenever none are.
   */
  private writeSeq = 0;
  private lastWriteById = new Map<string, number>();
  private refreshesInFlight = 0;
  private statsByType = new Map<EntityType | 'Unknown', { count: number; memoryBytes: number }>();

  constructor() {}

  // Compatibility getters for tests that bypass the public API
  get caches() { return this._caches; }
  get idToType() { return this._idToType; }
  get ephemeralIds() { return this._ephemeralIds; }
  // Compatibility with tests expecting .cache Map directly on manager
  get cache() {
    const coordinator = this;
    return {
      get size() {
        return coordinator._idToType.size;
      },
      delete(id: string) {
        coordinator.removeFromCache(id);
        return true;
      },
      set(id: string, entity: unknown) {
        const type = ((entity as BaseEntity)['@type'] as EntityType) || 'Unknown';
        coordinator.setInCache(id, entity, type);
        return this;
      },
      get(id: string) {
        const type = coordinator._idToType.get(id);
        if (!type) return undefined;
        return coordinator.getCache(type).cache.get(id);
      },
      has(id: string) {
        return coordinator._idToType.has(id);
      },
      clear() {
        coordinator._caches.clear();
        coordinator._idToType.clear();
        coordinator._ephemeralIds.clear();
        coordinator.statsByType.clear();
      },
      keys() {
        return coordinator._idToType.keys();
      },
      values() {
        const values: EntityByType[EntityType][] = [];
        coordinator._caches.forEach((cache) => values.push(...(cache.cache.values() as IterableIterator<EntityByType[EntityType]>)));
        return values.values();
      },
      entries() {
        const entries: Array<[string, EntityByType[EntityType]]> = [];
        coordinator._caches.forEach((cache) => {
          cache.cache.forEach((value, key) => entries.push([key, value as EntityByType[EntityType]]));
        });
        return entries.values();
      },
      [Symbol.iterator]() {
        return this.entries();
      }
    };
  }

  private getCache<T extends EntityType | 'Unknown'>(type: T): EntityCache<T> {
    let cache = this._caches.get(type) as EntityCache<T> | undefined;
    if (!cache) {
      cache = new EntityCache(type);
      this._caches.set(type, cache as unknown as EntityCache<EntityType | 'Unknown'>);
    }
    return cache;
  }

  setErrorMode(mode: CacheErrorMode): void {
    this.errorMode = mode;
  }

  async loadAll(): Promise<void> {
    console.log('[CacheCoordinator] Loading all entities...');
    try {
      const { config } = await import('../server/config.js');
      this.preloadEnabled = config.cachePreloadEnabled;

      const { cacheEntries: systemEntries, assetDir } = await loadSystemStore();
      
      // Reset state
      this._caches.clear();
      this._idToType.clear();
      this._ephemeralIds.clear();
      this.statsByType.clear();
      this.systemEntityIds = getKnownSystemEntityIds();

      // Load system entities
      for (const [id, entity] of systemEntries.entries()) {
        const type = ((entity as BaseEntity)['@type'] as EntityType) || 'Unknown';
        this.setInCache(id, entity, type);
        this.systemEntityIds.add(id);
      }

      if (!this.preloadEnabled) {
        console.log(`[CacheCoordinator] Skipping cache preload (CACHE_PRELOAD=false); loaded ${systemEntries.size} system entities from ${assetDir}`);
        this.finalizeLoad();
        return;
      }

      const backendEntities = await getPersistenceAdapter().loadAll();
      backendEntities.forEach((entity, id) => {
        if (this.isSystemEntity(id)) return;
        const type = ((entity as BaseEntity)['@type'] as EntityType) || 'Unknown';
        this.setInCache(id, entity, type);
      });

      this.finalizeLoad();
      console.log(`[CacheCoordinator] Cache loaded with ${this._idToType.size} entities`);
    } catch (error) {
      console.error('[CacheCoordinator] Failed to load entities:', error);
      this.isLoaded = false;
      throw error;
    }
  }

  private recordWrite(id: string): void {
    this.lastWriteById.set(id, ++this.writeSeq);
  }

  private writtenSince(id: string, seq: number): boolean {
    return (this.lastWriteById.get(id) ?? 0) > seq;
  }

  private beginRefresh(): number {
    this.refreshesInFlight++;
    return this.writeSeq;
  }

  private endRefresh(): void {
    if (--this.refreshesInFlight === 0) this.lastWriteById.clear();
  }

  private setInCache<T extends EntityType | 'Unknown'>(id: string, entity: unknown, type: T) {
    if (!id) return;
    const previousType = this._idToType.get(id);
    if (previousType) this.statsByType.delete(previousType);
    this.statsByType.delete(type);
    const cache = this.getCache(type);
    // Ensure @type is set for internal consistency and test compatibility
    const withType = type !== 'Unknown' ? { ...(entity as object), '@type': type } : { ...(entity as object) };
    cache.cache.set(id, withType);
    this._idToType.set(id, type);
    const now = Date.now();
    cache.lastRefreshedById.set(id, now);
  }

  private removeFromCache(id: string) {
    const type = this._idToType.get(id);
    if (type) {
      this.statsByType.delete(type);
      const cache = this.getCache(type);
      cache.cache.delete(id);
      cache.lastRefreshedById.delete(id);
      this._idToType.delete(id);
    }
  }

  private finalizeLoad(): void {
    this.isLoaded = true;
    const now = Date.now();
    for (const cache of this._caches.values()) {
      const ttl = cache.type !== 'Unknown' ? getTtlForType(cache.type as EntityType) : 60_000;
      cache.lastRefreshedByType = Number.isFinite(ttl) ? now - ttl : now;
      for (const id of cache.cache.keys()) {
        cache.lastRefreshedById.set(id, now);
      }
    }
  }

  isReady(): boolean {
    return this.isLoaded;
  }

  get(id: string): EntityByType[EntityType] | null {
    if (!this.isLoaded) throw new Error('Cache not loaded. Call loadAll() first.');
    const type = this._idToType.get(id);
    if (!type) return null;
    
    const cache = this.getCache(type);
    const entity = cache.cache.get(id) || null;
    
    if (entity && !this._ephemeralIds.has(id) && type !== 'Unknown') {
      this.triggerIdRefreshIfStale(id, type as EntityType);
    }

    if (entity) {
        return entity as EntityByType[EntityType];
    }
    return null;
  }

  /**
   * Resolve an IRI to an entity that already exists, for referential checks.
   *
   * `get()` alone is not enough: it is cache-only, and with `CACHE_PRELOAD=false`
   * a perfectly valid IRI can be absent from the cache, so a naive existence
   * check would reject correct payloads. This falls back to the store the same
   * way `update()` does — the difference being that the caller does not know
   * the type yet, so each candidate type is tried until one answers.
   *
   * @param candidateTypes types the reference is allowed to have. The store
   *   lookup needs a type to query, so an empty list means cache-only.
   * @returns the resolved type and entity, or null if nothing matches
   */
  async resolveExisting(
    id: string,
    candidateTypes: readonly EntityType[] = []
  ): Promise<{ type: EntityType; entity: EntityByType[EntityType] } | null> {
    if (!id) return null;

    const cached = this.get(id);
    if (cached) {
      const type = this._idToType.get(id);
      if (type && type !== 'Unknown') {
        return { type, entity: cached };
      }
    }

    for (const type of candidateTypes) {
      try {
        const entity = await getPersistenceAdapter().findByIri(type, id);
        if (entity) {
          return { type, entity: entity as EntityByType[EntityType] };
        }
      } catch (error) {
        console.warn(`[CacheCoordinator] Failed to resolve ${id} as ${type}`, error);
        if (this.errorMode === 'throw') throw error;
      }
    }

    return null;
  }

  getAll(): EntityByType[EntityType][] {
    if (!this.isLoaded) throw new Error('Cache not loaded. Call loadAll() first.');
    const all: EntityByType[EntityType][] = [];
    for (const cache of this._caches.values()) {
      for (const entity of cache.cache.values()) {
        all.push(entity as EntityByType[EntityType]);
      }
    }
    return all;
  }

  list<T extends EntityType>(type: T): EntityByType[T][] {
    if (!this.isLoaded) throw new Error('Cache not loaded. Call loadAll() first.');
    const cache = this.getCache(type);
    this.triggerTypeRefreshIfStale(type);
    const results: EntityByType[T][] = [];
    for (const entity of cache.cache.values()) {
        results.push(entity as EntityByType[T]);
    }
    return results;
  }

  async create<T extends EntityType>(
    type: T,
    entityData: Partial<EntityByType[T]> & { $id: string }
  ): Promise<EntityByType[T]> {
    if (this.isSystemEntity(entityData.$id)) {
      throw new Error(`System entity ${entityData.$id} is immutable.`);
    }
    await this.assertAbsent(type, entityData.$id);
    this._ephemeralIds.delete(entityData.$id);

    const toInsert = { ...entityData };
    const nowIso = new Date().toISOString();
    
    // Use BaseEntity for safe access to common fields
    const base = toInsert as unknown as BaseEntity;
    if (base.dateCreated == null) base.dateCreated = nowIso;
    base.dateModified = nowIso;

    const { config } = await import('../server/config.js');
    if (config.cacheWriteThroughEnabled) {
      await getPersistenceAdapter().insert(type, toInsert as EntityByType[T]);
    }

    const cacheEntity = { ...toInsert, '@type': type } as unknown as EntityByType[T];
    this.recordWrite(entityData.$id);
    this.setInCache(entityData.$id, cacheEntity, type);

    const cache = this.getCache(type);
    cache.lastRefreshedByType = Date.now();

    return cacheEntity;
  }

  /**
   * Refuse a create whose id is already taken, under any type.
   *
   * The insert is additive and `setInCache` re-points `_idToType`, so a create
   * that named an existing IRI used to merge its triples into the old
   * subject's and re-type it in the cache — posting a Query whose id was a
   * library's made the library stop resolving as one, and the entity guard
   * then abstained on everything in it. Checked here rather than per route so
   * no create path can skip it. An ephemeral entity (a playground stand-in) is
   * the one exception: creating over it is how it is promoted.
   *
   * With `CACHE_PRELOAD=false` the cache is not the whole store, so the store
   * is asked too — as this type, and as a Library, the takeover worth closing.
   */
  private async assertAbsent(type: EntityType, id: string): Promise<void> {
    if (this._ephemeralIds.has(id)) return;
    const existingType = this._idToType.get(id);
    if (existingType) throw new EntityExistsError(id, existingType);
    if (this.preloadEnabled || !this.isLoaded) return;
    const candidates: EntityType[] = type === 'Library' ? [type] : [type, 'Library'];
    const existing = await this.resolveExisting(id, candidates);
    if (existing) throw new EntityExistsError(id, existing.type);
  }

  async update<T extends EntityType>(
    type: T,
    id: string,
    updates: Partial<EntityByType[T]>
  ): Promise<EntityByType[T] | null> {
    if (this.isSystemEntity(id)) throw new Error(`System entity ${id} is immutable.`);

    let canonical: EntityByType[T] | null = (this.get(id) as EntityByType[T]) ?? null;

    if (!canonical) {
      try {
        canonical = (await getPersistenceAdapter().findByIri(type, id)) ?? null;
      } catch (error) {
        console.warn(`[CacheCoordinator] Failed to resolve canonical ${id}`, error);
        if (this.errorMode === 'throw') throw error;
      }
    }

    if (!canonical) return null;
    assertMutableEntity(type, canonical as unknown as Record<string, unknown>, updates as Record<string, unknown>);

    const nowIso = new Date().toISOString();
    const effectiveDateModified = (updates as unknown as BaseEntity).dateModified ?? nowIso;

    const patch = { dateModified: effectiveDateModified } as unknown as Partial<EntityByType[T]>;
    const patchRecord = patch as Record<string, unknown>;
    // `null` is kept: the update generator clears a property on `null` and
    // treats `undefined` as "not patched", so rewriting one into the other made
    // every clear a silent no-op in the store while the cache showed it cleared.
    (Object.keys(updates) as Array<keyof EntityByType[T]>).forEach((key) => {
      const value = updates[key];
      if (value !== undefined) {
        patchRecord[String(key)] = value;
      }
    });

    const { config } = await import('../server/config.js');
    if (config.cacheWriteThroughEnabled) {
      await getPersistenceAdapter().update(type, id, patch);
    }

    let fresh: EntityByType[T] | null = null;
    if (config.cacheWriteThroughEnabled) {
      let readBack = false;
      try {
        fresh = await getPersistenceAdapter().findByIri(type, id);
        readBack = true;
      } catch (error) {
        console.warn(`[CacheCoordinator] Failed to fetch fresh ${id}`, error);
        if (this.errorMode === 'throw') throw error;
      }
      // The update query is anchored on the entity's type triple, so against a
      // store that does not hold the entity it matches nothing and succeeds.
      // An ephemeral entity is cache-only by design and is exempt.
      if (readBack && !fresh && !this._ephemeralIds.has(id)) {
        console.error(`[CacheCoordinator][audit] update of ${type} ${id} reached no stored entity; refusing to report it saved`);
        throw new EntityNotPersistedError(id, type);
      }
    }

    const merged = { ...(fresh || canonical), ...updates } as EntityByType[T];
    (merged as unknown as BaseEntity).dateModified = effectiveDateModified;

    const cacheEntity = { ...merged, '@type': type } as unknown as EntityByType[T];
    this.recordWrite(id);
    this.setInCache(id, cacheEntity, type);
    this.getCache(type).lastRefreshedByType = Date.now();

    return cacheEntity;
  }

  async delete<T extends EntityType>(type: T, id: string): Promise<void> {
    this.recordWrite(id);
    if (this._ephemeralIds.has(id)) {
      this.removeFromCache(id);
      this._ephemeralIds.delete(id);
      return;
    }

    if (this.isSystemEntity(id)) throw new Error(`System entity ${id} is immutable.`);

    const { config } = await import('../server/config.js');
    if (config.cacheWriteThroughEnabled) {
      await getPersistenceAdapter().delete(type, id);
    }

    this.removeFromCache(id);
  }

  addEphemeral<T extends EntityType>(
    entityData: Partial<EntityByType[T]> & { $id: string },
    type: T
  ): EntityByType[T] {
    if (!this.isLoaded) throw new Error('Cache not loaded. Call loadAll() first.');
    if (this.isSystemEntity(entityData.$id)) throw new Error('System entity cannot be ephemeral');

    const cacheEntity = { ...entityData, '@type': type } as unknown as EntityByType[T];
    this.recordWrite(entityData.$id);
    this.setInCache(entityData.$id, cacheEntity, type);
    this._ephemeralIds.add(entityData.$id);
    this.getCache(type).lastRefreshedByType = Date.now();

    return cacheEntity;
  }

  removeEphemeral(id: string): void {
    if (!this.isLoaded) throw new Error('Cache not loaded. Call loadAll() first.');
    if (this.isSystemEntity(id)) throw new Error('System entity cannot be removed as ephemeral');
    this.recordWrite(id);
    this.removeFromCache(id);
    this._ephemeralIds.delete(id);
  }

  private triggerIdRefreshIfStale(id: string, type: EntityType) {
    if (this.isSystemEntity(id) || !this.preloadEnabled) return;
    const ttl = getTtlForType(type);
    if (!isFinite(ttl)) return;

    const cache = this.getCache(type);
    const last = cache.lastRefreshedById.get(id) ?? 0;
    if (Date.now() - last < ttl || cache.inFlightIdRefresh.has(id)) return;

    cache.inFlightIdRefresh.add(id);
    const startedAt = this.beginRefresh();
    (async () => {
      try {
        const fresh = await getPersistenceAdapter().findByIri(type, id);
        // A write that landed during the read is newer than what it returned.
        if (fresh && !this.writtenSince(id, startedAt)) {
          this.setInCache(id, fresh, type);
        }
      } catch (e) {
        console.warn(`[Cache][SWR] Failed to refresh id ${id} of type ${type}`, e);
      } finally {
        cache.inFlightIdRefresh.delete(id);
        this.endRefresh();
      }
    })();
  }

  /**
   * Refresh a type once its TTL has passed since it was last loaded.
   *
   * Deliberately not conditional on the type having entries: a type whose
   * boot load failed is cached empty, and it must still be reloaded rather
   * than stay empty until a restart.
   */
  private triggerTypeRefreshIfStale(type: EntityType) {
    if (!this.preloadEnabled) return;
    const ttl = getTtlForType(type);
    if (!isFinite(ttl)) return;

    const cache = this.getCache(type);
    const last = cache.lastRefreshedByType;
    if (Date.now() - last < ttl || cache.inFlightTypeRefresh) return;

    cache.inFlightTypeRefresh = true;
    (async () => {
      try {
        const { config } = await import('../server/config.js');
        if (!config.cacheWriteThroughEnabled || !this.preloadEnabled) return;
        await this.reloadType(type);
      } catch (e) {
        console.warn(`[CacheCoordinator][SWR] Failed type refresh ${type}`, e);
      } finally {
        cache.inFlightTypeRefresh = false;
      }
    })();
  }

  async refreshEntityType(type: EntityType): Promise<void> {
    if (!this.preloadEnabled) {
      console.log(`[CacheCoordinator] Skipping cache refresh for ${type} (CACHE_PRELOAD=false)`);
      return;
    }
    await this.reloadType(type);
  }

  /**
   * Bring a type's cache in line with the store without losing a write that
   * landed while the store was being read.
   *
   * The snapshot is applied id by id: an id written after the read started
   * keeps whatever the cache now says (including having been deleted), and
   * every other id takes the store's version, or leaves if the store no longer
   * has it. System and ephemeral entities are never the store's to remove.
   */
  private async reloadType(type: EntityType): Promise<void> {
    const startedAt = this.beginRefresh();
    try {
      const freshEntities = await getPersistenceAdapter().findAll(type);
      const cache = this.getCache(type);

      const storedIds = new Set<string>();
      for (const entity of freshEntities as BaseEntity[]) {
        const id = entity.$id;
        if (!id || this.isSystemEntity(id)) continue;
        storedIds.add(id);
        if (this.writtenSince(id, startedAt) || this._ephemeralIds.has(id)) continue;
        this.setInCache(id, entity, type);
      }

      for (const id of [...cache.cache.keys()]) {
        if (storedIds.has(id) || this.isSystemEntity(id) || this._ephemeralIds.has(id)) continue;
        if (this.writtenSince(id, startedAt)) continue;
        this.removeFromCache(id);
      }

      cache.lastRefreshedByType = Date.now();
    } finally {
      this.endRefresh();
    }
  }

  private isSystemEntity(id: string | null | undefined): boolean {
    return !!id && this.systemEntityIds.has(id);
  }

  getStats() {
    const stats = {
      totalEntities: this._idToType.size,
      isLoaded: this.isLoaded,
      estimatedMemoryBytes: 0,
      entityTypes: {} as Record<string, { count: number; memoryBytes: number }>
    };

    // Serialising every entity is the cost here, so each type's figure is kept
    // until a write to that type invalidates it.
    this._caches.forEach((cache, type) => {
      let typeStats = this.statsByType.get(type);
      if (!typeStats) {
        typeStats = { count: 0, memoryBytes: 0 };
        for (const entity of cache.cache.values()) {
          typeStats.count++;
          typeStats.memoryBytes += Buffer.byteLength(JSON.stringify(entity), 'utf8');
        }
        this.statsByType.set(type, typeStats);
      }
      if (typeStats.count === 0) return;
      stats.entityTypes[type] = { ...typeStats };
      stats.estimatedMemoryBytes += typeStats.memoryBytes;
    });

    stats.estimatedMemoryBytes += this._idToType.size * 50; // Map overhead
    return stats;
  }

  async getLensForType<T extends EntityType>(type: T) {
    return getLensForType(type);
  }
}
