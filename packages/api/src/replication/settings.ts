/**
 * Settings for continuous backup of the SQLite stores to blob storage.
 *
 * Read from `SQLIB_SQLITE_REPLICA_*` and friends. Unset `SQLIB_SQLITE_REPLICA_URL`
 * (and no `SQLIB_LITESTREAM_CONFIG`) means the feature is off, and
 * `readReplicaSettings` returns null. See docs/guides/deploying.md, "Backup to
 * blob storage".
 */

export type ReplicaScheme = 's3' | 'abs' | 'gs';

/** What to do at start when a replica and a local file may both exist. */
export type RestorePolicy = 'replica' | 'local' | 'never';

/** A parsed replica URL. `path` has no leading or trailing slash. */
export interface ReplicaLocation {
  scheme: ReplicaScheme;
  /** Azure only: the storage account. */
  account?: string;
  /** The S3 or GCS bucket, or the Azure container. */
  bucket: string;
  path: string;
}

export interface ReplicaSettings {
  /** Unset only when an operator config file is given instead. */
  location?: ReplicaLocation;
  endpoint?: string;
  region?: string;
  /** Litestream durations, such as `1s` or `6h`. */
  syncInterval: string;
  snapshotInterval: string;
  retention: string;
  shutdownSyncTimeout: string;
  kmsKeyId?: string;
  /** True when `SQLIB_SQLITE_REPLICA_AZURE_SAS` holds a SAS token. */
  azureSas: boolean;
  metricsAddr?: string;
  restore: RestorePolicy;
  lease: boolean;
  leaseTtlMs: number;
  leaseRenewMs: number;
  leaseWaitMs: number;
  /** `SQLIB_LITESTREAM_CONFIG`: an operator-written config used as is. */
  customConfigPath?: string;
  /** The Litestream binary. */
  litestreamBin: string;
}

const DURATION = /^\d+(ms|s|m|h)$/;

function duration(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!DURATION.test(raw)) {
    throw new Error(`Invalid ${name} "${raw}". Expected a number and a unit, such as 500ms, 1s, 5m or 6h.`);
  }
  return raw;
}

/** A Litestream duration in milliseconds. */
export function durationMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value);
  if (!match) throw new Error(`Invalid duration "${value}".`);
  const n = Number(match[1]);
  switch (match[2]) {
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    default:
      return n * 3_600_000;
  }
}

/**
 * `s3://BUCKET/PATH`, `abs://ACCOUNT@CONTAINER/PATH` or `gs://BUCKET/PATH`.
 */
export function parseReplicaUrl(raw: string): ReplicaLocation {
  const match = /^([a-z0-9]+):\/\/([^/]+)(?:\/(.*))?$/.exec(raw.trim());
  if (!match) {
    throw new Error(`Invalid SQLIB_SQLITE_REPLICA_URL "${raw}". Expected s3://BUCKET/PATH, abs://ACCOUNT@CONTAINER/PATH or gs://BUCKET/PATH.`);
  }
  const [, scheme, host, rest = ''] = match;
  const path = rest.replace(/^\/+|\/+$/g, '');

  if (scheme === 's3' || scheme === 'gs') {
    if (host.includes('@')) {
      throw new Error(`Invalid SQLIB_SQLITE_REPLICA_URL "${raw}": ${scheme}:// takes a bucket name, not ACCOUNT@BUCKET.`);
    }
    return { scheme, bucket: host, path };
  }
  if (scheme === 'abs') {
    const at = host.indexOf('@');
    if (at <= 0 || at === host.length - 1) {
      throw new Error(`Invalid SQLIB_SQLITE_REPLICA_URL "${raw}": abs:// needs ACCOUNT@CONTAINER.`);
    }
    return { scheme, account: host.slice(0, at), bucket: host.slice(at + 1), path };
  }
  throw new Error(`Invalid SQLIB_SQLITE_REPLICA_URL "${raw}": unsupported scheme "${scheme}". Expected s3, abs or gs.`);
}

/** The URL of one database's replica: the base URL plus `/<name>`. */
export function replicaUrlFor(location: ReplicaLocation, name: string): string {
  const host = location.scheme === 'abs' ? `${location.account}@${location.bucket}` : location.bucket;
  const path = location.path ? `${location.path}/${name}` : name;
  return `${location.scheme}://${host}/${path}`;
}

/** The object key of the lease, next to the databases' replicas. */
export function leaseKeyFor(location: ReplicaLocation): string {
  return location.path ? `${location.path}/lease` : 'lease';
}

function restorePolicy(raw: string | undefined): RestorePolicy {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'replica') return 'replica';
  if (value === 'local' || value === 'never') return value;
  throw new Error(`Invalid SQLIB_SQLITE_RESTORE "${raw}". Expected replica, local or never.`);
}

function onOff(name: string, raw: string | undefined, fallback: boolean): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return fallback;
  if (['on', 'true', '1', 'yes'].includes(value)) return true;
  if (['off', 'false', '0', 'no'].includes(value)) return false;
  throw new Error(`Invalid ${name} "${raw}". Expected on or off.`);
}

export function readReplicaSettings(env: NodeJS.ProcessEnv = process.env): ReplicaSettings | null {
  const url = env.SQLIB_SQLITE_REPLICA_URL?.trim();
  const customConfigPath = env.SQLIB_LITESTREAM_CONFIG?.trim() || undefined;
  if (!url && !customConfigPath) return null;

  const location = url ? parseReplicaUrl(url) : undefined;
  const kmsKeyId = env.SQLIB_SQLITE_REPLICA_KMS_KEY_ID?.trim() || undefined;
  if (kmsKeyId && location && location.scheme !== 's3') {
    throw new Error('SQLIB_SQLITE_REPLICA_KMS_KEY_ID applies to s3:// replicas only. Set encryption on the Azure account or GCS bucket instead.');
  }
  const azureSas = Boolean(env.SQLIB_SQLITE_REPLICA_AZURE_SAS?.trim());
  if (azureSas && location && location.scheme !== 'abs') {
    throw new Error('SQLIB_SQLITE_REPLICA_AZURE_SAS applies to abs:// replicas only.');
  }

  const leaseTtlMs = durationMs(duration(env, 'SQLIB_SQLITE_REPLICA_LEASE_TTL', '30s'));
  const leaseRenewMs = durationMs(duration(env, 'SQLIB_SQLITE_REPLICA_LEASE_RENEW', '10s'));
  if (leaseRenewMs * 2 > leaseTtlMs) {
    throw new Error('SQLIB_SQLITE_REPLICA_LEASE_RENEW must be at most half of SQLIB_SQLITE_REPLICA_LEASE_TTL, so one failed renewal does not lose the lease.');
  }

  return {
    location,
    endpoint: env.SQLIB_SQLITE_REPLICA_ENDPOINT?.trim() || undefined,
    region: env.SQLIB_SQLITE_REPLICA_REGION?.trim() || undefined,
    syncInterval: duration(env, 'SQLIB_SQLITE_REPLICA_SYNC_INTERVAL', '1s'),
    snapshotInterval: duration(env, 'SQLIB_SQLITE_REPLICA_SNAPSHOT_INTERVAL', '6h'),
    retention: duration(env, 'SQLIB_SQLITE_REPLICA_RETENTION', '72h'),
    shutdownSyncTimeout: duration(env, 'SQLIB_SQLITE_REPLICA_SHUTDOWN_TIMEOUT', '10s'),
    kmsKeyId,
    azureSas,
    metricsAddr: env.SQLIB_SQLITE_REPLICA_METRICS_ADDR?.trim() || undefined,
    restore: restorePolicy(env.SQLIB_SQLITE_RESTORE),
    // The lease lives next to the replica, so an operator config without a
    // replica URL has nowhere to put it.
    lease: location ? onOff('SQLIB_SQLITE_REPLICA_LEASE', env.SQLIB_SQLITE_REPLICA_LEASE, true) : false,
    leaseTtlMs,
    leaseRenewMs,
    leaseWaitMs: durationMs(duration(env, 'SQLIB_SQLITE_REPLICA_LEASE_WAIT', '120s')),
    customConfigPath,
    litestreamBin: env.SQLIB_LITESTREAM_BIN?.trim() || 'litestream',
  };
}
