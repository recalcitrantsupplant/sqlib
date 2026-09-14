/**
 * The prefix service client: where the endpoints are, what the answers mean,
 * and what a half-applied push reports.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  candidatePrefixEndpoints,
  datasetBaseOf,
  detectPrefixCapability,
  fetchRemotePrefixes,
  isValidPrefix,
  parsePrefixPairs,
  PrefixServiceError,
  pushPrefixes,
  scrapePrefixPreamble,
} from '../../src/lib/prefixService.js';

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function turtle(body: string, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/turtle' } });
}

/** Answer per URL; anything unlisted 404s, which is what a dataset without the service does. */
function router(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    const key = Object.keys(routes).find((candidate) => url.startsWith(candidate));
    if (!key) return new Response('', { status: 404 });
    return routes[key]();
  });
}

const target = { endpoint: 'http://store.example/ds/sparql' };

describe('prefixService', () => {
  beforeEach(() => {
    delete process.env.SQLIB_PREFIX_TIMEOUT_MS;
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SQLIB_BACKEND_')) delete process.env[key];
    }
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  describe('datasetBaseOf', () => {
    it('drops the service segment a query endpoint ends with', () => {
      expect(datasetBaseOf('http://store.example/ds/sparql')).toBe('http://store.example/ds');
      expect(datasetBaseOf('http://store.example/ds/query')).toBe('http://store.example/ds');
      expect(datasetBaseOf('http://store.example/ds/update')).toBe('http://store.example/ds');
    });

    it('keeps a dataset served without a service segment', () => {
      expect(datasetBaseOf('http://store.example/ds')).toBe('http://store.example/ds');
    });

    it('ignores query strings and returns null for a non-URL', () => {
      expect(datasetBaseOf('http://store.example/ds/sparql?default')).toBe('http://store.example/ds');
      expect(datasetBaseOf('not a url')).toBeNull();
      expect(datasetBaseOf('  ')).toBeNull();
    });

    it('names both candidate endpoints off the dataset base', () => {
      expect(candidatePrefixEndpoints(target.endpoint)).toEqual({
        read: ['http://store.example/ds/prefixes', 'http://store.example/ds/prefixes-rw'],
        write: ['http://store.example/ds/prefixes-rw'],
      });
    });
  });

  describe('parsePrefixPairs', () => {
    it('reads a prefix → uri object', () => {
      expect(parsePrefixPairs('{"foaf":"http://xmlns.com/foaf/0.1/"}')).toEqual([
        { prefix: 'foaf', namespace: 'http://xmlns.com/foaf/0.1/' },
      ]);
    });

    it('reads an array of entries under either key name', () => {
      const body = '[{"prefix":"a","uri":"http://a/"},{"prefix":"b","namespace":"http://b/"}]';
      expect(parsePrefixPairs(body)).toEqual([
        { prefix: 'a', namespace: 'http://a/' },
        { prefix: 'b', namespace: 'http://b/' },
      ]);
    });

    it('drops entries that are not a prefix and an absolute IRI', () => {
      expect(parsePrefixPairs('{"ok":"http://ok/","1bad":"http://x/","rel":"/relative"}')).toEqual([
        { prefix: 'ok', namespace: 'http://ok/' },
      ]);
    });

    it('keeps the empty prefix, which Turtle allows and Fuseki holds', () => {
      expect(isValidPrefix('')).toBe(true);
      expect(parsePrefixPairs('{"":"http://example.org/"}')).toEqual([
        { prefix: '', namespace: 'http://example.org/' },
      ]);
    });

    it('refuses a non-JSON body rather than reporting an empty map', () => {
      expect(() => parsePrefixPairs('<html>nope</html>')).toThrow(PrefixServiceError);
    });
  });

  describe('scrapePrefixPreamble', () => {
    it('reads both @prefix and PREFIX spellings, last definition winning', () => {
      const doc = [
        '@prefix foaf: <http://xmlns.com/foaf/0.1/> .',
        'PREFIX ex: <http://example.org/>',
        '@prefix : <http://base.example/> .',
        '@prefix ex: <http://example.org/v2/> .',
        '',
        '<http://a> a <http://b> .',
      ].join('\n');

      expect(scrapePrefixPreamble(doc)).toEqual([
        { prefix: '', namespace: 'http://base.example/' },
        { prefix: 'ex', namespace: 'http://example.org/v2/' },
        { prefix: 'foaf', namespace: 'http://xmlns.com/foaf/0.1/' },
      ]);
    });
  });

  describe('detectPrefixCapability', () => {
    it('reports read and write when both endpoints answer', async () => {
      globalThis.fetch = router({
        'http://store.example/ds/prefixes-rw': () => json({ ex: 'http://example.org/' }),
        'http://store.example/ds/prefixes': () => json({ ex: 'http://example.org/' }),
      }) as never;

      const capability = await detectPrefixCapability(target);

      expect(capability).toEqual({
        read: 'jena-prefixes',
        write: 'jena-prefixes',
        readEndpoint: 'http://store.example/ds/prefixes',
        writeEndpoint: 'http://store.example/ds/prefixes-rw',
        count: 1,
      });
    });

    it('is read-only when only the read endpoint is declared', async () => {
      globalThis.fetch = router({
        'http://store.example/ds/prefixes-rw': () => new Response('', { status: 404 }),
        'http://store.example/ds/prefixes': () => json({ ex: 'http://example.org/' }),
      }) as never;

      const capability = await detectPrefixCapability(target);

      expect(capability.read).toBe('jena-prefixes');
      expect(capability.write).toBeNull();
      expect(capability.writeEndpoint).toBeNull();
    });

    it('finds nothing when the dataset declares no prefix endpoint', async () => {
      globalThis.fetch = router({}) as never;

      expect(await detectPrefixCapability(target)).toMatchObject({ read: null, write: null });
    });

    it('does not mistake an unrelated page served at that path for the service', async () => {
      globalThis.fetch = router({
        'http://store.example/ds/prefixes': () => new Response('<html>hi</html>', { status: 200 }),
      }) as never;

      expect(await detectPrefixCapability(target)).toMatchObject({ read: null });
    });

    it('honours an explicit endpoint the dataset config named differently', async () => {
      globalThis.fetch = router({
        'http://store.example/ds/ns': () => json({ ex: 'http://example.org/' }),
      }) as never;

      const capability = await detectPrefixCapability({ ...target, readEndpoint: 'http://store.example/ds/ns' });

      expect(capability.readEndpoint).toBe('http://store.example/ds/ns');
      expect(capability.read).toBe('jena-prefixes');
    });

    it('never writes to the store in order to detect write capability', async () => {
      const fetchMock = router({
        'http://store.example/ds/prefixes': () => json({}),
        'http://store.example/ds/prefixes-rw': () => json({}),
      });
      globalThis.fetch = fetchMock as never;

      await detectPrefixCapability(target);

      for (const call of fetchMock.mock.calls) {
        expect((call[1] as RequestInit).method).toBe('GET');
      }
    });
  });

  describe('fetchRemotePrefixes', () => {
    it('returns the Jena map and says whether it is writable', async () => {
      globalThis.fetch = router({
        'http://store.example/ds/prefixes-rw': () => json({ ex: 'http://example.org/' }),
        'http://store.example/ds/prefixes': () => json({ ex: 'http://example.org/' }),
      }) as never;

      const remote = await fetchRemotePrefixes(target);

      expect(remote.source).toBe('jena-prefixes');
      expect(remote.readOnly).toBe(false);
      expect(remote.mappings).toEqual([{ prefix: 'ex', namespace: 'http://example.org/' }]);
    });

    it('falls back to the Turtle preamble for a store with no prefix service', async () => {
      globalThis.fetch = router({
        'http://store.example/ds/data?default': () =>
          turtle('@prefix ex: <http://example.org/> .\n<http://a> a <http://b> .'),
      }) as never;

      const remote = await fetchRemotePrefixes(target);

      expect(remote.source).toBe('turtle-scrape');
      expect(remote.readOnly).toBe(true);
      expect(remote.mappings).toEqual([{ prefix: 'ex', namespace: 'http://example.org/' }]);
    });

    it('ignores a graph endpoint that answers with something other than Turtle', async () => {
      globalThis.fetch = router({
        'http://store.example/ds/data?default': () => json({ not: 'turtle' }),
      }) as never;

      await expect(fetchRemotePrefixes(target)).rejects.toThrow(PrefixServiceError);
    });
  });

  describe('pushPrefixes', () => {
    const writable = {
      read: 'jena-prefixes' as const,
      write: 'jena-prefixes' as const,
      readEndpoint: 'http://store.example/ds/prefixes',
      writeEndpoint: 'http://store.example/ds/prefixes-rw',
      count: 0,
    };

    it('POSTs each upsert and DELETEs each removal, with the prefix in the query string', async () => {
      const calls: Array<{ url: string; method?: string }> = [];
      globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
        calls.push({ url: input.toString(), method: init?.method });
        return new Response('', { status: 200 });
      }) as never;

      const results = await pushPrefixes(
        target,
        { upserts: [{ prefix: 'ex', namespace: 'http://example.org/' }], deletes: ['old'] },
        writable
      );

      expect(results).toEqual([
        { prefix: 'ex', action: 'upsert', status: 'ok' },
        { prefix: 'old', action: 'delete', status: 'ok' },
      ]);
      expect(calls[0].method).toBe('POST');
      expect(calls[0].url).toContain('prefix=ex');
      expect(calls[0].url).toContain(`uri=${encodeURIComponent('http://example.org/')}`);
      expect(calls[1].method).toBe('DELETE');
      expect(calls[1].url).toContain('prefix=old');
    });

    it('reports per item, so one refusal does not hide the rest', async () => {
      globalThis.fetch = vi.fn(async (input: string | URL) =>
        input.toString().includes('prefix=bad')
          ? new Response('bad prefix', { status: 400 })
          : new Response('', { status: 200 })
      ) as never;

      const results = await pushPrefixes(
        target,
        {
          upserts: [
            { prefix: 'good', namespace: 'http://good/' },
            { prefix: 'bad', namespace: 'http://bad/' },
          ],
          deletes: [],
        },
        writable
      );

      expect(results[0].status).toBe('ok');
      expect(results[1]).toMatchObject({ status: 'failed', prefix: 'bad' });
      expect(results[1].error).toContain('400');
    });

    it('refuses the empty prefix, which Fuseki answers with a bare 400', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as never;

      const results = await pushPrefixes(
        target,
        { upserts: [{ prefix: '', namespace: 'http://example.org/' }], deletes: [] },
        writable
      );

      expect(results[0]).toMatchObject({ status: 'failed' });
      expect(results[0].error).toContain('empty prefix');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a namespace that is not an absolute IRI without calling the store', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as never;

      const results = await pushPrefixes(target, { upserts: [{ prefix: 'ex', namespace: '/rel' }], deletes: [] }, writable);

      expect(results[0]).toMatchObject({ status: 'failed' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses to push at all when the store has no writable endpoint', async () => {
      const readOnly = { ...writable, write: null, writeEndpoint: null };

      await expect(
        pushPrefixes(target, { upserts: [{ prefix: 'ex', namespace: 'http://example.org/' }], deletes: [] }, readOnly)
      ).rejects.toMatchObject({ status: 409 });
    });

    it('does nothing at all for an empty batch', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as never;

      expect(await pushPrefixes(target, { upserts: [], deletes: [] })).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a batch over the limit', async () => {
      const upserts = Array.from({ length: 501 }, (_, index) => ({
        prefix: `p${index}`,
        namespace: `http://example.org/${index}/`,
      }));

      await expect(pushPrefixes(target, { upserts, deletes: [] }, writable)).rejects.toMatchObject({ status: 400 });
    });

    it('sends the backend\'s configured credentials', async () => {
      process.env.SQLIB_BACKEND_MAIN_USERNAME = 'u';
      process.env.SQLIB_BACKEND_MAIN_PASSWORD = 'p';
      const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
      globalThis.fetch = fetchMock as never;

      await pushPrefixes(
        { ...target, authEnvKey: 'MAIN' },
        { upserts: [{ prefix: 'ex', namespace: 'http://example.org/' }], deletes: [] },
        writable
      );

      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers.authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
    });
  });
});
