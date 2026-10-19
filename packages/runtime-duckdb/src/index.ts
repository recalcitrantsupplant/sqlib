/**
 * `@sparql-query-lib/runtime-duckdb` — a sandboxed DuckDB for ETL sources.
 *
 * The host supplies the capability profile and the limits. The API reads them
 * from the environment and defaults every capability to off; the CLI takes them
 * from flags. Either way the instance is configured once, its configuration is
 * locked before any caller SQL runs, and every read runs under a deadline.
 * See `docs/guides/etl.md`.
 */
export {
  DUCKDB_CLOSED_PROFILE,
  DUCKDB_LIMIT_DEFAULTS,
  describeDuckDbCapabilities,
  describeDuckDbLimits,
  duckDbInstanceConfig,
  type DuckDbCapabilities,
  type DuckDbLimits,
} from './capabilities.js';

export {
  DuckDbFixtureError,
  DuckDbService,
  DuckDbTimeoutError,
  mapDuckDbTypeToXsd,
  type DuckDbChunk,
  type DuckDbChunkTiming,
  type DuckDbColumn,
  type DuckDbExtensionCheck,
  type DuckDbLogFn,
  type DuckDbLogger,
  type DuckDbServiceOptions,
  type PreviewResult,
  type QueryResult,
  type StreamChunksOptions,
} from './DuckDbService.js';
