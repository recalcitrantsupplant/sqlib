import { LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import { getCacheCoordinator } from '../CacheCoordinatorProvider.js';
import type { ResolvedNode } from './types.js';
import { HttpSparqlExecutor } from '../../server/HttpSparqlExecutor.js';
import { OxigraphSparqlExecutor } from '../../server/OxigraphSparqlExecutor.js';
import { ReadOnlySparqlExecutor } from '../../server/ReadOnlySparqlExecutor.js';
import type { ISparqlExecutor } from '../../server/ISparqlExecutor.js';
import { resolveBackendEnvAuth } from '../backendAuth.js';
import { oxigraphStoreManager } from '../OxigraphStoreManager.js';
import { backendTypeIriToKey, queryMethodIriToKey, resolveOxigraphConfig, type LdkitBackend } from '../../persistence/schemas/BackendSchema.js';
import { config } from '../../server/config.js';
import type { ExecutionAuthScope } from '../../auth/executionScope.js';
import { assertBackendAccess } from '../../auth/executionScope.js';

export class ExecutorFactory {
  private cache = new Map<string, ISparqlExecutor>();

  /**
   * The caller this factory produces executors for, or `undefined` for work sqlib
   * does under its own identity (entity persistence, system queries, boot-time
   * loads). Because every execution path acquires its executor here, a query
   * group leg cannot run against a backend the caller may not reach — the
   * confused-deputy hole closes by construction rather than by remembering to
   * check in each orchestrator.
   */
  constructor(private readonly authScope?: ExecutionAuthScope) {}

  /**
   * Get an executor for a backend ID directly (without requiring a full ResolvedNode).
   * Useful for ETL execution where we only have a backend reference.
   */
  async getExecutorForBackendId(backendId: string): Promise<ISparqlExecutor> {
    assertBackendAccess(this.authScope, backendId);

    if (backendId === LIBRARY_STORAGE_BACKEND_ID) {
      return this.getLibraryStorageExecutor();
    }

    const cached = this.cache.get(backendId);
    if (cached) return cached;

    const backend = getCacheCoordinator().get(backendId) as LdkitBackend | null;
    if (!backend || backend['@type'] !== 'Backend') {
      throw new Error(`Backend not found: ${backendId}`);
    }

    const backendTypeKey = backendTypeIriToKey(backend.backendType);
    if (!backendTypeKey) {
      throw new Error(`Unsupported backend type for ${backendId}: ${backend.backendType}`);
    }

    let exec: ISparqlExecutor;

    switch (backendTypeKey) {
      case 'http':
        exec = this.createHttpExecutor(backend);
        break;
      case 'oxigraphEphemeral':
        exec = this.createBackendEphemeralExecutor(backend);
        break;
      case 'oxigraphMemory':
        // Deliberately not cached — see `createMemoryExecutor`.
        return this.createMemoryExecutor(backend);
      default:
        throw new Error(`Unsupported backend type for ${backendId}: ${backend.backendType}`);
    }

    this.cache.set(backendId, exec);
    return exec;
  }

  async getExecutorForNode(node: ResolvedNode): Promise<ISparqlExecutor> {
    // Ephemeral stores need no grant: they exist only inside one execution, are
    // keyed to it and destroyed with it, so only this caller can ever read them.
    if (node.backendConfig?.type === 'ephemeral-oxigraph') {
      return this.createEphemeralExecutor(node);
    }

    const id = node.backendId;
    if (!id) {
      throw new Error(`Node ${node.id} requires a backendId because it does not have an ephemeral backend configuration.`);
    }

    assertBackendAccess(this.authScope, id);

    if (id === LIBRARY_STORAGE_BACKEND_ID) {
      return this.getLibraryStorageExecutor();
    }

    const cached = this.cache.get(id);
    if (cached) return cached;

    // Handle regular backends (persistent)
    const backend = getCacheCoordinator().get(id) as LdkitBackend | null;
    if (!backend || backend['@type'] !== 'Backend') {
      throw new Error(`Backend not found for node ${node.id}: ${id}`);
    }

    const backendTypeKey = backendTypeIriToKey(backend.backendType);
    if (!backendTypeKey) {
      throw new Error(`Unsupported backend type for ${id}: ${backend.backendType}`);
    }
    let exec: ISparqlExecutor;

    switch (backendTypeKey) {
      case 'http':
        exec = this.createHttpExecutor(backend);
        break;
      case 'oxigraphEphemeral':
        exec = this.createBackendEphemeralExecutor(backend);
        break;
      case 'oxigraphMemory':
        // Deliberately not cached — see `createMemoryExecutor`.
        return this.createMemoryExecutor(backend);

      default:
        throw new Error(`Unsupported backend type for ${id}: ${backend.backendType}`);
    }

    this.cache.set(id, exec);
    return exec;
  }

  private createHttpExecutor(backend: LdkitBackend): ISparqlExecutor {
    const endpoint = backend.endpoint;
    if (!endpoint) {
      throw new Error(`HTTP backend ${backend.$id} missing endpoint`);
    }

    // Convert IRI to key if queryMethod is set, default to 'post'
    const queryMethodKey = backend.queryMethod
      ? queryMethodIriToKey(backend.queryMethod)
      : 'post';

    const envAuth = resolveBackendEnvAuth(backend.authEnvKey);
    return new HttpSparqlExecutor({
      queryUrl: endpoint,
      updateUrl: endpoint,
      username: envAuth.username,
      password: envAuth.password,
      authHeader: envAuth.authHeader,
      queryMethod: queryMethodKey,
    });
  }

  private async createOxigraphExecutor(backend: LdkitBackend): Promise<ISparqlExecutor> {
    // Get or create the persistent store
    let store = oxigraphStoreManager.getPersistentStore(backend.$id);
    
    if (!store) {
      const config = resolveOxigraphConfig(backend.oxigraphConfig, backend.$id) ?? {
        storeType: 'persistent' as const,
        loadMethod: 'none' as const,
      };
      store = await oxigraphStoreManager.createPersistentStore(backend.$id, config);
    }

    return new OxigraphSparqlExecutor(store);
  }

  /**
   * Build (or reuse) the in-process store for an `oxigraphMemory` backend.
   *
   * The store is hydrated from the backend's data graph sources; `readOnly` is
   * then enforced by wrapping, because Oxigraph itself has no such flag.
   *
   * The resulting executor is **not** put in `this.cache`, unlike every other
   * backend type. A memory store that tracks a data graph's head is dropped
   * when a new version is saved, and some factories here are long-lived
   * (`EntityStore`, `SystemQueryRunner`) — a cached executor would go on
   * querying the store object that was replaced, serving pre-save data
   * indefinitely. The store manager does its own dedup and caching, so
   * re-resolving per call costs a map lookup, not a rehydration.
   */
  private async createMemoryExecutor(backend: LdkitBackend): Promise<ISparqlExecutor> {
    const oxigraphConfig = resolveOxigraphConfig(backend.oxigraphConfig, backend.$id)
      ?? { storeType: 'ephemeral' as const, mode: 'readOnly' as const };

    const store =
      oxigraphStoreManager.getMemoryStore(backend.$id) ??
      (await oxigraphStoreManager.createMemoryStore(backend.$id, oxigraphConfig));

    return this.wrapForMode(new OxigraphSparqlExecutor(store), backend);
  }

  /**
   * Apply the backend's mode to a freshly built executor.
   *
   * Defaults to read-only: a memory backend registered without an explicit
   * mode is being pointed at library data, and refusing writes to it is the
   * safe reading of an under-specified config — the opposite default would
   * accept writes that vanish on the next reload.
   */
  private wrapForMode(exec: ISparqlExecutor, backend: LdkitBackend): ISparqlExecutor {
    const mode = resolveOxigraphConfig(backend.oxigraphConfig, backend.$id)?.mode ?? 'readOnly';
    return mode === 'readOnly' ? new ReadOnlySparqlExecutor(exec, backend.$id) : exec;
  }

  private createEphemeralExecutor(node: ResolvedNode): ISparqlExecutor {
    if (!node.backendConfig?.storeId) {
      throw new Error(`Ephemeral oxigraph node ${node.id} missing storeId`);
    }

    // Get or create ephemeral store
    let store = oxigraphStoreManager.getEphemeralStore(node.backendConfig.storeId);
    if (!store) {
      store = oxigraphStoreManager.createEphemeralStore(node.backendConfig.storeId);
    }

    return new OxigraphSparqlExecutor(store);
  }

  private async getLibraryStorageExecutor(): Promise<ISparqlExecutor> {
    const cached = this.cache.get(LIBRARY_STORAGE_BACKEND_ID);
    if (cached) {
      return cached;
    }

    const exec = await this.createLibraryStorageExecutor();
    this.cache.set(LIBRARY_STORAGE_BACKEND_ID, exec);
    return exec;
  }

  private createInternalHttpExecutor(): ISparqlExecutor {
    const backendConfig = config.internalBackend;
    if (backendConfig.type !== 'http') {
      throw new Error(`Internal backend is not HTTP (received ${backendConfig.type})`);
    }

    const queryUrl = backendConfig.queryUrl || backendConfig.baseUrl;
    const updateUrl = backendConfig.updateUrl || backendConfig.queryUrl || backendConfig.baseUrl;
    return new HttpSparqlExecutor({
      queryUrl,
      updateUrl,
      username: backendConfig.username,
      password: backendConfig.password,
    });
  }

  private async createLibraryStorageExecutor(): Promise<ISparqlExecutor> {
    const backendConfig = config.internalBackend;
    switch (backendConfig.type) {
      case 'http':
        return this.createInternalHttpExecutor();
      case 'oxigraph-persistent': {
        const storeId = backendConfig.storeId;
        let store = oxigraphStoreManager.getPersistentStore(storeId);
        if (!store) {
          if (!oxigraphStoreManager.isInitialized()) {
            await oxigraphStoreManager.initialize(backendConfig.storageDir);
          }
          store = await oxigraphStoreManager.createPersistentStore(storeId, {
            storeType: 'persistent',
            loadMethod: backendConfig.loadMethod,
            sourceConfig: backendConfig.sourceConfig,
            persistPath: backendConfig.persistPath,
          });
        }
        return new OxigraphSparqlExecutor(store);
      }
      case 'oxigraph-memory': {
        const storeId = `${LIBRARY_STORAGE_BACKEND_ID}::memory`;
        let store = oxigraphStoreManager.getPersistentStore(storeId);
        if (!store) {
          store = await oxigraphStoreManager.createPersistentStore(storeId, {
            storeType: 'persistent',
            loadMethod: 'none',
            persistPath: backendConfig.dbPath,
          });
        }
        return new OxigraphSparqlExecutor(store);
      }
      default:
        throw new Error(`Unsupported internal backend type: ${(backendConfig as { type: string }).type}`);
    }
  }

  /**
   * Synchronous version for backward compatibility
   * Note: This will not work with oxigraph backends that need async initialization
   */
  getExecutorForNodeSync(node: ResolvedNode): ISparqlExecutor {
    // Handle ephemeral oxigraph backends
    if (node.backendConfig?.type === 'ephemeral-oxigraph') {
      return this.createEphemeralExecutor(node);
    }

    const id = node.backendId;
    if (!id) {
      throw new Error(`Node ${node.id} requires a backendId because it does not have an ephemeral backend configuration.`);
    }

    if (id === LIBRARY_STORAGE_BACKEND_ID) {
      const cachedInternal = this.cache.get(LIBRARY_STORAGE_BACKEND_ID);
      if (cachedInternal) {
        return cachedInternal;
      }
      if (config.internalBackend.type === 'http') {
        const exec = this.createInternalHttpExecutor();
        this.cache.set(LIBRARY_STORAGE_BACKEND_ID, exec);
        return exec;
      }
      throw new Error('Library storage executor requires async initialization. Use getExecutorForNode() instead.');
    }

    const cached = this.cache.get(id);
    if (cached) return cached;

    // Handle regular backends
    const backend = getCacheCoordinator().get(id) as LdkitBackend | null;
    if (!backend || backend['@type'] !== 'Backend') {
      throw new Error(`Backend not found for node ${node.id}: ${id}`);
    }

    const backendTypeKey = backendTypeIriToKey(backend.backendType);
    if (!backendTypeKey) {
      throw new Error(`Unsupported backend type for ${id}: ${backend.backendType}`);
    }

    switch (backendTypeKey) {
      case 'http':
        const exec = this.createHttpExecutor(backend);
        this.cache.set(id, exec);
        return exec;
      
      case 'oxigraphEphemeral':
        const ephemeralStore = oxigraphStoreManager.getEphemeralStore(backend.$id) ?? oxigraphStoreManager.createEphemeralStore(backend.$id);
        const ephemeralExec = new OxigraphSparqlExecutor(ephemeralStore);
        this.cache.set(id, ephemeralExec);
        return ephemeralExec;

      case 'oxigraphMemory': {
        // Hydration reads data graph content, which is async. A store that is
        // already built can still be served synchronously; one that is not has
        // to go through `getExecutorForNode()`.
        const built = oxigraphStoreManager.getMemoryStore(backend.$id);
        if (!built) {
          throw new Error(
            `Backend ${id} is an in-memory Oxigraph store that has not been hydrated yet. Use getExecutorForNode() instead.`,
          );
        }
        // Not cached — see `createMemoryExecutor`.
        return this.wrapForMode(new OxigraphSparqlExecutor(built), backend);
      }
      
      default:
        throw new Error(`Unsupported backend type for ${id}: ${backend.backendType}`);
    }
  }

  private createBackendEphemeralExecutor(backend: LdkitBackend): ISparqlExecutor {
    const store = oxigraphStoreManager.getEphemeralStore(backend.$id) ?? oxigraphStoreManager.createEphemeralStore(backend.$id);
    return new OxigraphSparqlExecutor(store);
  }
}
