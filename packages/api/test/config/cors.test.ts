/**
 * The API's CORS policy: what `SQLIB_CORS_ORIGINS` resolves to, and what a
 * browser request gets back from a real `@fastify/cors` registration.
 *
 * The parsing cases are the ones `packages/mcp-server/test/http-server.test.ts`
 * pins for the MCP transport's own reader, since the two share an instance in
 * `dual-http` and must answer an origin the same way.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import { buildCorsOptions, resolveCorsPolicy, type CorsPolicy } from '../../src/config/cors.js';

const SPA = 'http://localhost:3001';
const LISTED = 'https://app.example';
const STRANGER = 'https://evil.example';

describe('resolving SQLIB_CORS_ORIGINS', () => {
  it('defaults to the SPA dev origins in development only', () => {
    expect(resolveCorsPolicy({ NODE_ENV: 'production' })).toEqual({ any: false, origins: new Set() });
    expect(resolveCorsPolicy({})).toEqual({ any: false, origins: new Set() });
    expect(resolveCorsPolicy({ NODE_ENV: 'development' })).toEqual({
      any: false,
      origins: new Set(['http://localhost:3001', 'http://127.0.0.1:3001']),
    });
  });

  it('reads a comma-separated list, trimming spaces and trailing slashes', () => {
    const listed = resolveCorsPolicy({
      NODE_ENV: 'development',
      SQLIB_CORS_ORIGINS: 'https://a.example/, https://b.example',
    });
    expect([...listed.origins]).toEqual(['https://a.example', 'https://b.example']);
    expect(listed.any).toBe(false);
  });

  it('reads * as any origin, and the empty string as none even in development', () => {
    expect(resolveCorsPolicy({ SQLIB_CORS_ORIGINS: '*' })).toEqual({ any: true, origins: new Set() });
    expect(resolveCorsPolicy({ NODE_ENV: 'development', SQLIB_CORS_ORIGINS: '' })).toEqual({
      any: false,
      origins: new Set(),
    });
  });
});

describe('the registered plugin, on a request', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function build(policy: CorsPolicy): Promise<FastifyInstance> {
    app = Fastify({ logger: false });
    await app.register(fastifyCors, buildCorsOptions(policy));
    app.get('/queries', async () => ({ ok: true }));
    await app.ready();
    return app;
  }

  const get = (instance: FastifyInstance, origin?: string) =>
    instance.inject({ method: 'GET', url: '/queries', headers: origin ? { origin } : {} });

  const preflight = (instance: FastifyInstance, origin: string, url = '/queries') =>
    instance.inject({
      method: 'OPTIONS',
      url,
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, accept',
      },
    });

  it('sends no CORS headers to an origin not on the list', async () => {
    const instance = await build(resolveCorsPolicy({ SQLIB_CORS_ORIGINS: LISTED }));
    const response = await get(instance, STRANGER);
    // The request still runs — CORS decides what the page may read, not what
    // the server does — but the browser withholds the answer.
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers.vary).toMatch(/Origin/);
  });

  it('echoes a listed origin, with credentials', async () => {
    const instance = await build(resolveCorsPolicy({ SQLIB_CORS_ORIGINS: `${LISTED}/` }));
    const response = await get(instance, LISTED);
    expect(response.headers['access-control-allow-origin']).toBe(LISTED);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-expose-headers']).toContain('Server-Timing');
  });

  it('answers * without credentials, and still credentials a listed origin beside it', async () => {
    const instance = await build(resolveCorsPolicy({ SQLIB_CORS_ORIGINS: `*, ${LISTED}` }));

    const anyone = await get(instance, STRANGER);
    expect(anyone.headers['access-control-allow-origin']).toBe('*');
    expect(anyone.headers['access-control-allow-credentials']).toBeUndefined();

    const named = await get(instance, LISTED);
    expect(named.headers['access-control-allow-origin']).toBe(LISTED);
    expect(named.headers['access-control-allow-credentials']).toBe('true');
  });

  it('never sends credentials under a bare *', async () => {
    const instance = await build(resolveCorsPolicy({ SQLIB_CORS_ORIGINS: '*' }));
    const response = await preflight(instance, STRANGER);
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('keeps the SPA dev server working by default in development', async () => {
    const instance = await build(resolveCorsPolicy({ NODE_ENV: 'development' }));
    const response = await preflight(instance, SPA);
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(SPA);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    // A report export negotiates with `Accept`, which then preflights.
    expect(response.headers['access-control-allow-headers']).toContain('Accept');
  });

  it('refuses a preflight from an origin not on the list', async () => {
    const instance = await build(resolveCorsPolicy({ NODE_ENV: 'production' }));
    const response = await preflight(instance, SPA);
    expect(response.statusCode).toBe(404);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sends nothing to a request with no Origin', async () => {
    const instance = await build(resolveCorsPolicy({ SQLIB_CORS_ORIGINS: '*' }));
    const response = await get(instance);
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('beside the MCP transport on one instance', () => {
  /*
   * `dual-http` registers the MCP routes on the API's instance, and `/mcp`
   * answers its own preflight with headers the API's list does not have. The
   * plugin answers preflights in `onRequest`, ahead of every route, so this
   * pins that it leaves `/mcp` to its route — a synthetic one, standing in for
   * `packages/mcp-server/src/http-server.ts`.
   */
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('lets OPTIONS /mcp reach the MCP route and adds nothing of its own', async () => {
    app = Fastify({ logger: false });
    await app.register(fastifyCors, buildCorsOptions(resolveCorsPolicy({ SQLIB_CORS_ORIGINS: LISTED })));
    app.options('/mcp', async (_request, reply) => {
      reply.header('access-control-allow-origin', LISTED);
      reply.header('access-control-allow-headers', 'mcp-protocol-version');
      reply.code(204).send();
    });
    app.post('/mcp', async () => ({ mcp: true }));
    await app.ready();

    const pre = await app.inject({
      method: 'OPTIONS',
      url: '/mcp',
      headers: { origin: LISTED, 'access-control-request-method': 'POST' },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-headers']).toBe('mcp-protocol-version');

    const post = await app.inject({ method: 'POST', url: '/mcp', headers: { origin: LISTED }, payload: {} });
    expect(post.headers['access-control-allow-origin']).toBeUndefined();
    expect(post.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
