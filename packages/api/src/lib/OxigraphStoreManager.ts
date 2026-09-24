/**
 * OxigraphStoreManager - Central management for Oxigraph store lifecycle
 *
 * Handles both durable and ephemeral Oxigraph stores for SPARQL execution.
 *
 * IMPORTANT: The oxigraph JavaScript/WebAssembly bindings only support in-memory stores.
 * Unlike the Rust/Python bindings, there is NO RocksDB disk-backed persistence.
 *
 * - "Durable" stores: In-memory stores that are serialized to .nq files on shutdown
 *   and can be restored on startup. Data is NOT automatically persisted - you must
 *   call serializeDurableStore() or rely on shutdown() to save data.
 *
 * - "Ephemeral" stores: Pure in-memory stores for temporary use, never serialized.
 *
 * For true disk-backed persistence, run oxigraph-server as a sidecar and use HTTP backend.
 */

import * as oxigraph from 'oxigraph';
import * as fs from 'fs/promises';
import * as path from 'path';
import { HttpSparqlExecutor } from '../server/HttpSparqlExecutor.js';
import type { OxigraphConfig, OxigraphSourceConfig, OxigraphStoreMode } from '../persistence/schemas/BackendSchema.js';
import { hydrateStoreFromDataGraphs, trackedDataGraphIds, type HydrationResult } from './dataGraphHydration.js';
import { restoreStoreFromSnapshot, writeStoreSnapshot } from './storeSnapshot.js';
import { markStoreWritten, storeWriteCount } from './storeWrites.js';

/**
 * How long a checkpoint may take before its log line becomes a warning.
 *
 * The dump is synchronous, so this is a stall of every request in flight, not
 * a slow background job. 100ms is roughly a 50,000-quad store on the machine
 * this was measured on (#443) — small enough that anything above it is worth
 * seeing, large enough that a quiet library store does not warn every minute.
 */
const CHECKPOINT_PAUSE_WARNING_MS = 100;

export interface StoreStats {
  tripleCount: number;
  memoryUsage: number; // bytes
  createdAt: Date;
  lastAccessed: Date;
  storeType: 'durable' | 'ephemeral';
  serializationPath?: string; // Path where .nq file is saved (NOT a RocksDB path)
  diskUsageBytes?: number;
  /** Set for `oxigraphMemory` backends; says which lifecycle the store has. */
  mode?: OxigraphStoreMode;
  /** Quads brought in by data-graph hydration, if any. */
  hydratedQuads?: number;
}

export class OxigraphStoreManager {
  private durableStores = new Map<string, oxigraph.Store>();
  private ephemeralStores = new Map<string, oxigraph.Store>();
  private storeStats = new Map<string, StoreStats>();
  private pendingDurableStores = new Map<string, Promise<oxigraph.Store>>();
  /** Memory-mode stores (`oxigraphMemory` backends), keyed by backend id. */
  private memoryStores = new Map<string, oxigraph.Store>();
  private memoryModes = new Map<string, OxigraphStoreMode>();
  private pendingMemoryStores = new Map<string, Promise<oxigraph.Store>>();
  /** backendId -> data graph ids whose head it follows. */
  private memoryTracking = new Map<string, Set<string>>();
  /**
   * Bumped every time a backend's store is invalidated, whether or not one was
   * built at the time. Hydration reads it before and after loading so that an
   * invalidation arriving mid-build is not lost — see `_createMemoryStoreInternal`.
   */
  private memoryEpochs = new Map<string, number>();
  private storageDir: string;  // Directory for serialized .nq files
  private readonly maxMemoryUsage: number;
  private initialized = false;
  private checkpointInterval: NodeJS.Timeout | null = null;
  /**
   * backendId -> the store's write count as of its last periodic checkpoint.
   *
   * Absent means "never checkpointed by the loop", which checkpoints once —
   * the safe reading, since a store built before the loop started may hold
   * writes the snapshot does not.
   */
  private lastCheckpoint = new Map<string, number>();
  /** True while `checkpointAllStores` is running, so ticks cannot stack. */
  private checkpointRunning = false;

  constructor(storageDir = './storage/oxigraph', maxMemoryUsage = 1024 * 1024 * 1024) { // 1GB default
    this.storageDir = path.resolve(storageDir);
    this.maxMemoryUsage = maxMemoryUsage;
  }

  /**
   * Check if the store manager has been initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Start periodic checkpointing of all durable stores.
   * @param intervalMs Checkpoint interval in milliseconds (default: 60000 / 1 min)
   */
  startCheckpointing(intervalMs: number = 60000): void {
    if (this.checkpointInterval) {
      this.stopCheckpointing();
    }

    console.log(`⏱️ Starting OxigraphStoreManager periodic checkpointing (every ${intervalMs}ms)`);
    this.checkpointInterval = setInterval(() => {
      // A checkpoint of a large store can outlast the interval — the dump is
      // synchronous, so two of them are two full stops of the event loop back
      // to back. A tick that arrives during one is dropped rather than queued.
      if (this.checkpointRunning) {
        console.warn('⏱️ Skipping checkpoint tick: the previous checkpoint is still running');
        return;
      }
      this.checkpointRunning = true;
      this.checkpointAllStores()
        .catch(err => {
          console.error('Failed to checkpoint Oxigraph stores:', err);
        })
        .finally(() => {
          this.checkpointRunning = false;
        });
    }, intervalMs);

    // Prevent the interval from keeping the process alive
    if (this.checkpointInterval.unref) {
      this.checkpointInterval.unref();
    }
  }

  /**
   * Stop periodic checkpointing.
   */
  stopCheckpointing(): void {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = null;
      console.log('⏱️ Stopped OxigraphStoreManager periodic checkpointing');
    }
  }

  /**
   * Immediately checkpoint all durable stores to disk.
   *
   * A store the process has not written since its last checkpoint is skipped:
   * `Store.dump` is synchronous into wasm, so writing a file identical to the
   * one on disk is not idle work but a full stop of the event loop — measured
   * at ~107ms for 50,000 quads and ~3.7s for a million (#443).
   *
   * The skip rests on `storeWrites`, which counts writes as they happen,
   * rather than on `store.size`, which a delete-and-insert of equal counts
   * leaves untouched. It is also confined to this loop: `serializeDurableStore`
   * means "save now" and `shutdown` serializes everything, so a write path that
   * failed to declare itself costs a redundant write at worst and never costs
   * data on a clean exit.
   *
   * @param options.force Checkpoint every store even if unchanged.
   */
  async checkpointAllStores(options: { force?: boolean } = {}): Promise<void> {
    if (!this.initialized) return;

    const serializePromises = Array.from(this.durableStores.keys()).map(async backendId => {
      try {
        const store = this.durableStores.get(backendId);
        if (!store) return;

        // Read before the dump, recorded after it. A write landing mid-dump
        // raises the count past what is recorded, so the next checkpoint runs
        // rather than skipping a change this one did not capture.
        const writeCount = storeWriteCount(store);
        const lastCheckpoint = this.lastCheckpoint.get(backendId);
        if (!options.force && lastCheckpoint !== undefined && lastCheckpoint === writeCount) {
          return;
        }

        const started = performance.now();
        await this.serializeDurableStore(backendId);
        const durationMs = performance.now() - started;
        this.lastCheckpoint.set(backendId, writeCount);

        // The pause is the whole argument for the skip above, so the log has to
        // carry it — a quad count alone cannot make that argument on someone
        // else's machine.
        const message =
          `⏱️ Checkpointed ${backendId}: ${store.size} quads in ${durationMs.toFixed(0)}ms`;
        if (durationMs >= CHECKPOINT_PAUSE_WARNING_MS) {
          console.warn(`${message} — the event loop was blocked for that time`);
        } else {
          console.log(message);
        }
      } catch (error) {
        console.error(`Failed to checkpoint store ${backendId}:`, error);
      }
    });

    await Promise.all(serializePromises);
  }

  /**
   * Initialize the store manager and load any existing persistent stores
   * Can optionally reconfigure storage directory before initialization
   */
  async initialize(storageDir?: string): Promise<void> {
    const targetDir = path.resolve(storageDir || this.storageDir);

    if (this.initialized) {
      if (targetDir === this.storageDir) {
        return;
      }
      console.warn(`⚠️ OxigraphStoreManager already initialized with ${this.storageDir}. Reconfiguring to ${targetDir} and clearing existing stores.`);
      this.durableStores.clear();
      this.ephemeralStores.clear();
      this.memoryStores.clear();
      this.memoryModes.clear();
      this.memoryTracking.clear();
      this.memoryEpochs.clear();
      this.storeStats.clear();
      this.lastCheckpoint.clear();
    }
    this.storageDir = targetDir;

    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      console.log(`OxigraphStoreManager initialized with storage dir: ${this.storageDir}`);
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize OxigraphStoreManager:', error);
      throw error;
    }
  }

  /**
   * Create or retrieve a durable store for a backend.
   *
   * NOTE: Oxigraph JS only supports in-memory stores. The "durable" store is
   * serialized to an .nq file on shutdown and can be restored on startup.
   * This is NOT true disk-backed persistence like RocksDB.
   *
   * @deprecated Use createDurableStore() instead - "persistent" naming was misleading
   */
  async createPersistentStore(backendId: string, config: OxigraphConfig): Promise<oxigraph.Store> {
    return this.createDurableStore(backendId, config);
  }

  /**
   * Create or retrieve a durable store for a backend.
   *
   * Durable stores are in-memory but serialized to .nq files on shutdown.
   * Call serializeDurableStore() to save immediately, or rely on shutdown().
   */
  async createDurableStore(backendId: string, config: OxigraphConfig): Promise<oxigraph.Store> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.durableStores.has(backendId)) {
      const store = this.durableStores.get(backendId)!;
      console.log(`📊 Retrieved existing durable store ${backendId}: ${store.size} quads`);
      return store;
    }

    if (this.pendingDurableStores.has(backendId)) {
      console.log(`📊 [OxigraphStoreManager] Deduplicating concurrent createDurableStore for ${backendId} — awaiting in-flight creation`);
      return this.pendingDurableStores.get(backendId)!;
    }

    const promise = this._createDurableStoreInternal(backendId, config);
    this.pendingDurableStores.set(backendId, promise);
    try {
      return await promise;
    } finally {
      this.pendingDurableStores.delete(backendId);
    }
  }

  private async _createDurableStoreInternal(backendId: string, config: OxigraphConfig): Promise<oxigraph.Store> {
    // All oxigraph JS stores are in-memory only
    const store = new oxigraph.Store();

    // Try to restore from serialized .nq file if it exists.
    //
    // Deliberately not wrapped in a catch: `restoreStoreFromSnapshot` already
    // answers "no snapshot yet" without throwing, so anything that reaches here
    // is a snapshot that exists and could not be used. Starting fresh from that
    // discards data that is still on disk, and the next checkpoint writes the
    // empty store over it.
    const serializationPath = this.getSerializationPath(backendId);
    const restore = await restoreStoreFromSnapshot(store, serializationPath);
    const restoredFromDisk = restore.restored;
    if (restoredFromDisk) {
      console.log(`📊 Restored durable store ${backendId} from ${serializationPath}: ${store.size} quads`);
    }

    // Load initial data only when starting fresh (not restored from disk)
    if (!restoredFromDisk && config.loadMethod && config.loadMethod !== 'none' && config.sourceConfig && store.size === 0) {
      await this.loadInitialData(store, config.loadMethod, config.sourceConfig);
    }

    this.durableStores.set(backendId, store);
    this.updateStoreStats(backendId, store, false, serializationPath);

    if (!restoredFromDisk) {
      console.log(`📊 Created new durable store ${backendId}: ${store.size} quads`);
    }

    return store;
  }

  /**
   * Create or retrieve an in-process store for an `oxigraphMemory` backend.
   *
   * The three modes differ only in what happens around hydration:
   *
   * - `readOnly` / `ephemeral` — hydrated from the configured data graphs every
   *   time the store is built. Nothing is read from or written to disk.
   * - `durable` — restored from its `.nq` file when one exists, and hydrated
   *   from data graphs **only on first boot**. That is the seed-not-mirror rule:
   *   once the store has its own disk state, that state is the truth and drift
   *   from the seed graphs is expected, exactly as for a database initialised
   *   from seed migrations.
   *
   * Read-only is not enforced here — see `ReadOnlySparqlExecutor`. This method
   * hands back a plain store in every mode; what may be done to it is decided
   * where queries are executed.
   */
  async createMemoryStore(backendId: string, config: OxigraphConfig): Promise<oxigraph.Store> {
    if (!this.initialized) {
      await this.initialize();
    }

    const existing = this.memoryStores.get(backendId);
    if (existing) {
      return existing;
    }

    const pending = this.pendingMemoryStores.get(backendId);
    if (pending) {
      console.log(`📊 [OxigraphStoreManager] Deduplicating concurrent createMemoryStore for ${backendId}`);
      return pending;
    }

    const promise = this._createMemoryStoreInternal(backendId, config);
    this.pendingMemoryStores.set(backendId, promise);
    try {
      return await promise;
    } finally {
      this.pendingMemoryStores.delete(backendId);
    }
  }

  /**
   * Build the store, retrying if it was invalidated while we were loading.
   *
   * Hydration is async — it reads data graph content — so a version can be
   * saved between the first read and the store being registered. The
   * epoch check turns that race into a rebuild rather than a store that is
   * born stale. Bounded, because a graph being resaved faster than it can
   * be loaded should degrade to "slightly behind", not spin forever.
   */
  private async _createMemoryStoreInternal(backendId: string, config: OxigraphConfig): Promise<oxigraph.Store> {
    const maxAttempts = 3;
    for (let attempt = 1; ; attempt++) {
      const epochBefore = this.memoryEpochs.get(backendId) ?? 0;
      const store = await this._buildMemoryStore(backendId, config);
      const epochAfter = this.memoryEpochs.get(backendId) ?? 0;

      if (epochAfter === epochBefore || attempt >= maxAttempts) {
        if (epochAfter !== epochBefore) {
          console.warn(
            `📊 Memory store ${backendId} was invalidated during hydration ${attempt} time(s); serving the latest build`,
          );
        }
        this.memoryStores.set(backendId, store);
        this.memoryModes.set(backendId, config.mode ?? 'readOnly');
        return store;
      }

      console.log(`📊 Memory store ${backendId} invalidated mid-hydration — rebuilding`);
    }
  }

  private async _buildMemoryStore(backendId: string, config: OxigraphConfig): Promise<oxigraph.Store> {
    const mode: OxigraphStoreMode = config.mode ?? 'readOnly';
    const store = new oxigraph.Store();
    const isDurable = mode === 'durable';
    const serializationPath = isDurable ? this.getSerializationPath(backendId) : undefined;

    // Register tracking interest *before* hydrating, so a version saved
    // while we are loading is seen. Invalidation bumps this backend's epoch
    // even with no store built yet, and the caller re-checks it after the
    // load — together that turns the race into a rebuild.
    this.memoryTracking.set(backendId, new Set(trackedDataGraphIds(config.sources)));

    // No catch here for the same reason as `_createDurableStoreInternal`: an
    // absent snapshot is first boot and the seed applies, but an unreadable one
    // is data still on disk that a fresh start would go on to overwrite.
    let restoredFromDisk = false;
    if (serializationPath) {
      const restore = await restoreStoreFromSnapshot(store, serializationPath);
      restoredFromDisk = restore.restored;
      if (restoredFromDisk) {
        console.log(`📊 Restored durable memory store ${backendId} from ${serializationPath}: ${store.size} quads`);
      }
    }

    let hydration: HydrationResult | null = null;
    if (!restoredFromDisk) {
      try {
        hydration = hydrateStoreFromDataGraphs(store, config.sources);
        if (hydration.sources.length > 0) {
          console.log(
            `📊 Hydrated ${mode} store ${backendId} from ${hydration.sources.length} data graph(s): ${hydration.quadsLoaded} quads`,
          );
        }
      } catch (error) {
        // A store that failed to hydrate must not be cached as if it were
        // populated — an empty "read-only reference dataset" is a silent wrong
        // answer, where a throw is a fixable config error.
        this.memoryTracking.delete(backendId);
        throw error;
      }
    }

    // Legacy seeding paths stay available so an `oxigraphMemory` backend can be
    // pointed at a file or endpoint rather than library data.
    if (!restoredFromDisk && config.loadMethod && config.loadMethod !== 'none' && config.sourceConfig) {
      await this.loadInitialData(store, config.loadMethod, config.sourceConfig);
    }

    if (isDurable) {
      // Durable memory stores ride the same checkpoint/shutdown path that every
      // other durable store uses, which is what makes their disk state the truth.
      this.durableStores.set(backendId, store);
    }

    this.updateStoreStats(backendId, store, mode === 'ephemeral', serializationPath);
    const stats = this.storeStats.get(backendId);
    if (stats) {
      stats.mode = mode;
      stats.hydratedQuads = hydration?.quadsLoaded ?? 0;
    }

    return store;
  }

  /** Get a memory-mode store by backend id. */
  getMemoryStore(backendId: string): oxigraph.Store | null {
    const store = this.memoryStores.get(backendId);
    if (store) {
      this.updateAccessTime(backendId);
    }
    return store ?? null;
  }

  /** The lifecycle a memory store was built with, if it exists. */
  getMemoryStoreMode(backendId: string): OxigraphStoreMode | null {
    return this.memoryModes.get(backendId) ?? null;
  }

  /**
   * Drop a memory store so its next use rebuilds it.
   *
   * A durable store is serialized first: its disk state is the source of truth,
   * so discarding it unsaved would lose writes.
   */
  async invalidateMemoryStore(backendId: string): Promise<boolean> {
    // Bumped even when no store is built yet: a hydration may be in flight, and
    // this is what tells it to discard what it loaded and start again.
    this.memoryEpochs.set(backendId, (this.memoryEpochs.get(backendId) ?? 0) + 1);

    if (!this.memoryStores.has(backendId)) return false;

    if (this.memoryModes.get(backendId) === 'durable' && this.durableStores.has(backendId)) {
      try {
        await this.serializeDurableStore(backendId);
      } catch (error) {
        console.error(`Failed to serialize durable store ${backendId} before invalidation:`, error);
      }
      this.durableStores.delete(backendId);
    }

    this.memoryStores.delete(backendId);
    this.memoryModes.delete(backendId);
    this.memoryTracking.delete(backendId);
    this.storeStats.delete(backendId);
    // The write count belongs to the store object that has just been dropped;
    // leaving it behind would compare the next store's writes against another
    // store's history.
    this.lastCheckpoint.delete(backendId);
    console.log(`📊 Invalidated memory store: ${backendId}`);
    return true;
  }

  /**
   * Invalidate every memory store that follows this data graph's head.
   *
   * This is the whole "kept in sync" mechanism, and it is cheap because every
   * data-graph write goes through our own API: saving a version calls here,
   * and the affected stores rebuild on next use. Pinned sources are unaffected
   * by construction — they name an immutable version, so nothing about them can
   * have changed.
   *
   * Returns the backend ids that were invalidated — those with a built store,
   * plus any whose hydration is still in flight and will now rebuild.
   */
  async invalidateStoresTrackingDataGraph(dataGraphId: string): Promise<string[]> {
    const affected: string[] = [];
    for (const [backendId, tracked] of Array.from(this.memoryTracking)) {
      if (tracked.has(dataGraphId)) {
        affected.push(backendId);
      }
    }

    for (const backendId of affected) {
      await this.invalidateMemoryStore(backendId);
    }

    if (affected.length > 0) {
      console.log(`📊 Data graph ${dataGraphId} saved — invalidated ${affected.length} tracking store(s)`);
    }
    return affected;
  }

  /** Backend ids whose stores follow the given data graph's head. */
  getStoresTrackingDataGraph(dataGraphId: string): string[] {
    const ids: string[] = [];
    for (const [backendId, tracked] of Array.from(this.memoryTracking)) {
      if (tracked.has(dataGraphId)) ids.push(backendId);
    }
    return ids;
  }

  /**
   * Get the path where a durable store's .nq file is saved
   */
  private getSerializationPath(backendId: string): string {
    const filename = `${backendId.replace(/[^a-zA-Z0-9]/g, '_')}.nq`;
    return path.join(this.storageDir, filename);
  }

  /**
   * Get a durable store by backend ID
   * @deprecated Use getDurableStore() instead
   */
  getPersistentStore(backendId: string): oxigraph.Store | null {
    return this.getDurableStore(backendId);
  }

  /**
   * Get a durable store by backend ID
   */
  getDurableStore(backendId: string): oxigraph.Store | null {
    const store = this.durableStores.get(backendId);
    if (store) {
      this.updateAccessTime(backendId);
    }
    return store || null;
  }

  /**
   * Create an ephemeral store for temporary use
   */
  createEphemeralStore(storeId: string): oxigraph.Store {
    if (this.ephemeralStores.has(storeId)) {
      return this.ephemeralStores.get(storeId)!;
    }

    const store = new oxigraph.Store();
    this.ephemeralStores.set(storeId, store);
    this.updateStoreStats(storeId, store, true);

    console.log(`Created ephemeral store: ${storeId}`);
    return store;
  }

  /**
   * Get an ephemeral store by ID
   */
  getEphemeralStore(storeId: string): oxigraph.Store | null {
    const store = this.ephemeralStores.get(storeId);
    if (store) {
      this.updateAccessTime(storeId);
    }
    return store || null;
  }

  /**
   * Destroy an ephemeral store
   */
  destroyEphemeralStore(storeId: string): void {
    if (this.ephemeralStores.delete(storeId)) {
      this.storeStats.delete(storeId);
      console.log(`Destroyed ephemeral store: ${storeId}`);
    }
  }

  /**
   * Load data from a file into a store.
   *
   * Read as bytes and handed to the parser as bytes, for the reason
   * `storeSnapshot.ts` gives: a file over 512 MiB cannot become a string at
   * all, and a seed file is one of the two places a store meets a file.
   */
  async loadDataFromFile(store: oxigraph.Store, filePath: string, format: string): Promise<void> {
    try {
      const data = await fs.readFile(filePath);
      await this.loadDataFromBytes(store, data, format);
      console.log(`Loaded data from file: ${filePath} (format: ${format})`);
    } catch (error) {
      console.error(`Failed to load data from file ${filePath}:`, error);
      throw new Error(`Failed to load data from file: ${error}`);
    }
  }

  /**
   * Load data from a string into a store
   */
  async loadDataFromString(store: oxigraph.Store, data: string, format: string): Promise<void> {
    return this.loadDataFromBytes(store, data, format);
  }

  private async loadDataFromBytes(store: oxigraph.Store, data: string | Uint8Array, format: string): Promise<void> {
    try {
      const sizeBefore = store.size;
      const oxigraphFormat = this.formatToOxigraphFormat(format);
      store.load(data, { format: oxigraphFormat });
      // A load is a write, so the next periodic checkpoint has to write rather
      // than skip (#443). Marked even when the data adds nothing: the parse
      // succeeded, and "unchanged" is a claim about the writes, not the size.
      markStoreWritten(store);
      const sizeAfter = store.size;
      const measure = typeof data === 'string' ? `${data.length} chars` : `${data.length} bytes`;
      console.log(`📊 Loaded data into store: ${sizeBefore} → ${sizeAfter} quads (format: ${format}, ${measure})`);

      // Update stats for any store that we can find
      for (const [storeId, durableStore] of Array.from(this.durableStores)) {
        if (durableStore === store) {
          this.updateStoreStats(storeId, store);
          break;
        }
      }
      for (const [storeId, ephemeralStore] of Array.from(this.ephemeralStores)) {
        if (ephemeralStore === store) {
          this.updateStoreStats(storeId, store, true);
          break;
        }
      }
    } catch (error) {
      console.error(`Failed to load data into store:`, error);
      throw new Error(`Failed to load data: ${error}`);
    }
  }

  /**
   * Load data from a remote SPARQL endpoint
   */
  async loadDataFromSparql(store: oxigraph.Store, endpoint: string, query: string): Promise<void> {
    try {
      const executor = new HttpSparqlExecutor({
        queryUrl: endpoint,
        updateUrl: endpoint
      });

      const { result: nquads } = await executor.constructQueryParsed(query);
      store.load(nquads, { format: 'nq' });
      markStoreWritten(store);

      console.log(`Imported data from SPARQL endpoint: ${endpoint}`);
    } catch (error) {
      console.error(`Failed to import from SPARQL endpoint ${endpoint}:`, error);
      throw new Error(`Failed to import from SPARQL endpoint: ${error}`);
    }
  }

  /**
   * Load data from a remote file URL
   */
  async loadDataFromRemoteFile(store: oxigraph.Store, url: string, format?: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.text();
      const detectedFormat = format || this.detectFormatFromUrl(url) || 'turtle';
      
      await this.loadDataFromString(store, data, detectedFormat);
      console.log(`Loaded data from remote file: ${url} (format: ${detectedFormat})`);
    } catch (error) {
      console.error(`Failed to load data from remote file ${url}:`, error);
      throw new Error(`Failed to load data from remote file: ${error}`);
    }
  }

  /**
   * Serialize a durable store to disk as .nq file
   * @deprecated Use serializeDurableStore() instead
   */
  async serializePersistentStore(backendId: string): Promise<void> {
    return this.serializeDurableStore(backendId);
  }

  /**
   * Serialize a durable store to disk as .nq file
   */
  async serializeDurableStore(backendId: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('OxigraphStoreManager not initialized. Cannot serialize stores.');
    }

    const store = this.durableStores.get(backendId);
    if (!store) {
      throw new Error(`Durable store not found: ${backendId}`);
    }

    try {
      const filePath = this.getSerializationPath(backendId);

      // Uses oxigraph's native dump, which is significantly faster and more
      // memory efficient than running a CONSTRUCT query and serializing by
      // hand. Written through a temp file, and empty stores are written too —
      // an emptied store is a state worth persisting.
      await writeStoreSnapshot(store, filePath);
      console.log(`Serialized store ${backendId} to: ${filePath} (${store.size} triples)`);
    } catch (error) {
      console.error(`Failed to serialize store ${backendId}:`, error);
      throw new Error(`Failed to serialize store: ${error}`);
    }
  }

  /**
   * Get statistics for a store
   */
  getStoreStats(storeId: string): StoreStats | null {
    return this.storeStats.get(storeId) || null;
  }

  /**
   * Get all store statistics
   */
  getAllStoreStats(): Map<string, StoreStats> {
    return new Map(this.storeStats);
  }

  /**
   * Clean up resources and serialize durable stores
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down OxigraphStoreManager...');
    this.stopCheckpointing();

    // Serialize all durable stores (only if initialized)
    if (this.initialized) {
      const serializePromises = Array.from(this.durableStores.keys()).map(backendId =>
        this.serializeDurableStore(backendId).catch(error =>
          console.error(`Failed to serialize store ${backendId} during shutdown:`, error)
        )
      );

      await Promise.all(serializePromises);
    }

    this.clearStores();

    console.log('OxigraphStoreManager shutdown complete');
  }

  /**
   * Drop every store and return to the uninitialized state, without
   * serializing anything.
   *
   * For tests: the suite runs files in a shared module registry, so this
   * singleton outlives the file that filled it. `test/setup-vitest.ts` calls
   * this before each file so that each one starts from an empty manager.
   */
  reset(storageDir = './storage/oxigraph'): void {
    this.stopCheckpointing();
    this.checkpointRunning = false;
    this.clearStores();
    this.pendingDurableStores.clear();
    this.pendingMemoryStores.clear();
    this.storageDir = path.resolve(storageDir);
    this.initialized = false;
  }

  private clearStores(): void {
    this.durableStores.clear();
    this.ephemeralStores.clear();
    this.memoryStores.clear();
    this.memoryModes.clear();
    this.memoryTracking.clear();
    this.memoryEpochs.clear();
    this.storeStats.clear();
    this.lastCheckpoint.clear();
  }

  // Private helper methods

  private async loadInitialData(store: oxigraph.Store, loadMethod: string, sourceConfig: OxigraphSourceConfig): Promise<void> {
    switch (loadMethod) {
      case 'file':
        if (sourceConfig.filePath && sourceConfig.format) {
          await this.loadDataFromFile(store, sourceConfig.filePath, sourceConfig.format);
        }
        break;
      
      case 'remote-sparql':
        if (sourceConfig.remoteEndpoint && sourceConfig.importQuery) {
          await this.loadDataFromSparql(store, sourceConfig.remoteEndpoint, sourceConfig.importQuery);
        }
        break;
      
      case 'remote-file':
        if (sourceConfig.remoteFileUrl) {
          await this.loadDataFromRemoteFile(store, sourceConfig.remoteFileUrl, sourceConfig.format);
        }
        break;
      
      case 'none':
        // No initial data to load
        break;
      
      default:
        console.warn(`Unknown load method: ${loadMethod}`);
    }
  }

  private updateStoreStats(storeId: string, store: oxigraph.Store, isEphemeral = false, serializationPath?: string): void {
    const now = new Date();
    const existing = this.storeStats.get(storeId);
    const resolvedPath = serializationPath ?? existing?.serializationPath;

    this.storeStats.set(storeId, {
      tripleCount: store.size,
      memoryUsage: this.estimateMemoryUsage(store),
      createdAt: existing?.createdAt || now,
      lastAccessed: now,
      storeType: isEphemeral ? 'ephemeral' : 'durable',
      serializationPath: resolvedPath,
      diskUsageBytes: existing?.diskUsageBytes,
    });

    if (resolvedPath && !isEphemeral && existing) {
      void this.refreshDiskUsage(storeId, resolvedPath);
    }
  }

  private updateAccessTime(storeId: string): void {
    const stats = this.storeStats.get(storeId);
    if (stats) {
      stats.lastAccessed = new Date();
    }
  }

  private estimateMemoryUsage(store: oxigraph.Store): number {
    // Rough estimate: assume 100 bytes per triple on average
    return store.size * 100;
  }

  private formatToMimeType(format: string): string {
    switch (format.toLowerCase()) {
      case 'turtle':
      case 'ttl':
        return 'text/turtle';
      case 'ntriples':
      case 'nt':
        return 'application/n-triples';
      case 'rdfxml':
      case 'rdf':
        return 'application/rdf+xml';
      case 'jsonld':
      case 'json-ld':
        return 'application/ld+json';
      case 'nquads':
      case 'nq':
        return 'application/n-quads';
      default:
        console.warn(`Unknown format ${format}, defaulting to turtle`);
        return 'text/turtle';
    }
  }

  private formatToOxigraphFormat(format: string): string {
    switch (format.toLowerCase()) {
      case 'turtle':
      case 'ttl':
        return 'ttl';
      case 'ntriples':
      case 'nt':
        return 'nt';
      case 'rdfxml':
      case 'rdf':
        return 'xml';
      case 'jsonld':
      case 'json-ld':
        return 'jsonld';
      case 'nquads':
      case 'nq':
        return 'nq';
      default:
        console.warn(`Unknown format ${format}, defaulting to turtle`);
        return 'ttl';
    }
  }

  private detectFormatFromUrl(url: string): string | null {
    const extension = path.extname(url).toLowerCase();
    switch (extension) {
      case '.ttl':
        return 'turtle';
      case '.nt':
        return 'ntriples';
      case '.rdf':
      case '.xml':
        return 'rdfxml';
      case '.jsonld':
        return 'jsonld';
      case '.nq':
        return 'nquads';
      default:
        return null;
    }
  }

  private async refreshDiskUsage(storeId: string, persistPath: string): Promise<void> {
    try {
      const stats = await fs.stat(persistPath);
      const storeStats = this.storeStats.get(storeId);
      if (storeStats) {
        storeStats.diskUsageBytes = stats.size;
      }
    } catch (error) {
      // Silently ignore errors (file might not exist yet, etc.)
      console.debug(`Could not refresh disk usage for ${storeId} at ${persistPath}:`, error);
    }
  }

  private quadsToNQuadsString(quads: Array<{
    subject: { termType: string; value: string };
    predicate: { value: string };
    object: { termType: string; value: string; language?: string; datatype?: { value: string } };
  }>): string {
    return quads.map(q => {
      // Subject
      const subj = q.subject.termType === 'NamedNode' ? `<${q.subject.value}>` : `_:${q.subject.value}`;

      // Predicate
      const pred = `<${q.predicate.value}>`;

      // Object
      let obj: string;
      if (q.object.termType === 'NamedNode') {
        obj = `<${q.object.value}>`;
      } else if (q.object.termType === 'Literal') {
        const escapedValue = q.object.value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r');
        obj = `"${escapedValue}"`;

        if (q.object.language) {
          obj += `@${q.object.language}`;
        } else if (q.object.datatype && q.object.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
          obj += `^^<${q.object.datatype.value}>`;
        }
      } else {
        obj = `_:${q.object.value}`;
      }

      return `${subj} ${pred} ${obj} .`;
    }).join('\n');
  }
}

// Singleton instance
export const oxigraphStoreManager = new OxigraphStoreManager();
