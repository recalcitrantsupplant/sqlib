import { describe, expect, it } from 'vitest';
import { durationMs, leaseKeyFor, parseReplicaUrl, readReplicaSettings, replicaUrlFor } from '../../src/replication/settings.js';

describe('replication settings', () => {
  it('is off when neither a replica URL nor an operator config is set', () => {
    expect(readReplicaSettings({})).toBeNull();
    expect(readReplicaSettings({ SQLIB_SQLITE_REPLICA_URL: '  ' })).toBeNull();
  });

  it('has the documented defaults', () => {
    const settings = readReplicaSettings({ SQLIB_SQLITE_REPLICA_URL: 's3://bucket/prod' })!;
    expect(settings).toMatchObject({
      location: { scheme: 's3', bucket: 'bucket', path: 'prod' },
      syncInterval: '1s',
      snapshotInterval: '6h',
      retention: '72h',
      shutdownSyncTimeout: '10s',
      restore: 'replica',
      lease: true,
      leaseTtlMs: 30_000,
      leaseRenewMs: 10_000,
      leaseWaitMs: 120_000,
      litestreamBin: 'litestream',
      azureSas: false,
    });
  });

  it('parses each URL form', () => {
    expect(parseReplicaUrl('s3://b/a/b/')).toEqual({ scheme: 's3', bucket: 'b', path: 'a/b' });
    expect(parseReplicaUrl('gs://b')).toEqual({ scheme: 'gs', bucket: 'b', path: '' });
    expect(parseReplicaUrl('abs://acct@container/prod')).toEqual({ scheme: 'abs', account: 'acct', bucket: 'container', path: 'prod' });
  });

  it('refuses malformed URLs', () => {
    expect(() => parseReplicaUrl('ftp://host/x')).toThrow(/unsupported scheme "ftp"/);
    expect(() => parseReplicaUrl('abs://container/prod')).toThrow(/ACCOUNT@CONTAINER/);
    expect(() => parseReplicaUrl('s3://a@b/prod')).toThrow(/bucket name/);
    expect(() => parseReplicaUrl('bucket/prod')).toThrow(/Invalid SQLIB_SQLITE_REPLICA_URL/);
  });

  it('puts each database and the lease under the base path', () => {
    const azure = parseReplicaUrl('abs://acct@c/prod');
    expect(replicaUrlFor(azure, 'library')).toBe('abs://acct@c/prod/library');
    expect(leaseKeyFor(azure)).toBe('prod/lease');
    const bare = parseReplicaUrl('s3://b');
    expect(replicaUrlFor(bare, 'auth')).toBe('s3://b/auth');
    expect(leaseKeyFor(bare)).toBe('lease');
  });

  it('validates durations, the restore policy and the lease switch', () => {
    const base = { SQLIB_SQLITE_REPLICA_URL: 's3://b/p' };
    expect(() => readReplicaSettings({ ...base, SQLIB_SQLITE_REPLICA_SYNC_INTERVAL: 'soon' })).toThrow(/SYNC_INTERVAL/);
    expect(() => readReplicaSettings({ ...base, SQLIB_SQLITE_RESTORE: 'always' })).toThrow(/replica, local or never/);
    expect(() => readReplicaSettings({ ...base, SQLIB_SQLITE_REPLICA_LEASE: 'maybe' })).toThrow(/on or off/);
    expect(readReplicaSettings({ ...base, SQLIB_SQLITE_REPLICA_LEASE: 'off' })!.lease).toBe(false);
    expect(readReplicaSettings({ ...base, SQLIB_SQLITE_RESTORE: 'LOCAL' })!.restore).toBe('local');
    expect(durationMs('500ms')).toBe(500);
    expect(durationMs('2m')).toBe(120_000);
    expect(durationMs('1h')).toBe(3_600_000);
  });

  it('needs the renew interval to be at most half the TTL', () => {
    expect(() =>
      readReplicaSettings({ SQLIB_SQLITE_REPLICA_URL: 's3://b/p', SQLIB_SQLITE_REPLICA_LEASE_TTL: '10s', SQLIB_SQLITE_REPLICA_LEASE_RENEW: '6s' })
    ).toThrow(/at most half/);
  });

  it('refuses store options on the wrong store', () => {
    expect(() => readReplicaSettings({ SQLIB_SQLITE_REPLICA_URL: 'gs://b/p', SQLIB_SQLITE_REPLICA_KMS_KEY_ID: 'k' })).toThrow(/s3:\/\/ replicas only/);
    expect(() => readReplicaSettings({ SQLIB_SQLITE_REPLICA_URL: 's3://b/p', SQLIB_SQLITE_REPLICA_AZURE_SAS: 'sv=x' })).toThrow(/abs:\/\/ replicas only/);
  });

  it('turns the lease off for an operator config with no replica URL', () => {
    const settings = readReplicaSettings({ SQLIB_LITESTREAM_CONFIG: '/etc/litestream.yml' })!;
    expect(settings.customConfigPath).toBe('/etc/litestream.yml');
    expect(settings.location).toBeUndefined();
    expect(settings.lease).toBe(false);
  });
});
