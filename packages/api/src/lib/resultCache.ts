/**
 * Results kept for a short while, so a caller can pass one back by reference.
 *
 * A notebook chains cells by value: a result comes to the browser, and the
 * next cell sends it back up. For a large value the second trip is the waste.
 * A run that asks for it (`keepResult`) has its response body kept here under
 * a random handle, and a later request names the handle instead of resending
 * the content.
 *
 * It is a cache, not storage, and the limits are what keep it one:
 *
 * - Only a response this server produced goes in. There is no route that puts
 *   a caller's own content here, so it cannot be used as a file store.
 * - A handle is readable only by the subject that made the run. It is a
 *   random 128-bit id as well, but the owner check is what decides.
 * - Each subject has a byte quota; the subject's least recently used entries
 *   go first when a new one would pass it.
 * - Every entry expires a fixed time after it was last used.
 * - The whole cache has a byte cap. 0 turns the feature off: nothing is kept,
 *   and every handle is unknown.
 * - Memory only. A restart empties it, and a caller holding a handle that is
 *   gone gets a 410 and sends the value inline instead.
 */
import { randomUUID } from 'node:crypto';

export interface CachedResult {
  owner: string;
  body: string;
  contentType: string;
  bytes: number;
  lastUsed: number;
}

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface ResultCacheLimits {
  /** All entries together. 0 turns the cache off. */
  maxBytes: number;
  /** One subject's entries together. */
  maxBytesPerOwner: number;
  /** Time since last use after which an entry is gone. */
  ttlMs: number;
}

export function resultCacheLimitsFromEnv(): ResultCacheLimits {
  return {
    maxBytes: intFromEnv('RESULT_CACHE_MAX_BYTES', 256 * 1024 * 1024),
    maxBytesPerOwner: intFromEnv('RESULT_CACHE_MAX_BYTES_PER_USER', 10 * 1024 * 1024),
    ttlMs: intFromEnv('RESULT_CACHE_TTL_MS', 15 * 60 * 1000),
  };
}

/** Why a handle could not be read. */
export class ResultRefError extends Error {
  constructor(message: string, readonly statusCode: 404 | 410) {
    super(message);
    this.name = 'ResultRefError';
  }
}

export const RESULT_REF_PREFIX = 'urn:sqlib:result:';

export class ResultCache {
  private readonly entries = new Map<string, CachedResult>();
  private totalBytes = 0;

  constructor(private readonly limits: ResultCacheLimits, private readonly now: () => number = Date.now) {}

  get enabled(): boolean {
    return this.limits.maxBytes > 0;
  }

  /**
   * Keep a response body, and return its handle — or null when it is not kept:
   * the cache is off, or the body alone is over the subject's quota.
   */
  put(owner: string, body: string, contentType: string): string | null {
    if (!this.enabled) return null;
    this.sweep();
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > this.limits.maxBytesPerOwner || bytes > this.limits.maxBytes) return null;

    // Make room: this subject's own oldest first, then anyone's, oldest first.
    this.evictUntil(() => this.bytesOf(owner) + bytes <= this.limits.maxBytesPerOwner, owner);
    this.evictUntil(() => this.totalBytes + bytes <= this.limits.maxBytes);

    const handle = `${RESULT_REF_PREFIX}${randomUUID()}`;
    this.entries.set(handle, { owner, body, contentType, bytes, lastUsed: this.now() });
    this.totalBytes += bytes;
    return handle;
  }

  /** Read a handle as its owner. Using it restarts its expiry. */
  get(owner: string, handle: string): CachedResult {
    this.sweep();
    const entry = this.entries.get(handle);
    // Someone else's handle reads exactly as a missing one: its existence is
    // not the caller's to learn.
    if (!entry || entry.owner !== owner) {
      throw new ResultRefError(
        `The kept result ${handle} has expired or was never kept here. Send the value inline instead.`,
        410,
      );
    }
    entry.lastUsed = this.now();
    return entry;
  }

  /** Bytes held now, in all and for one subject. For tests and the health page. */
  usage(owner?: string): number {
    return owner === undefined ? this.totalBytes : this.bytesOf(owner);
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private bytesOf(owner: string): number {
    let total = 0;
    for (const entry of this.entries.values()) if (entry.owner === owner) total += entry.bytes;
    return total;
  }

  private sweep(): void {
    const cutoff = this.now() - this.limits.ttlMs;
    for (const [handle, entry] of this.entries) {
      if (entry.lastUsed < cutoff) this.drop(handle, entry);
    }
  }

  private evictUntil(fits: () => boolean, owner?: string): void {
    const candidates = [...this.entries]
      .filter(([, entry]) => owner === undefined || entry.owner === owner)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [handle, entry] of candidates) {
      if (fits()) return;
      this.drop(handle, entry);
    }
  }

  private drop(handle: string, entry: CachedResult): void {
    this.entries.delete(handle);
    this.totalBytes -= entry.bytes;
  }
}

let shared: ResultCache | null = null;

/** The process's cache, built from the environment on first use. */
export function getResultCache(): ResultCache {
  shared ??= new ResultCache(resultCacheLimitsFromEnv());
  return shared;
}

/** Replace the process's cache — tests only. Null rebuilds it from the environment. */
export function setResultCache(cache: ResultCache | null): void {
  shared = cache;
}
