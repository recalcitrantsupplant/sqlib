/**
 * Capability profile for the DuckDB instance that backs ETL.
 *
 * ETL accepts arbitrary DuckDB SQL. Left unconfigured, DuckDB grants that SQL
 * host filesystem reads, outbound HTTP (via httpfs) and download-and-execute of
 * extensions — see issue #132. This module resolves which of those are granted,
 * from env, defaulting every one of them to off.
 *
 * WHAT ACTUALLY ENFORCES ANYTHING, measured against @duckdb/node-api 1.5.5-r.4
 * (DuckDB v1.5.5) rather than taken from the documentation. Every claim below
 * was re-measured on 1.5.5 when we moved off 1.4.3; none of them changed:
 *
 *   - `enable_external_access=false` at instance creation blocks file reads,
 *     network reads and INSTALL. It is startup-only: `SET enable_external_access=true`
 *     on a live database fails with "Cannot change ... while database is running".
 *     This is the one hard boundary available to us.
 *   - `autoinstall_known_extensions` / `autoload_known_extensions` = false stop
 *     httpfs (and friends) appearing on demand.
 *   - `SET lock_configuration=true`, applied on a boot connection before any
 *     caller SQL runs, blocks every later `SET` — including from a second
 *     connection on the same instance. Without it, submitted SQL rewrites the
 *     profile at runtime.
 *
 * WHAT DOES NOT WORK, and is therefore deliberately not offered as a knob:
 * a directory allowlist. `allowed_directories` and `allowed_paths` are rejected
 * outright by this binding's instance config ("Failed to set config"), and when
 * set over SQL they are accepted and then enforce nothing — with
 * `allowed_directories=['/tmp']` set and the configuration locked,
 * `read_csv('/etc/passwd')` still returns rows. Still true on 1.5.5, so the
 * upgrade did not buy us the allowlist. A knob that appears to confine ETL to a
 * directory but does not is worse than no knob, so filesystem access here is
 * all-or-nothing until the binding supports it.
 */

export type DuckDbCapabilities = {
  /** Host filesystem reads and writes. Implied by `http`, which shares DuckDB's one switch. */
  filesystem: boolean;
  /** Outbound HTTP(S) reads. Requires `filesystem`, because DuckDB gates both on one setting. */
  http: boolean;
  /**
   * Autoinstall and autoload of known extensions.
   *
   * Note the limit: this governs what DuckDB does *implicitly*. It is not a ban
   * on `INSTALL`. With `filesystem` granted, DuckDB can write to the extension
   * directory and an explicit `INSTALL` succeeds regardless of this flag — what
   * makes INSTALL fail in the default profile is `enable_external_access=false`,
   * not this setting. So this is the difference between "a query mentioning an
   * https:// path silently pulls httpfs" and "it errors telling you to load it".
   */
  extensionInstall: boolean;
  /** Escape hatch: the pre-#132 behaviour, with nothing configured and nothing locked. */
  unrestricted: boolean;
};

/**
 * What an ETL query may *consume*, as opposed to what it may reach.
 *
 * The capability profile above closes off the filesystem, the network and
 * extensions, and says nothing about time or memory: before issue #202 there
 * was no deadline and no memory ceiling, so `SELECT count(*) FROM
 * range(100000000000)` held a worker and the request that started it for as
 * long as it took. Both halves of the fix are measured against
 * @duckdb/node-api 1.5.5-r.4:
 *
 *   - `connection.interrupt()` cancels the in-flight query: the pending
 *     `runAndReadAll` rejects with "INTERRUPT Error: Interrupted!", and the
 *     connection is usable afterwards.
 *   - `memory_limit` is accepted by the instance config (unlike
 *     `allowed_directories`, see above) and is covered by
 *     `lock_configuration=true`: `SET memory_limit='10GB'` on a later
 *     connection fails with "the configuration has been locked".
 *
 * Two deadlines, because the two paths have different shapes. `getSchema` and
 * `preview` are interactive — the playground route reaches them, and a person
 * is waiting — so they get the short one. A chunk read belongs to a job that is
 * expected to take a while, so it gets the long one.
 */
export type DuckDbLimits = {
  /** Deadline for `getSchema` and `preview`, in ms. */
  interactiveTimeoutMs: number;
  /** Deadline for one chunk of a job execution, in ms. */
  queryTimeoutMs: number;
  /** DuckDB's own `memory_limit`, or null to leave the engine's default. */
  memoryLimit: string | null;
};

export const DUCKDB_LIMIT_ENV_VARS = {
  interactiveTimeoutMs: 'ETL_DUCKDB_INTERACTIVE_TIMEOUT_MS',
  queryTimeoutMs: 'ETL_DUCKDB_QUERY_TIMEOUT_MS',
  memoryLimit: 'ETL_DUCKDB_MEMORY_LIMIT',
} as const satisfies Record<keyof DuckDbLimits, string>;

export const DUCKDB_LIMIT_DEFAULTS: DuckDbLimits = {
  interactiveTimeoutMs: 30_000,
  queryTimeoutMs: 300_000,
  // Conservative like the rest of the profile, and low enough that a runaway
  // aggregate errors instead of taking whatever the container has.
  memoryLimit: '1GB',
};

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

/** The `DuckDBInstance.create` config for a profile. Not used when `unrestricted`. */
export function duckDbInstanceConfig(
  capabilities: DuckDbCapabilities,
  limits: DuckDbLimits = resolveDuckDbLimits(),
): Record<string, string> {
  return {
    enable_external_access: String(capabilities.filesystem),
    autoinstall_known_extensions: String(capabilities.extensionInstall),
    autoload_known_extensions: String(capabilities.extensionInstall),
    ...(limits.memoryLimit ? { memory_limit: limits.memoryLimit } : {}),
  };
}

/** One line at boot, so a deployment's actual posture is greppable in the logs. */
export function describeDuckDbCapabilities(capabilities: DuckDbCapabilities): string {
  if (capabilities.unrestricted) {
    return `filesystem=UNRESTRICTED http=UNRESTRICTED extensionInstall=UNRESTRICTED (${DUCKDB_CAPABILITY_ENV_VARS.unrestricted}=true)`;
  }
  return [
    `filesystem=${capabilities.filesystem}`,
    `http=${capabilities.http}`,
    `extensionInstall=${capabilities.extensionInstall}`,
    'configLocked=true',
  ].join(' ');
}

/** The companion line for the resource limits, in the same greppable style. */
export function describeDuckDbLimits(limits: DuckDbLimits): string {
  const deadline = (ms: number) => (ms === 0 ? 'none' : `${ms}ms`);
  return [
    `interactiveTimeout=${deadline(limits.interactiveTimeoutMs)}`,
    `queryTimeout=${deadline(limits.queryTimeoutMs)}`,
    `memoryLimit=${limits.memoryLimit ?? 'engine default'}`,
  ].join(' ');
}
