/**
 * The read-only gate's own behaviour: what it reads from the environment, and
 * what a request gets back.
 *
 * The route table is measured separately in `readOnly.routes.test.ts`; this
 * file uses a synthetic app so the refusal itself — status, body, and the fact
 * that the handler never runs — is pinned without depending on which real
 * routes exist today.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  isRefusedWhenReadOnly,
  isReadOnlyDeployment,
  normalizeRouteUrl,
  registerReadOnlyPlugin,
  resetReadOnly,
} from '../../src/config/readOnly.js';

const ORIGINAL = process.env.SQLIB_READ_ONLY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SQLIB_READ_ONLY;
  else process.env.SQLIB_READ_ONLY = ORIGINAL;
  resetReadOnly();
});

describe('resolving SQLIB_READ_ONLY', () => {
  it('is off unless the value is exactly true', () => {
    for (const raw of [undefined, '', 'false', 'no', '0', 'yes', '1', 'TRUE ']) {
      // `TRUE ` trims and lowercases to `true`, so it is the one that is on.
      const expected = (raw ?? '').trim().toLowerCase() === 'true';
      expect(resetReadOnly({ SQLIB_READ_ONLY: raw } as NodeJS.ProcessEnv), `for ${String(raw)}`).toBe(
        expected
      );
    }
  });

  it('defaults off, so an existing deployment is unaffected by the upgrade', () => {
    expect(resetReadOnly({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isReadOnlyDeployment()).toBe(false);
  });
});

describe('the refusal policy', () => {
  it('never refuses a read', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isRefusedWhenReadOnly(method, '/queries')).toBe(false);
    }
  });

  it('refuses a mutating method on a route it does not name', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isRefusedWhenReadOnly(method, '/queries/:id')).toBe(true);
    }
  });

  it('reads the method case-insensitively', () => {
    expect(isRefusedWhenReadOnly('post', '/queries')).toBe(true);
    expect(isRefusedWhenReadOnly('post', '/format')).toBe(false);
  });

  it('treats /execute and /execute/ as one route', () => {
    // Fastify registers a plugin's '/' route under both spellings.
    expect(normalizeRouteUrl('/execute/')).toBe('/execute');
    expect(isRefusedWhenReadOnly('POST', '/execute/')).toBe(false);
    expect(isRefusedWhenReadOnly('POST', '/execute')).toBe(false);
  });

  it('keeps the root path intact', () => {
    expect(normalizeRouteUrl('/')).toBe('/');
  });

  it('matches the route pattern, not a literal that resembles it', () => {
    // The hook is handed `routeOptions.url`, so a concrete id arrives as the
    // pattern that claimed it. A literal spelling must not be admitted.
    expect(isRefusedWhenReadOnly('POST', '/rule-sets/urn:x/execute')).toBe(true);
    expect(isRefusedWhenReadOnly('POST', '/rule-sets/:id/execute')).toBe(false);
  });
});

describe('the hook, on a request', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.SQLIB_READ_ONLY = 'true';
    resetReadOnly();
    app = Fastify({ logger: false });
    await registerReadOnlyPlugin(app);
    app.post('/queries', async () => ({ handlerRan: true }));
    app.post('/format', async () => ({ handlerRan: true }));
    app.get('/queries', async () => ({ handlerRan: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('refuses a write with 405 and says why', async () => {
    const response = await app.inject({ method: 'POST', url: '/queries' });
    expect(response.statusCode).toBe(405);
    const body = response.json() as { error: string };
    expect(body.error).toContain('read-only');
    expect(body.error).toContain('your browser');
  });

  it('does not run the handler it refused', async () => {
    const response = await app.inject({ method: 'POST', url: '/queries' });
    expect(response.body).not.toContain('handlerRan');
  });

  it('lets an allowlisted compute route through', async () => {
    const response = await app.inject({ method: 'POST', url: '/format' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ handlerRan: true });
  });

  it('lets reads through', async () => {
    const response = await app.inject({ method: 'GET', url: '/queries' });
    expect(response.statusCode).toBe(200);
  });

  it('leaves an unmatched path to the router, as a 404', async () => {
    // Answering 405 here would tell a prober that a write route exists.
    const response = await app.inject({ method: 'POST', url: '/no-such-route' });
    expect(response.statusCode).toBe(404);
  });
});

describe('the MCP transport, through the hook', () => {
  /*
   * `/mcp` is all POST, so an unlisted `/mcp` takes every tool — reads included
   * — off a read-only deployment (issue #26). What makes admitting it safe is
   * that a mutation tool reaches its route through `app.inject`, which runs
   * this same hook: the inner route is refused, so the tool call is. That is
   * the property worth pinning, and it is a property of the hook rather than
   * of the MCP SDK, so a synthetic transport exercises it exactly.
   */
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.SQLIB_READ_ONLY = 'true';
    resetReadOnly();
    app = Fastify({ logger: false });
    await registerReadOnlyPlugin(app);
    app.post('/mcp', async request => {
      const { tool } = (request.body ?? {}) as { tool?: string };
      if (!tool) return { handshake: 'ok' };
      // How a tool call reaches its route: the transport re-enters the app.
      const inner = await app.inject({ method: 'POST', url: `/${tool}` });
      return { statusCode: inner.statusCode, body: inner.json() };
    });
    app.post('/libraries', async () => ({ created: true }));
    app.get('/libraries', async () => ({ libraries: [] }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('completes a handshake', async () => {
    const response = await app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ handshake: 'ok' });
  });

  it('still refuses a mutation tool, at the route it re-enters', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      payload: { tool: 'libraries' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { statusCode: number; body: { error: string } };
    expect(body.statusCode).toBe(405);
    expect(body.body.error).toContain('read-only');
  });
});

describe('the hook, when the flag is off', () => {
  it('registers nothing, so every write runs as before', async () => {
    delete process.env.SQLIB_READ_ONLY;
    resetReadOnly();
    const app = Fastify({ logger: false });
    await registerReadOnlyPlugin(app);
    app.post('/queries', async () => ({ handlerRan: true }));
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/queries' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ handlerRan: true });
    await app.close();
  });
});
