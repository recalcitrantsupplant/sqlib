/**
 * The DuckDB service, as the API runs it.
 *
 * The service lives in `@sparql-query-lib/runtime-duckdb`, so the API and the
 * CLI read ETL sources through one sandbox. This module supplies what only the
 * API has: a profile and limits read from the environment, its pino logger,
 * and the process-wide singleton. Every importer in the API keeps importing
 * from here.
 */
import {
  DuckDbService as RuntimeDuckDbService,
  type DuckDbCapabilities,
  type DuckDbLimits,
} from '@sparql-query-lib/runtime-duckdb';
import { resolveDuckDbCapabilities, resolveDuckDbLimits } from './duckdbCapabilities.js';
import { log } from './log.js';

export {
  DuckDbFixtureError,
  DuckDbTimeoutError,
  mapDuckDbTypeToXsd,
  type DuckDbChunk,
  type DuckDbChunkTiming,
  type DuckDbColumn,
  type DuckDbExtensionCheck,
  type PreviewResult,
  type QueryResult,
  type StreamChunksOptions,
} from '@sparql-query-lib/runtime-duckdb';

export class DuckDbService extends RuntimeDuckDbService {
  constructor(
    capabilities: DuckDbCapabilities = resolveDuckDbCapabilities(),
    limits: DuckDbLimits = resolveDuckDbLimits(),
  ) {
    super(capabilities, limits, { logger: log });
  }
}

/*
 * Singleton instance, constructed on first use.
 *
 * The constructor starts `initialize()`, which dynamically imports
 * `@duckdb/node-api` (~80ms for the native binding) and opens an in-memory
 * DuckDB. Building it at module load meant every boot paid for it, including
 * the great majority that run with ETL off and never touch DuckDB at all.
 *
 * It stays a `duckDbService` object rather than becoming a `getDuckDbService()`
 * call so that the dozen call sites — and the `vi.mock` in four test files that
 * replaces this export with a stub — keep working untouched. The proxy
 * constructs on the first property read and forwards from there.
 *
 * A deployment that *does* serve ETL should not discover DuckDB on its first
 * request: `configureApp` warms this when the ETL or ETL-playground feature is
 * on, which starts initialization at boot exactly as before, without blocking.
 */
let instance: DuckDbService | null = null;

export function getDuckDbService(): DuckDbService {
  if (!instance) {
    instance = new DuckDbService();
  }
  return instance;
}

export const duckDbService: DuckDbService = new Proxy({} as DuckDbService, {
  get(_target, property) {
    const service = getDuckDbService();
    // Deliberately not forwarding the proxy as the receiver: any accessor must
    // run with `this` bound to the real service, not to the proxy.
    const value = (service as unknown as Record<string | symbol, unknown>)[property];
    return typeof value === 'function' ? value.bind(service) : value;
  },
  has(_target, property) {
    return property in getDuckDbService();
  },
});
