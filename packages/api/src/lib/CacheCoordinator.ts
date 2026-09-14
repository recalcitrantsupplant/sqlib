import type { BaseEntity } from '../persistence/EntityTypes.js';
import { getPersistenceAdapter } from '../persistence/adapterRegistry.js';
import { getKnownSystemEntityIds, loadSystemStore } from '../system-store/SystemStoreLoader.js';
import { assertMutableEntity } from './immutability.js';
import { EntityByType, EntityType, getLensForType, getTtlForType } from './EntityRegistry.js';

type CacheErrorMode = 'log' | 'throw';

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

  private setInCache<T extends EntityType | 'Unknown'>(id: string, entity: unknown, type: T) {
    if (!id) return;
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
    this.setInCache(entityData.$id, cacheEntity, type);
    
    const cache = this.getCache(type);
    cache.lastRefreshedByType = Date.now();

    return cacheEntity;
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
    (Object.keys(updates) as Array<keyof EntityByType[T]>).forEach((key) => {
      const value = updates[key];
      if (value !== undefined) {
        patchRecord[String(key)] = value === null ? undefined : value;
      }
    });

    const { config } = await import('../server/config.js');
    if (config.cacheWriteThroughEnabled) {
      await getPersistenceAdapter().update(type, id, patch);
    }

    let fresh: EntityByType[T] | null = null;
    if (config.cacheWriteThroughEnabled) {
      try {
        fresh = await getPersistenceAdapter().findByIri(type, id);
      } catch (error) {
        console.warn(`[CacheCoordinator] Failed to fetch fresh ${id}`, error);
        if (this.errorMode === 'throw') throw error;
      }
    }

    const merged = { ...(fresh || canonical), ...updates } as EntityByType[T];
    (merged as unknown as BaseEntity).dateModified = effectiveDateModified;

    const cacheEntity = { ...merged, '@type': type } as unknown as EntityByType[T];
    this.setInCache(id, cacheEntity, type);
    this.getCache(type).lastRefreshedByType = Date.now();

    return cacheEntity;
  }

  async delete<T extends EntityType>(type: T, id: string): Promise<void> {
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
    this.setInCache(entityData.$id, cacheEntity, type);
    this._ephemeralIds.add(entityData.$id);
    this.getCache(type).lastRefreshedByType = Date.now();

    return cacheEntity;
  }

  removeEphemeral(id: string): void {
    if (!this.isLoaded) throw new Error('Cache not loaded. Call loadAll() first.');
    if (this.isSystemEntity(id)) throw new Error('System entity cannot be removed as ephemeral');
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
    (async () => {
      try {
        const fresh = await getPersistenceAdapter().findByIri(type, id);
        if (fresh) {
          this.setInCache(id, fresh, type);
        }
      } catch (e) {
        console.warn(`[Cache][SWR] Failed to refresh id ${id} of type ${type}`, e);
      } finally {
        cache.inFlightIdRefresh.delete(id);
      }
    })();
  }

  private triggerTypeRefreshIfStale(type: EntityType) {
    if (!this.preloadEnabled) return;
    const ttl = getTtlForType(type);
    if (!isFinite(ttl)) return;

    const hasNonSystemEntries = Array.from(this._idToType.entries()).some(([id, entityType]) => {
      return entityType === type && !this.isSystemEntity(id) && !this._ephemeralIds.has(id);
    });
    if (!hasNonSystemEntries) return;

    const cache = this.getCache(type);
    const last = cache.lastRefreshedByType;
    if (Date.now() - last < ttl || cache.inFlightTypeRefresh) return;

    cache.inFlightTypeRefresh = true;
    (async () => {
      try {
        const { config } = await import('../server/config.js');
        if (!config.cacheWriteThroughEnabled || !this.preloadEnabled) {
            cache.inFlightTypeRefresh = false;
            return;
        }

        const freshEntities = await getPersistenceAdapter().findAll(type);

        // Filter out old non-system non-ephemeral entities
        for (const [id, entityType] of this._idToType.entries()) {
          if (entityType === type && !this.isSystemEntity(id) && !this._ephemeralIds.has(id)) {
            this._idToType.delete(id);
            cache.cache.delete(id);
            cache.lastRefreshedById.delete(id);
          }
        }

        freshEntities.forEach((entity: EntityByType[EntityType]) => {
          const id = entity.$id;
          if (id && !this.isSystemEntity(id)) {
            this.setInCache(id, entity, type);
          }
        });

        cache.lastRefreshedByType = Date.now();
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
    const cache = this.getCache(type);
    const freshEntities = await getPersistenceAdapter().findAll(type);

    // Filter out old non-system non-ephemeral entities
    for (const [id, entityType] of this._idToType.entries()) {
      if (entityType === type && !this.isSystemEntity(id) && !this._ephemeralIds.has(id)) {
        this._idToType.delete(id);
        cache.cache.delete(id);
        cache.lastRefreshedById.delete(id);
      }
    }

    freshEntities.forEach((entity: EntityByType[EntityType]) => {
      const id = entity.$id;
      if (id && !this.isSystemEntity(id)) {
        this.setInCache(id, entity, type);
      }
    });

    cache.lastRefreshedByType = Date.now();
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

    this._caches.forEach(cache => {
        cache.cache.forEach(entity => {
            const type = (entity as BaseEntity)['@type'] || 'Unknown';
            const entityJson = JSON.stringify(entity);
            const entityBytes = Buffer.byteLength(entityJson, 'utf8');
            
            if (!stats.entityTypes[type]) {
              stats.entityTypes[type] = { count: 0, memoryBytes: 0 };
            }
            stats.entityTypes[type].count++;
            stats.entityTypes[type].memoryBytes += entityBytes;
            stats.estimatedMemoryBytes += entityBytes;
        });
    });

    stats.estimatedMemoryBytes += this._idToType.size * 50; // Map overhead
    return stats;
  }

  async getLensForType<T extends EntityType>(type: T) {
    return getLensForType(type);
  }
}
