/**
 * Every API call bypasses the browser's HTTP cache.
 *
 * An entity read comes back with `ETag` and `Last-Modified` — the pair
 * `If-Match` is built on — and a browser reads a validator with no cache
 * directive beside it as licence to guess how long the response stays fresh.
 * Chromium guesses a tenth of the age of `Last-Modified`, so `GET /queries/:id`
 * for a query last edited yesterday is answered from the browser's own copy for
 * the next couple of hours. That is what made a saved version look like it had
 * not become current: the save set it on the server, and the reload after it
 * read the query out of the cache, still naming the version before.
 *
 * The API now sends `Cache-Control: no-store`, which stops a cache taking such
 * a copy. This is the other half: a cache that already holds one — taken before
 * that header existed — must not be allowed to answer from it either.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useApiClient } from '@/composables/useApiClient';

const query = {
  id: 'urn:sqlib:query:1',
  name: 'A query',
  isPartOf: ['urn:sqlib:library:1'],
  currentVersion: 'urn:sqlib:query-version:2',
};

function respondWith(body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        etag: '"2026-09-07T13:52:06.061Z"',
        'last-modified': 'Mon, 07 Sep 2026 13:52:06 GMT',
      },
    })
  );
}

describe('useApiClient and the HTTP cache', () => {
  let fetchMock: ReturnType<typeof respondWith>;

  beforeEach(() => {
    fetchMock = respondWith(query);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads an entity with the cache bypassed', async () => {
    const result = await useApiClient().getQuery(query.id);

    expect(result.data.currentVersion).toBe('urn:sqlib:query-version:2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    expect(init.cache).toBe('no-store');
  });

  it('bypasses it on a write as well, so the write cannot refresh a stored copy', async () => {
    await useApiClient().createQueryVersion(query.id, {
      queryVersion: { queryString: 'SELECT ?s WHERE { ?s ?p ?o }', comment: null },
    }).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    expect(init.cache).toBe('no-store');
  });
});
