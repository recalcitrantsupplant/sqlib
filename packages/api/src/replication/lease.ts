/**
 * One writer per replica: a lease object next to the replica.
 *
 * Litestream assumes one process writes one replica path. A platform that
 * starts the new instance before it stops the old one (Azure Container Apps,
 * AWS App Runner) breaks that for the length of the overlap. The lease turns
 * the overlap into a wait: the new instance does not restore until the old
 * one has released the lease, after its last sync.
 *
 * The lease is a small JSON object written with conditional writes (create if
 * absent; replace if unchanged since read). S3, Azure Blob and GCS all offer
 * those, so one algorithm serves every store. See `lease/*.ts`.
 *
 * Limits: the lease has no fencing token. A holder that is frozen past its
 * expiry and then wakes could still write. The holder stops itself when it
 * has not renewed for a whole TTL, and a taker waits a further grace period,
 * which keeps that window to seconds.
 */
import os from 'node:os';
import { randomUUID } from 'node:crypto';

/** A conditional-write view of one object. `version` is an ETag or a generation. */
export interface LeaseObjectStore {
  /** Where the lease lives, for log lines. */
  readonly description: string;
  /** The object and its version, or null when it does not exist. */
  read(): Promise<{ body: string; version: string } | null>;
  /** Writes only if the object does not exist. The new version, or null if it exists. */
  create(body: string): Promise<string | null>;
  /** Writes only if the object is still at `version`. The new version, or null if it changed. */
  replace(body: string, version: string): Promise<string | null>;
}

export interface LeaseRecord {
  holder: string;
  acquiredAt: string;
  expiresAt: string;
}

export class LeaseBusyError extends Error {
  constructor(readonly record: LeaseRecord | null, where: string, waitedMs: number) {
    super(
      `Another sqlib instance holds the replica lease at ${where}` +
        (record ? ` (${record.holder}, until ${record.expiresAt})` : '') +
        `, and it was not released within ${Math.round(waitedMs / 1000)}s. ` +
        'Stop the other instance, or wait for its lease to expire.'
    );
    this.name = 'LeaseBusyError';
  }
}

export interface Lease {
  readonly description: string;
  readonly holder: string;
  /** Waits up to `waitMs` for the lease. Throws `LeaseBusyError` when it stays taken. */
  acquire(waitMs: number): Promise<void>;
  /** True when renewed; false when another holder took it. Throws on a store error. */
  renew(): Promise<boolean>;
  /** Marks the lease expired so the next instance can take it at once. Never throws. */
  release(): Promise<void>;
}

export interface ObjectLeaseOptions {
  ttlMs: number;
  /** Extra time a taker waits past `expiresAt`, for clock skew. */
  graceMs?: number;
  /** Delay between attempts while the lease is held by another. */
  retryMs?: number;
  holder?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseRecord(body: string): LeaseRecord | null {
  try {
    const value = JSON.parse(body) as Partial<LeaseRecord>;
    if (typeof value.holder === 'string' && typeof value.expiresAt === 'string') {
      return { holder: value.holder, acquiredAt: String(value.acquiredAt ?? ''), expiresAt: value.expiresAt };
    }
  } catch {
    // An unreadable lease is treated as expired: it cannot name a live holder.
  }
  return null;
}

export class ObjectLease implements Lease {
  readonly holder: string;
  private version: string | null = null;
  private acquiredAt = '';
  private readonly ttlMs: number;
  private readonly graceMs: number;
  private readonly retryMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly store: LeaseObjectStore, options: ObjectLeaseOptions) {
    this.ttlMs = options.ttlMs;
    this.graceMs = options.graceMs ?? 5_000;
    this.retryMs = options.retryMs ?? 2_000;
    this.holder = options.holder ?? `${os.hostname()}/${process.pid}/${randomUUID().slice(0, 8)}`;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get description(): string {
    return this.store.description;
  }

  private body(expiresAtMs: number): string {
    return JSON.stringify({
      holder: this.holder,
      acquiredAt: this.acquiredAt,
      expiresAt: new Date(expiresAtMs).toISOString(),
    } satisfies LeaseRecord);
  }

  /** One attempt. The record that blocks it, or null when the lease is now ours. */
  private async tryAcquire(): Promise<{ blockedBy: LeaseRecord | null } | null> {
    this.acquiredAt = new Date(this.now()).toISOString();
    const current = await this.store.read();
    if (!current) {
      const version = await this.store.create(this.body(this.now() + this.ttlMs));
      if (version) {
        this.version = version;
        return null;
      }
      return { blockedBy: null };
    }

    const record = parseRecord(current.body);
    const free =
      !record ||
      record.holder === this.holder ||
      Date.parse(record.expiresAt) + this.graceMs <= this.now() ||
      Number.isNaN(Date.parse(record.expiresAt));
    if (!free) return { blockedBy: record };

    const version = await this.store.replace(this.body(this.now() + this.ttlMs), current.version);
    if (version) {
      this.version = version;
      return null;
    }
    return { blockedBy: record };
  }

  async acquire(waitMs: number): Promise<void> {
    const deadline = this.now() + waitMs;
    for (;;) {
      const attempt = await this.tryAcquire();
      if (!attempt) return;
      if (this.now() + this.retryMs > deadline) {
        throw new LeaseBusyError(attempt.blockedBy, this.store.description, waitMs);
      }
      await this.sleep(this.retryMs);
    }
  }

  async renew(): Promise<boolean> {
    if (!this.version) return false;
    const version = await this.store.replace(this.body(this.now() + this.ttlMs), this.version);
    if (!version) {
      this.version = null;
      return false;
    }
    this.version = version;
    return true;
  }

  async release(): Promise<void> {
    if (!this.version) return;
    try {
      // Expired rather than deleted: a conditional replace works on every
      // store, and a conditional delete does not.
      await this.store.replace(this.body(0), this.version);
    } catch {
      // The lease then expires on its own after the TTL.
    }
    this.version = null;
  }
}
