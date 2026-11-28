/**
 * `/health` is read once per page load and shared by every module that needs it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchHealth, resetHealth } from '@/lib/health';

const realFetch = globalThis.fetch;

describe('fetchHealth', () => {
  beforeEach(() => resetHealth());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sends one request for every caller', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ auth: { mode: 'anonymous' } }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const [a, b] = await Promise.all([fetchHealth('http://api/'), fetchHealth('http://api')]);
    await fetchHealth('http://api');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://api/health');
    expect(a.payload).toEqual({ auth: { mode: 'anonymous' } });
    expect(b).toBe(a);
  });

  it('keeps the body of a 503, which still carries the modes', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ readOnly: true }), { status: 503 })) as unknown as typeof fetch;
    const answer = await fetchHealth('http://api');
    expect(answer).toEqual({ ok: false, status: 503, payload: { readOnly: true } });
  });

  it('asks again after a network error', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(fetchHealth('http://api')).rejects.toThrow('Failed to fetch');
    await Promise.resolve();
    expect((await fetchHealth('http://api')).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
