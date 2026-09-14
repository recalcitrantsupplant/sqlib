/**
 * The `/auth` API: who may read grants, who may create them, and the boundary
 * that stops library-level Control from becoming server-level admin.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AuthStore, inMemoryPersistence, setAuthStore } from '../../src/auth/AuthStore.js';
import { resetAuthConfig } from '../../src/auth/config.js';
import { resolveEffectiveGrants } from '../../src/auth/grants.js';
import authRoutes from '../../src/routes/auth.js';
import type { AuthContext } from '../../src/auth/types.js';

const ALICE = 'urn:sqlib:principal:user:alice';
const BOB = 'urn:sqlib:principal:user:bob';
const LIBRARY = 'urn:sqlib:library:hydrology';
const BACKEND = 'urn:sqlib:backend:main';

let store: AuthStore;

function contextFor(principals: string[]): AuthContext {
  return {
    subject: principals[0],
    principals,
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: resolveEffectiveGrants(principals, store),
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

/** Mounts the routes with a fixed caller, standing in for the auth plugin. */
async function appAs(principals: string[] | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('authContext', undefined);
  app.addHook('onRequest', async request => {
    if (principals) request.authContext = contextFor(principals);
  });
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    reply.status(statusCode).send({ error: error.message });
  });
  await app.register(authRoutes, { prefix: '/auth' });
  await app.ready();
  return app;
}

beforeEach(async () => {
  resetAuthConfig({ SQLIB_AUTH_MODE: 'disabled' } as NodeJS.ProcessEnv);
  store = new AuthStore(inMemoryPersistence());
  await store.load();
  setAuthStore(store);
});

afterEach(() => {
  setAuthStore(null);
  vi.restoreAllMocks();
});

describe('GET /auth/me', () => {
  it('reports the caller identity and their effective grants', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read', 'execute'],
    });
    const app = await appAs([ALICE]);

    const body = (await app.inject({ method: 'GET', url: '/auth/me' })).json();

    expect(body.subject).toBe(ALICE);
    expect(body.admin).toBe(false);
    expect(body.libraries[LIBRARY].sort()).toEqual(['execute', 'read']);
    await app.close();
  });

  it('reports full access when no context was attached', async () => {
    const app = await appAs(null);
    const body = (await app.inject({ method: 'GET', url: '/auth/me' })).json();

    expect(body.authenticated).toBe(false);
    expect(body.admin).toBe(true);
    await app.close();
  });
});

describe('grant administration', () => {
  it('lets an admin create any grant', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'everything', resource: 'x', modes: ['control'] });
    const app = await appAs([ALICE]);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/grants',
      payload: { principal: BOB, resourceKind: 'backend', resource: BACKEND, modes: ['use'] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().modes).toEqual(['use']);
    await app.close();
  });

  it('lets a library controller share that library', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['control'],
    });
    const app = await appAs([ALICE]);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/grants',
      payload: { principal: BOB, resourceKind: 'library', resource: LIBRARY, modes: ['read'] },
    });

    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it('refuses to let a library controller share a different library', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['control'],
    });
    const app = await appAs([ALICE]);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/grants',
      payload: { principal: BOB, resourceKind: 'library', resource: 'urn:sqlib:library:other', modes: ['read'] },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('refuses to let a library controller mint an admin', async () => {
    // Control over one library must never be a path to control over everything.
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['control'],
    });
    const app = await appAs([ALICE]);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/grants',
      payload: { principal: ALICE, resourceKind: 'everything', modes: ['control'] },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('refuses to let a library controller grant backend access', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['control'],
    });
    const app = await appAs([ALICE]);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/grants',
      payload: { principal: ALICE, resourceKind: 'backend', resource: BACKEND, modes: ['use'] },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('rejects a grant with no resource', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'everything', resource: 'x', modes: ['control'] });
    const app = await appAs([ALICE]);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/grants',
      payload: { principal: BOB, resourceKind: 'library', modes: ['read'] },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects an invalid mode for the resource kind', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'everything', resource: 'x', modes: ['control'] });
    const app = await appAs([ALICE]);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/grants',
      payload: { principal: BOB, resourceKind: 'backend', resource: BACKEND, modes: ['delete'] },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('revokes a grant and 404s an unknown one', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'everything', resource: 'x', modes: ['control'] });
    const target = await store.createGrant({
      principal: BOB, resourceKind: 'library', resource: LIBRARY, modes: ['read'],
    });
    const app = await appAs([ALICE]);

    expect((await app.inject({ method: 'DELETE', url: `/auth/grants/${target.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/auth/grants/urn:sqlib:grant:nope' })).statusCode).toBe(404);
    await app.close();
  });

  it('refuses grant listing to a caller who administers nothing', async () => {
    const app = await appAs([BOB]);
    const response = await app.inject({ method: 'GET', url: '/auth/grants' });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('lets a library controller list that library grants', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['control'],
    });
    const app = await appAs([ALICE]);

    const response = await app.inject({
      method: 'GET',
      url: `/auth/grants?library=${encodeURIComponent(LIBRARY)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    await app.close();
  });
});

describe('GET /auth/principals', () => {
  it('is available to a library controller for the share dialog', async () => {
    await store.recordPrincipal(BOB, 'bob@example.com', 'user');
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['control'],
    });
    const app = await appAs([ALICE]);

    const response = await app.inject({ method: 'GET', url: '/auth/principals?q=bob' });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0].rawClaim).toBe('bob@example.com');
    await app.close();
  });

  it('is refused to a caller who can share nothing', async () => {
    const app = await appAs([BOB]);
    expect((await app.inject({ method: 'GET', url: '/auth/principals' })).statusCode).toBe(403);
    await app.close();
  });
});
