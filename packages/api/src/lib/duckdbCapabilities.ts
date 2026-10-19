/**
 * The DuckDB capability profile and limits, as this deployment configures them.
 *
 * What a profile means, and what DuckDB actually enforces, is documented with
 * the types in `@sparql-query-lib/runtime-duckdb`. This module holds what only
 * the API needs: reading the profile and the limits from the environment,
 * with every capability defaulting to off. See `docs/guides/etl.md`.
 */
import {
  DUCKDB_LIMIT_DEFAULTS,
  duckDbInstanceConfig as instanceConfigFor,
  type DuckDbCapabilities,
  type DuckDbLimits,
} from '@sparql-query-lib/runtime-duckdb';

export {
  DUCKDB_LIMIT_DEFAULTS,
  describeDuckDbCapabilities,
  describeDuckDbLimits,
  type DuckDbCapabilities,
  type DuckDbLimits,
} from '@sparql-query-lib/runtime-duckdb';

export const DUCKDB_LIMIT_ENV_VARS = {
  interactiveTimeoutMs: 'ETL_DUCKDB_INTERACTIVE_TIMEOUT_MS',
  queryTimeoutMs: 'ETL_DUCKDB_QUERY_TIMEOUT_MS',
  memoryLimit: 'ETL_DUCKDB_MEMORY_LIMIT',
} as const satisfies Record<keyof DuckDbLimits, string>;

export const DUCKDB_CAPABILITY_ENV_VARS = {
  filesystem: 'ETL_DUCKDB_ALLOW_FILESYSTEM',
  http: 'ETL_DUCKDB_ALLOW_HTTP',
  extensionInstall: 'ETL_DUCKDB_ALLOW_EXTENSION_INSTALL',
  unrestricted: 'ETL_DUCKDB_UNRESTRICTED',
} as const satisfies Record<keyof DuckDbCapabilities, string>;

const FALSE_LITERALS = new Set(['0', 'false', 'off', 'no', 'disabled']);
const TRUE_LITERALS = new Set(['1', 'true', 'on', 'yes', 'enabled']);

/** Mirrors `coerceFeatureFlagValue` in @sparql-query-lib/types, but defaults closed. */
function coerce(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return fallback;
  }
  if (FALSE_LITERALS.has(normalized)) {
    return false;
  }
  if (TRUE_LITERALS.has(normalized)) {
    return true;
  }
  return fallback;
}

/** A positive integer of milliseconds, or the default when the value is not one. */
function coercePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/**
 * The resource limits for this deployment.
 *
 * A timeout of `0` is how a deployment opts out of the deadline — the one way
 * to say "no limit", since every other unparseable value falls back to the
 * default rather than silently removing the ceiling.
 */
export function resolveDuckDbLimits(
  env: Record<string, string | undefined> = process.env,
): DuckDbLimits {
  const timeout = (name: keyof typeof DUCKDB_LIMIT_ENV_VARS, fallback: number): number => {
    const raw = env[DUCKDB_LIMIT_ENV_VARS[name]]?.trim();
    if (raw === '0') {
      return 0;
    }
    return coercePositiveInt(raw, fallback);
  };

  const memoryLimit = env[DUCKDB_LIMIT_ENV_VARS.memoryLimit]?.trim();

  return {
    interactiveTimeoutMs: timeout('interactiveTimeoutMs', DUCKDB_LIMIT_DEFAULTS.interactiveTimeoutMs),
    queryTimeoutMs: timeout('queryTimeoutMs', DUCKDB_LIMIT_DEFAULTS.queryTimeoutMs),
    // An empty value is how a deployment asks for DuckDB's own default back.
    memoryLimit: memoryLimit === undefined ? DUCKDB_LIMIT_DEFAULTS.memoryLimit : memoryLimit || null,
  };
}

export function resolveDuckDbCapabilities(
  env: Record<string, string | undefined> = process.env,
): DuckDbCapabilities {
  const unrestricted = coerce(env[DUCKDB_CAPABILITY_ENV_VARS.unrestricted]);
  const http = coerce(env[DUCKDB_CAPABILITY_ENV_VARS.http]);

  return {
    // DuckDB has a single `enable_external_access` switch covering local files and
    // the network, so asking for HTTP necessarily grants filesystem access too.
    // Better to make that visible in the resolved profile than to imply a
    // separation the engine does not have.
    filesystem: coerce(env[DUCKDB_CAPABILITY_ENV_VARS.filesystem]) || http,
    http,
    extensionInstall: coerce(env[DUCKDB_CAPABILITY_ENV_VARS.extensionInstall]),
    unrestricted,
  };
}

/** The `DuckDBInstance.create` config for a profile, with this deployment's limits by default. */
export function duckDbInstanceConfig(
  capabilities: DuckDbCapabilities,
  limits: DuckDbLimits = resolveDuckDbLimits(),
): Record<string, string> {
  return instanceConfigFor(capabilities, limits);
}
