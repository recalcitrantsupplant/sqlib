import { describe, expect, it } from 'vitest';
import { LeaseBusyError, ObjectLease, type LeaseObjectStore } from '../../src/replication/lease.js';

/** One object with ETag-style versions, as S3, Azure Blob and GCS keep it. */
function memoryStore(): LeaseObjectStore & { body(): unknown; fail: boolean } {
  let object: { body: string; version: string } | null = null;
  let next = 1;
  const store = {
    description: 'memory://lease',
    fail: false,
    body: () => (object ? JSON.parse(object.body) : null),
    async read() {
      if (store.fail) throw new Error('store unreachable');
      return object ? { ...object } : null;
    },
    async create(body: string) {
      if (store.fail) throw new Error('store unreachable');
      if (object) return null;
      object = { body, version: String(next++) };
      return object.version;
    },
    async replace(body: string, version: string) {
      if (store.fail) throw new Error('store unreachable');
      if (!object || object.version !== version) return null;
      object = { body, version: String(next++) };
      return object.version;
    },
  };
  return store;
}

function clock(start = Date.parse('2026-11-04T00:00:00Z')) {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms: number) => { now += ms; },
    advance: (ms: number) => { now += ms; },
  };
}

describe('ObjectLease', () => {
  it('takes a free lease and writes who holds it until when', async () => {
    const store = memoryStore();
    const time = clock();
    const lease = new ObjectLease(store, { ttlMs: 30_000, holder: 'a', ...time });
    await lease.acquire(0);
    expect(store.body()).toMatchObject({ holder: 'a', expiresAt: '2026-11-04T00:00:30.000Z' });
  });

  it('makes a second holder wait, then fails when the first does not let go', async () => {
    const store = memoryStore();
    const time = clock();
    await new ObjectLease(store, { ttlMs: 30_000, holder: 'a', ...time }).acquire(0);
    const second = new ObjectLease(store, { ttlMs: 30_000, holder: 'b', retryMs: 2_000, graceMs: 5_000, ...time });
    await expect(second.acquire(10_000)).rejects.toBeInstanceOf(LeaseBusyError);
  });

  it('lets a second holder in at once after a release', async () => {
    const store = memoryStore();
    const time = clock();
    const first = new ObjectLease(store, { ttlMs: 30_000, holder: 'a', ...time });
    await first.acquire(0);
    await first.release();
    await new ObjectLease(store, { ttlMs: 30_000, holder: 'b', ...time }).acquire(0);
    expect(store.body()).toMatchObject({ holder: 'b' });
  });

  it('takes over an expired lease only after the grace period', async () => {
    const store = memoryStore();
    const time = clock();
    await new ObjectLease(store, { ttlMs: 30_000, holder: 'a', ...time }).acquire(0);
    time.advance(31_000);
    const second = new ObjectLease(store, { ttlMs: 30_000, holder: 'b', graceMs: 5_000, retryMs: 1_000, ...time });
    await expect(second.acquire(0)).rejects.toBeInstanceOf(LeaseBusyError);
    await second.acquire(10_000);
    expect(store.body()).toMatchObject({ holder: 'b' });
    expect(time.now()).toBeGreaterThanOrEqual(Date.parse('2026-11-04T00:00:35Z'));
  });

  it('tells the old holder it lost the lease on its next renewal', async () => {
    const store = memoryStore();
    const time = clock();
    const first = new ObjectLease(store, { ttlMs: 30_000, holder: 'a', ...time });
    await first.acquire(0);
    expect(await first.renew()).toBe(true);
    time.advance(40_000);
    await new ObjectLease(store, { ttlMs: 30_000, holder: 'b', ...time }).acquire(0);
    expect(await first.renew()).toBe(false);
  });

  it('treats an unreadable lease as free', async () => {
    const store = memoryStore();
    await store.create('not json');
    await new ObjectLease(store, { ttlMs: 30_000, holder: 'b', ...clock() }).acquire(0);
    expect(store.body()).toMatchObject({ holder: 'b' });
  });

  it('passes store errors on renewal to the caller, and never throws on release', async () => {
    const store = memoryStore();
    const lease = new ObjectLease(store, { ttlMs: 30_000, holder: 'a', ...clock() });
    await lease.acquire(0);
    store.fail = true;
    await expect(lease.renew()).rejects.toThrow('store unreachable');
    await expect(lease.release()).resolves.toBeUndefined();
  });
});
