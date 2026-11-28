/**
 * One GET request for each key, shared by the callers that ask for it while it
 * is in flight and for `GET_CACHE_TTL_MS` after it answers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET_CACHE_TTL_MS, invalidateGetCache, sharedGet } from '@/lib/getCache';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('sharedGet', () => {
  beforeEach(() => invalidateGetCache());

  it('sends one request for callers that ask at the same time, and gives each a readable body', async () => {
    const send = vi.fn(async () => json([1, 2]));
    const [a, b] = await Promise.all([sharedGet('k', send), sharedGet('k', send)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await a.json()).toEqual([1, 2]);
    expect(await b.json()).toEqual([1, 2]);
  });

  it('answers from the cache until the entry is older than the TTL', async () => {
    let now = 1000;
    const send = vi.fn(async () => json({ n: send.mock.calls.length }));
    await sharedGet('k', send, () => now);
    now += GET_CACHE_TTL_MS - 1;
    await sharedGet('k', send, () => now);
    expect(send).toHaveBeenCalledTimes(1);
    now += 1;
    await sharedGet('k', send, () => now);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('asks again after an invalidation', async () => {
    const send = vi.fn(async () => json([]));
    await sharedGet('k', send);
    invalidateGetCache();
    await sharedGet('k', send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not keep a response that was in flight when a write invalidated the cache', async () => {
    let release!: (response: Response) => void;
    const send = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const first = sharedGet('k', send);
    invalidateGetCache();
    release(json(['old']));
    expect(await (await first).json()).toEqual(['old']);
    const fresh = vi.fn(async () => json(['new']));
    expect(await (await sharedGet('k', fresh)).json()).toEqual(['new']);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('does not keep an error status or a network failure', async () => {
    const refused = vi.fn(async () => json({ error: 'no' }, 500));
    expect((await sharedGet('k', refused)).status).toBe(500);
    await sharedGet('k', refused);
    expect(refused).toHaveBeenCalledTimes(2);

    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(sharedGet('j', offline)).rejects.toThrow('Failed to fetch');
    await expect(sharedGet('j', offline)).rejects.toThrow('Failed to fetch');
    expect(offline).toHaveBeenCalledTimes(2);
  });

  it('keeps keys apart', async () => {
    const send = vi.fn(async () => json([]));
    await sharedGet('a', send);
    await sharedGet('b', send);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
