import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearProbeResults,
  forgetProbeResult,
  getProbeResult,
  listProbeHistory,
  listProbeResults,
  parseProduct,
  probeBackend,
  probeBackends,
} from '../../src/lib/backendProbe.js';

const realFetch = globalThis.fetch;

function respond(init: { status?: number; headers?: Record<string, string>; body?: string } = {}) {
  return new Response(init.body ?? '', {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  });
}

describe('backendProbe', () => {
  beforeEach(() => {
    clearProbeResults();
    // Prefix detection is two more requests per probe; the probe's own
    // behaviour is what this file is about, and it has its own block below.
    process.env.SQLIB_PREFIX_DETECT = 'off';
    delete process.env.SQLIB_BACKEND_SLOW_MS;
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SQLIB_BACKEND_')) delete process.env[key];
    }
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
    clearProbeResults();
    delete process.env.SQLIB_PREFIX_DETECT;
  });

  describe('prefix capability', () => {
    it('reports what the store can do about prefixes once it has answered', async () => {
      delete process.env.SQLIB_PREFIX_DETECT;
      globalThis.fetch = vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url.endsWith('/prefixes')) {
          return new Response('{"ex":"http://example.org/"}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.endsWith('/prefixes-rw')) return respond({ status: 404 });
        return respond({ headers: { server: 'Fuseki/5.0' } });
      }) as never;

      const result = await probeBackend({ id: 'p1', backendType: 'http', endpoint: 'http://store/ds/sparql' });

      expect(result.health).toBe('healthy');
      expect(result.prefixes).toMatchObject({
        read: 'jena-prefixes',
        write: null,
        readEndpoint: 'http://store/ds/prefixes',
        count: 1,
      });
    });

    it('leaves capability unestablished for an unreachable store', async () => {
      delete process.env.SQLIB_PREFIX_DETECT;
      globalThis.fetch = vi.fn(async () => respond({ status: 503 })) as never;

      const result = await probeBackend({ id: 'p2', backendType: 'http', endpoint: 'http://store/ds/sparql' });

      expect(result.health).toBe('unreachable');
      expect(result.prefixes).toBeNull();
    });

    it('skips detection entirely when it is switched off', async () => {
      const fetchMock = vi.fn(async () => respond({ headers: { server: 'Fuseki/5.0' } }));
      globalThis.fetch = fetchMock as never;

      const result = await probeBackend({ id: 'p3', backendType: 'http', endpoint: 'http://store/ds/sparql' });

      expect(result.prefixes).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('parseProduct', () => {
    it('prefers the Server header', () => {
      expect(parseProduct(new Headers({ server: 'Blazegraph/2.1.6' }), '')).toBe('Blazegraph/2.1.6');
    });

    it('ignores proxies that claim the Server header', () => {
      expect(parseProduct(new Headers({ server: 'nginx/1.25' }), '')).toBeNull();
    });

    it('falls back to sd:name in the service description', () => {
      const body = '<> sd:name "Apache Jena Fuseki 4.9.0" ; sd:endpoint <http://x/sparql> .';
      expect(parseProduct(new Headers(), body)).toBe('Apache Jena Fuseki 4.9.0');
    });

    it('reads the expanded service-description predicate too', () => {
      const body = '<> <http://www.w3.org/ns/sparql-service-description#name> "QLever" .';
      expect(parseProduct(new Headers(), body)).toBe('QLever');
    });

    it('says nothing rather than guessing when the store is silent', () => {
      expect(parseProduct(new Headers(), 'no product here')).toBeNull();
    });
  });

  describe('probeBackend', () => {
    it('reports an in-process store healthy without a request', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as never;

      const result = await probeBackend({ id: 'b1', backendType: 'oxigraphEphemeral' });

      expect(result.health).toBe('healthy');
      expect(result.product).toBe('Oxigraph (in-process)');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('is unreachable when an http backend has no endpoint', async () => {
      const result = await probeBackend({ id: 'b2', backendType: 'http', endpoint: '  ' });

      expect(result.health).toBe('unreachable');
      expect(result.error).toBe('No endpoint URL configured');
      expect(result.latencyMs).toBeNull();
    });

    it('classifies a fast answer as healthy and records the product', async () => {
      globalThis.fetch = vi.fn(async () => respond({ headers: { server: 'Blazegraph/2.1.6' } })) as never;

      const result = await probeBackend({ id: 'b3', backendType: 'http', endpoint: 'http://store/sparql' });

      expect(result.health).toBe('healthy');
      expect(result.product).toBe('Blazegraph/2.1.6');
      expect(result.error).toBeNull();
    });

    it('classifies anything over the slow threshold as slow', async () => {
      process.env.SQLIB_BACKEND_SLOW_MS = '1';
      globalThis.fetch = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return respond();
      }) as never;

      const result = await probeBackend({ id: 'b4', backendType: 'http', endpoint: 'http://slow/sparql' });

      expect(result.health).toBe('slow');
      expect(result.latencyMs).toBeGreaterThan(1);
    });

    it('falls back to ASK {} when the bare service-description GET is refused', async () => {
      const urls: string[] = [];
      globalThis.fetch = vi.fn(async (url: string) => {
        urls.push(url);
        return urls.length === 1 ? respond({ status: 400 }) : respond({ headers: { server: 'GraphDB/10.4' } });
      }) as never;

      const result = await probeBackend({ id: 'b5', backendType: 'http', endpoint: 'http://store/sparql' });

      expect(urls).toHaveLength(2);
      expect(urls[1]).toContain('query=ASK');
      expect(result.health).toBe('healthy');
      expect(result.product).toBe('GraphDB/10.4');
    });

    it('reports the status when both attempts fail', async () => {
      globalThis.fetch = vi.fn(async () => respond({ status: 503 })) as never;

      const result = await probeBackend({ id: 'b6', backendType: 'http', endpoint: 'http://store/sparql' });

      expect(result.health).toBe('unreachable');
      expect(result.error).toContain('503');
    });

    it('reports a thrown connection error rather than propagating it', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('connect ECONNREFUSED');
      }) as never;

      const result = await probeBackend({ id: 'b7', backendType: 'http', endpoint: 'http://store/sparql' });

      expect(result.health).toBe('unreachable');
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('sends basic auth when the environment holds the credentials', async () => {
      process.env.SQLIB_BACKEND_MAIN_USERNAME = 'user';
      process.env.SQLIB_BACKEND_MAIN_PASSWORD = 'pass';
      const seen: Array<Record<string, string>> = [];
      globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init.headers as Record<string, string>);
        return respond();
      }) as never;

      await probeBackend({ id: 'b8', backendType: 'http', endpoint: 'http://store/sparql', authEnvKey: 'MAIN' });

      expect(seen[0].authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
    });

    it('caches the last result per backend', async () => {
      globalThis.fetch = vi.fn(async () => respond()) as never;

      expect(getProbeResult('b9')).toBeNull();
      await probeBackend({ id: 'b9', backendType: 'http', endpoint: 'http://store/sparql' });

      expect(getProbeResult('b9')?.health).toBe('healthy');
      expect(listProbeResults(['b9', 'missing'])).toHaveLength(1);
    });
  });

  it('keeps the last results per backend, newest first', async () => {
    let status = 200;
    globalThis.fetch = vi.fn(async () => respond({ status })) as never;
    const target = { id: 'h1', backendType: 'http' as const, endpoint: 'http://store/sparql' };

    await probeBackend(target);
    status = 500;
    await probeBackend(target);

    const history = listProbeHistory('h1');
    expect(history.map((entry) => entry.health)).toEqual(['unreachable', 'healthy']);
    expect(listProbeHistory('never-probed')).toEqual([]);
  });

  it('forgets a deleted backend entirely, history included', async () => {
    globalThis.fetch = vi.fn(async () => respond()) as never;
    await probeBackend({ id: 'h2', backendType: 'http', endpoint: 'http://store/sparql' });

    forgetProbeResult('h2');

    expect(getProbeResult('h2')).toBeNull();
    expect(listProbeHistory('h2')).toEqual([]);
  });

  it('probes every target and returns one result each', async () => {
    globalThis.fetch = vi.fn(async () => respond()) as never;

    const results = await probeBackends([
      { id: 'a', backendType: 'http', endpoint: 'http://a/sparql' },
      { id: 'b', backendType: 'http', endpoint: 'http://b/sparql' },
      { id: 'c', backendType: 'oxigraphEphemeral' },
    ]);

    expect(results.map((result) => result.backendId).sort()).toEqual(['a', 'b', 'c']);
    expect(listProbeResults()).toHaveLength(3);
  });
});
