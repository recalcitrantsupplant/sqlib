/**
 * Configuration types for internal backends.
 *
 * IMPORTANT: The oxigraph JavaScript/WebAssembly bindings only support in-memory stores.
 * There is NO RocksDB disk-backed persistence like in Rust/Python bindings.
 *
 * - 'oxigraph-persistent': a "durable" store — in-memory, serialized to .nq in
 *   LIBRARY_STORAGE_DIR on a checkpoint interval and on shutdown, restored at boot.
 * - 'oxigraph-memory': an ephemeral in-memory store. It touches no disk at all:
 *   no snapshot is restored, no checkpoint loop runs, and nothing is written on
 *   shutdown. The library lives exactly as long as the process. This is the mode
 *   for tests and throwaway development, and it is what the test suite defaults to.
 *
 * For true disk-backed persistence, run oxigraph-server as a sidecar and use HTTP backend.
 *
 * Note that these name the store the *library* lives in, and are unrelated to the
 * `oxigraphMemory` / `oxigraphEphemeral` Backend entities that queries run against.
 * The words overlap; the two axes do not.
 */
import path from 'node:path';
import type { OxigraphSourceConfig } from '../persistence/schemas/BackendSchema.js';

interface HttpEndpointConfig {
  type: 'http';
  baseUrl: string;
  queryUrl: string;
  updateUrl?: string; // Optional, might be same as queryUrl
  username?: string; // Optional username for basic auth
  password?: string; // Optional password for basic auth
}

interface OxigraphMemoryConfig {
  type: 'oxigraph-memory';
  /**
   * @deprecated This field is ignored. Oxigraph JS only supports in-memory stores,
   * and an ephemeral library store has no serialization path to point anywhere.
   */
  dbPath?: string;
}

/**
 * Configuration for "durable" oxigraph stores.
 * Note: These are NOT true disk-backed RocksDB stores. They are in-memory stores
 * that are serialized to .nq files on shutdown and restored on startup.
 */
interface OxigraphPersistentConfig {
  type: 'oxigraph-persistent';
  storeId: string;
  /**
   * @deprecated This field is ignored. Oxigraph JS does not support RocksDB paths.
   * Serialization happens to .nq files in storageDir.
   */
  persistPath: string;
  loadMethod: 'file' | 'remote-sparql' | 'remote-file' | 'none';
  sourceConfig?: OxigraphSourceConfig;
  /** Directory where .nq serialization files are stored */
  storageDir: string;
  /** Interval in milliseconds to periodically checkpoint in-memory stores to disk */
  checkpointIntervalMs?: number;
}

// Union type for the internal backend configuration
type InternalBackendConfig = HttpEndpointConfig | OxigraphMemoryConfig | OxigraphPersistentConfig;

export interface Config {
  enableTimingLogs: boolean;
  internalBackend: InternalBackendConfig;
  cacheWriteThroughEnabled: boolean;
  cachePreloadEnabled: boolean;
}

// Function to determine backend config from environment variables or defaults
function getInternalBackendConfig(): InternalBackendConfig {
  const backendType = process.env.INTERNAL_BACKEND_TYPE || 'http'; // Default to http

  if (backendType === 'oxigraph-memory') {
    return {
      type: 'oxigraph-memory',
      dbPath: process.env.INTERNAL_OXIGRAPH_DB_PATH // Optional path
    };
  }

  if (backendType === 'oxigraph-persistent') {
    const storageDir = path.resolve(process.env.LIBRARY_STORAGE_DIR || './storage/library-store');
    const rawPersistPath = process.env.INTERNAL_OXIGRAPH_DB_PATH || path.join(storageDir, 'rocksdb');
    const persistPath = path.resolve(rawPersistPath);

    const allowedLoadMethods = new Set(['file', 'remote-sparql', 'remote-file', 'none']);
    const requestedLoadMethod = (process.env.INTERNAL_OXIGRAPH_LOAD_METHOD || 'none').toLowerCase();
    const loadMethod = allowedLoadMethods.has(requestedLoadMethod)
      ? (requestedLoadMethod as OxigraphPersistentConfig['loadMethod'])
      : 'none';

    let sourceConfig: OxigraphSourceConfig | undefined;
    const bootstrapSource = process.env.INTERNAL_OXIGRAPH_BOOTSTRAP_SOURCE;
    if (bootstrapSource) {
      try {
        const parsed = JSON.parse(bootstrapSource);
        if (parsed && typeof parsed === 'object') {
          sourceConfig = parsed as OxigraphSourceConfig;
        }
      } catch (error) {
        console.warn('[config] Failed to parse INTERNAL_OXIGRAPH_BOOTSTRAP_SOURCE JSON:', error);
      }
    }

    return {
      type: 'oxigraph-persistent',
      storeId: process.env.INTERNAL_OXIGRAPH_STORE_ID || 'library-store',
      persistPath,
      loadMethod,
      sourceConfig,
      storageDir,
      checkpointIntervalMs: process.env.INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS ?
        parseInt(process.env.INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS, 10) : 60000, // 1 min default
    };
  }

  /*
   * Default to HTTP configuration. The fallback is a local Fuseki on its
   * conventional port, so an unconfigured server fails against localhost
   * rather than reaching out to whatever host a default once named. Set
   * LIBRARY_STORAGE_SPARQL_ENDPOINT to point at the store you mean.
   */
  const endpoint = process.env.LIBRARY_STORAGE_SPARQL_ENDPOINT || 'http://localhost:3030/sqlib/';
  const queryUrl = process.env.LIBRARY_STORAGE_SPARQL_QUERY_ENDPOINT || endpoint;
  const updateUrl = process.env.LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT || endpoint;
  const username = process.env.LIBRARY_STORAGE_SPARQL_USERNAME; // Optional username
  const password = process.env.LIBRARY_STORAGE_SPARQL_PASSWORD; // Optional password

  return {
    type: 'http',
    baseUrl: endpoint,
    queryUrl: queryUrl,
    updateUrl: updateUrl,
    username: username,
    password: password
  };
}


// Use getter to allow dynamic env var changes (important for tests)
export const config: Config = {
  enableTimingLogs: process.env.ENABLE_TIMING_LOGS === 'true' || true, // Default to true
  internalBackend: getInternalBackendConfig(),
  get cacheWriteThroughEnabled(): boolean {
    return process.env.CACHE_WRITE_THROUGH !== 'false'; // Default true, set to 'false' to disable
  },
  get cachePreloadEnabled(): boolean {
    const flag = process.env.CACHE_PRELOAD;
    if (typeof flag === 'string') {
      return flag.toLowerCase() !== 'false';
    }
    return true;
  }
};
