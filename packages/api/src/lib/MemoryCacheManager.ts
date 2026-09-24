/**
 * Memory cache manager for fast access to SPARQL query library entities.
 * 
 * Facade that delegates to CacheCoordinator for typed entity handling.
 */
import type { LDKitEntity } from '../persistence/EntityTypes.js';
import { CacheCoordinator } from './CacheCoordinator.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { EntityType } from './EntityRegistry.js';

type CacheErrorMode = 'log' | 'throw';

export class MemoryCacheManager {
  private readonly resolveCoordinator: () => CacheCoordinator;

  /**
   * Takes a coordinator, or a function that resolves one on every call. With
   * neither, the manager gets a private coordinator of its own.
   */
  constructor(coordinator: CacheCoordinator | (() => CacheCoordinator) = new CacheCoordinator()) {
    this.resolveCoordinator = typeof coordinator === 'function' ? coordinator : () => coordinator;
  }

  private get coordinator(): CacheCoordinator {
    return this.resolveCoordinator();
  }

  // Compatibility with tests that access .cache Map directly
  get cache() {
      return this.coordinator.cache;
  }

  setErrorMode(mode: CacheErrorMode): void {
    this.coordinator.setErrorMode(mode);
  }

  async loadAll(): Promise<void> {
    await this.coordinator.loadAll();
  }

  get(id: string): LDKitEntity | null {
    return this.coordinator.get(id) as LDKitEntity | null;
  }

  getByType(type: string): LDKitEntity[] {
    return this.coordinator.list(type as EntityType) as LDKitEntity[];
  }

  getAll(): LDKitEntity[] {
    return this.coordinator.getAll() as LDKitEntity[];
  }

  async create<T extends LDKitEntity>(entityData: Partial<T> & { '$id': string }, entityType: string): Promise<T> {
    return this.coordinator.create(entityType as EntityType, entityData as unknown as Parameters<typeof this.coordinator.create>[1]) as Promise<T>;
  }

  addEphemeral<T extends LDKitEntity>(entityData: Partial<T> & { '$id': string }, entityType: string): T {
    return this.coordinator.addEphemeral(entityData as unknown as Parameters<typeof this.coordinator.addEphemeral>[0], entityType as EntityType) as T;
  }

  removeEphemeral(id: string): void {
    this.coordinator.removeEphemeral(id);
  }

  async update<T extends LDKitEntity>(id: string, updates: Partial<T>, entityType: string): Promise<T | null> {
    return this.coordinator.update(entityType as EntityType, id, updates as unknown as Parameters<typeof this.coordinator.update>[2]) as Promise<T | null>;
  }

  async delete(id: string, entityType: string): Promise<void> {
    await this.coordinator.delete(entityType as EntityType, id);
  }

  async refreshEntityType(entityType: string): Promise<void> {
    await this.coordinator.refreshEntityType(entityType as EntityType);
  }

  isReady(): boolean {
    return this.coordinator.isReady();
  }

  getStats() {
    return this.coordinator.getStats();
  }

  // Exposed for tests that previously accessed this private method
  async getLensForType(entityType: string) {
    return this.coordinator.getLensForType(entityType as EntityType);
  }
}

/**
 * Singleton instance, delegating to the global coordinator.
 *
 * It resolves the coordinator per call rather than capturing it at module load,
 * so that it follows `clearCacheCoordinator()`: a captured one would leave this
 * writing to a coordinator the rest of the app had already dropped.
 */
export const memoryCacheManager = new MemoryCacheManager(getCacheCoordinator);