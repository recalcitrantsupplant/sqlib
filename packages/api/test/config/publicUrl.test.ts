import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import { buildCorsOptions, resolveCorsPolicy } from '../../src/config/cors.js';
import { registerReadOnlyPlugin, resetReadOnly } from '../../src/config/readOnly.js';
import {
  mcpRoutePatterns,
  mcpRouteWithinBase,
  normalizeBasePath,
  publicOrigin,
  publicOriginSetting,
  trustProxySetting,
} from '../../src/config/publicUrl.js';

describe('normalizeBasePath', () => {
  it('gives an empty string or a prefix with no trailing slash', () => {
    expect(normalizeBasePath(undefined)).toBe('');
    expect(normalizeBasePath('/')).toBe('');
    expect(normalizeBasePath('api/sqlib/')).toBe('/api/sqlib');
    expect(normalizeBasePath(' /api/sqlib// ')).toBe('/api/sqlib');
  });
});

describe('SQLIB_PUBLIC_ORIGIN', () => {
  it('is undefined when unset or empty', () => {
    expect(publicOriginSetting({})).toBeUndefined();
    expect(publicOriginSetting({ SQLIB_PUBLIC_ORIGIN: '  ' })).toBeUndefined();
  });

  it('accepts a scheme and a host, with or without a trailing slash', () => {
    expect(publicOriginSetting({ SQLIB_PUBLIC_ORIGIN: 'https://data.example.org' })).toBe('https://data.example.org');
    expect(publicOriginSetting({ SQLIB_PUBLIC_ORIGIN: 'https://data.example.org:8443/' })).toBe(
      'https://data.example.org:8443'
    );
  });

  it.each([
    'data.example.org',
    'https://data.example.org/api/sqlib',
    'https://data.example.org/?a=1',
    'ftp://data.example.org',
    'https://user:secret@data.example.org',
  ])('refuses "%s"', value => {
    expect(() => publicOriginSetting({ SQLIB_PUBLIC_ORIGIN: value })).toThrow(/SQLIB_PUBLIC_ORIGIN/);
  });
});

describe('SQLIB_TRUST_PROXY', () => {
  it('is off unless set', () => {
    expect(trustProxySetting({})).toBe(false);
    expect(trustProxySetting({ SQLIB_TRUST_PROXY: '' })).toBe(false);
    expect(trustProxySetting({ SQLIB_TRUST_PROXY: 'false' })).toBe(false);
  });

  it('reads true and an address list as they are', () => {
    expect(trustProxySetting({ SQLIB_TRUST_PROXY: 'TRUE' })).toBe(true);
    expect(trustProxySetting({ SQLIB_TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' })).toBe('10.0.0.0/8, 127.0.0.1');
  });

  it('reads a number as a count of proxy hops', () => {
    const trust = trustProxySetting({ SQLIB_TRUST_PROXY: '1' });
    expect(typeof trust).toBe('function');
    const byHop = trust as (address: string, hop: number) => boolean;
    expect(byHop('10.0.0.1', 0)).toBe(true);
    expect(byHop('10.0.0.2', 1)).toBe(false);
  });
});

describe('publicOrigin', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function originSeen(trustProxy: ReturnType<typeof trustProxySetting>, env: NodeJS.ProcessEnv): Promise<string> {
    app = Fastify({ logger: false, trustProxy });
    app.get('/origin', async request => ({ origin: publicOrigin(request, env) }));
    const response = await app.inject({
      method: 'GET',
      url: '/origin',
      headers: { host: 'internal:3000', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'data.example.org' },
    });
    return (response.json() as { origin: string }).origin;
  }

  it('ignores forwarded headers by default', async () => {
    expect(await originSeen(trustProxySetting({}), {})).toBe('http://internal:3000');
  });

  it('reads forwarded headers when SQLIB_TRUST_PROXY is on', async () => {
    expect(await originSeen(trustProxySetting({ SQLIB_TRUST_PROXY: 'true' }), {})).toBe('https://data.example.org');
  });

  it('prefers SQLIB_PUBLIC_ORIGIN to the request', async () => {
    expect(
      await originSeen(trustProxySetting({ SQLIB_TRUST_PROXY: 'true' }), { SQLIB_PUBLIC_ORIGIN: 'https://public.example' })
    ).toBe('https://public.example');
  });
});

describe('the MCP routes under APP_BASE_PATH', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    delete process.env.SQLIB_READ_ONLY;
    resetReadOnly();
  });

  it('lists the root patterns, and the patterns under a base path when one is set', () => {
    expect(mcpRoutePatterns('')).toEqual(['/mcp', '/mcp/:slug']);
    expect(mcpRoutePatterns('/api/sqlib')).toEqual(['/mcp', '/mcp/:slug', '/api/sqlib/mcp', '/api/sqlib/mcp/:slug']);
  });

  it('maps only an MCP route under the base path to its root pattern', () => {
    expect(mcpRouteWithinBase('/api/sqlib/mcp', '/api/sqlib')).toBe('/mcp');
    expect(mcpRouteWithinBase('/api/sqlib/mcp/:slug', '/api/sqlib')).toBe('/mcp/:slug');
    expect(mcpRouteWithinBase('/api/sqlib/queries', '/api/sqlib')).toBe('/api/sqlib/queries');
    expect(mcpRouteWithinBase('/other/mcp', '/api/sqlib')).toBe('/other/mcp');
    expect(mcpRouteWithinBase('/mcp', '')).toBe('/mcp');
  });

  it('leaves the preflight of /mcp under the base path to the MCP route', async () => {
    app = Fastify({ logger: false });
    await app.register(
      fastifyCors,
      buildCorsOptions(resolveCorsPolicy({ SQLIB_CORS_ORIGINS: 'https://app.example' }), '/api/sqlib')
    );
    for (const path of ['/mcp', '/api/sqlib/mcp']) {
      app.options(path, async (_request, reply) => reply.header('x-answered-by', 'mcp').code(204).send());
    }
    await app.ready();

    for (const url of ['/mcp', '/api/sqlib/mcp']) {
      const response = await app.inject({
        method: 'OPTIONS',
        url,
        headers: { origin: 'https://app.example', 'access-control-request-method': 'POST' },
      });
      expect(response.headers['x-answered-by'], url).toBe('mcp');
      expect(response.headers['access-control-allow-origin'], url).toBeUndefined();
    }
  });

  it('admits POST /mcp under the base path on a read-only deployment', async () => {
    process.env.SQLIB_READ_ONLY = 'true';
    resetReadOnly();
    app = Fastify({ logger: false });
    await registerReadOnlyPlugin(app, { basePath: '/api/sqlib' });
    app.post('/mcp', async () => ({ reached: true }));
    app.post('/api/sqlib/mcp', async () => ({ reached: true }));
    app.post('/api/sqlib/mcp/:slug', async () => ({ reached: true }));
    app.post('/api/sqlib/libraries', async () => ({ reached: true }));
    await app.ready();

    for (const url of ['/mcp', '/api/sqlib/mcp', '/api/sqlib/mcp/pm']) {
      expect((await app.inject({ method: 'POST', url })).statusCode, url).toBe(200);
    }
    expect((await app.inject({ method: 'POST', url: '/api/sqlib/libraries' })).statusCode).toBe(405);
  });
});
