/**
 * `/auth` under the three auth modes, which is the dimension `routes.auth.test.ts`
 * never varied: every context it builds is `mode: 'required'`, so the whole file
 * asks who may administer grants and never asks *when*.
 *
 * Asking found that `dry-run` — the mode an operator turns on to see what
 * enforcement would refuse, before refusing anything — let any caller write the
 * auth graph, including an entirely unauthenticated one, because the plugin
 * hands a token-less `dry-run` request a full-access context so unconverted
 * clients keep working. A grant minted in that window is live the moment the
 * operator flips to `required`.
 *
 * So the writes refuse in every mode now, and these rows are what says so.
 * Every read keeps the behaviour it had, which the second half pins: a fix that
 * quietly tightened the reads too would be a different change than the one
 * claimed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AuthStore, inMemoryPersistence, setAuthStore } from '../../src/auth/AuthStore.js';
import { resetAuthConfig } from '../../src/auth/config.js';
import { resolveEffectiveGrants } from '../../src/auth/grants.js';
import authRoutes from '../../src/routes/auth.js';
import { createFullAccessContext, type AuthContext, type AuthMode } from '../../src/auth/types.js';

const ALICE = 'urn:sqlib:principal:user:alice';
const BOB = 'urn:sqlib:principal:user:bob';
const MALLORY = 'urn:sqlib:principal:user:mallory';
const LIBRARY = 'urn:sqlib:library:hydrology';
const OTHER_LIBRARY = 'urn:sqlib:library:geology';

const ADMIN_GRANT = {
  principal: MALLORY,
  resourceKind: 'everything',
  modes: ['control'],
} as const;

let store: AuthStore;
/** Audit rows written during the request under test, newest last. */
let logged: Record<string, unknown>[];

function contextFor(principals: string[], mode: AuthMode): AuthContext {
  return {
    subject: principals[0],
    principals,
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: resolveEffectiveGrants(principals, store),
    claims: {},
    fullAccess: false,
    mode,
  };
}

/**
 * Mounts the real plugin with a fixed caller.
 *
 * `context: null` is the case that matters most here: it is what `plugin.ts`
 * builds for a request carrying no token, which in `dry-run` is every request
 * from a client that has not been converted yet.
 */
async function appWith(context: AuthContext | null, mode: AuthMode): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: 'warn',
      stream: {
        write(line: string) {
          logged.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    },
  });
  app.decorateRequest('authContext', undefined);
  app.addHook('onRequest', async request => {
    request.authContext = context ?? createFullAccessContext(mode);
  });
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    reply.status(statusCode).send({ error: error.message });
  });
  await app.register(authRoutes, { prefix: '/auth' });
  await app.ready();
  return app;
}

/** A caller the token verifier identified, holding exactly the grants given. */
const as = (principals: string[], mode: AuthMode) => appWith(contextFor(principals, mode), mode);
/** A caller carrying no token at all, as `plugin.ts` presents one. */
const anonymous = (mode: AuthMode) => appWith(null, mode);

beforeEach(async () => {
  resetAuthConfig({
    SQLIB_AUTH_MODE: 'dry-run',
    SQLIB_AUTH_ISSUER: 'https://issuer.test/',
  } as NodeJS.ProcessEnv);
  store = new AuthStore(inMemoryPersistence());
  await store.load();
  setAuthStore(store);
  logged = [];
});

afterEach(() => {
  setAuthStore(null);
  vi.restoreAllMocks();
});

describe('writing the auth graph in dry-run', () => {
  it('refuses an unauthenticated caller the administrator grant it asked for', async () => {
    // The headline: no token, no identity, and `dry-run` is the mode an
    // operator runs *before* switching enforcement on. This answered 201.
    const app = await anonymous('dry-run');

    const response = await app.inject({ method: 'POST', url: '/auth/grants', payload: ADMIN_GRANT });

    expect(response.statusCode).toBe(403);
    expect(store.listGrants()).toEqual([]);
    await app.close();
  });

  it('refuses an identified caller holding nothing the same grant', async () => {
    const app = await as([ALICE], 'dry-run');

    const response = await app.inject({ method: 'POST', url: '/auth/grants', payload: ADMIN_GRANT });

    expect(response.statusCode).toBe(403);
    expect(store.listGrants()).toEqual([]);
    await app.close();
  });

  it('refuses an unauthenticated caller a library grant', async () => {
    const app = await anonymous('dry-run');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/grants',
      payload: { principal: MALLORY, resourceKind: 'library', resource: LIBRARY, modes: ['control'] },
    });

    expect(response.statusCode).toBe(403);
    expect(store.listGrants()).toEqual([]);
    await app.close();
  });

  it('refuses an unauthenticated caller the revocation of an existing grant', async () => {
    // The mirror of minting one: a `dry-run` window that can delete the
    // operator's own admin grant is the same door facing the other way.
    const grant = await store.createGrant({
      principal: ALICE, resourceKind: 'everything', resource: 'x', modes: ['control'],
    });
    const app = await anonymous('dry-run');

    const response = await app.inject({ method: 'DELETE', url: `/auth/grants/${grant.id}` });

    expect(response.statusCode).toBe(403);
    expect(store.getGrant(grant.id)).toBeTruthy();
    await app.close();
  });

  it('records the refusal as a real deny, naming the mode it happened in', async () => {
    // `dry-run` normally writes `would-deny` and lets the request through. The
    // row has to say which of the two this was, or the log cannot be read.
    const app = await anonymous('dry-run');
    await app.inject({ method: 'POST', url: '/auth/grants', payload: ADMIN_GRANT });

    expect(logged).toContainEqual(
      expect.objectContaining({ audit: true, decision: 'deny', authMode: 'dry-run', mode: 'admin' })
    );
    await app.close();
  });

  it('still lets a real administrator administer', async () => {
    // The mode is not a lockout: an admin grant resolved from a token works in
    // `dry-run` exactly as in `required`.
    await store.createGrant({
      principal: ALICE, resourceKind: 'everything', resource: 'x', modes: ['control'],
    });
    const app = await as([ALICE], 'dry-run');

    const response = await app.inject({ method: 'POST', url: '/auth/grants', payload: ADMIN_GRANT });

    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it('still lets a library controller share that library', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['control'],
    });
    const app = await as([ALICE], 'dry-run');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/grants',
      payload: { principal: BOB, resourceKind: 'library', resource: LIBRARY, modes: ['read'] },
    });

    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it('still refuses a library controller a different library', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['control'],
    });
    const app = await as([ALICE], 'dry-run');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/grants',
      payload: { principal: BOB, resourceKind: 'library', resource: OTHER_LIBRARY, modes: ['read'] },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe('writing the auth graph when auth is disabled', () => {
  it('lets the deployment that has no auth administer grants', async () => {
    // The same full-access context, and here it *is* the deployment's answer
    // rather than a caller nobody identified. Seeding an admin grant before
    // turning auth on is done through this door.
    const app = await anonymous('disabled');

    const response = await app.inject({ method: 'POST', url: '/auth/grants', payload: ADMIN_GRANT });

    expect(response.statusCode).toBe(201);
    expect(store.listGrants()).toHaveLength(1);
    await app.close();
  });

  it('lets a route module mounted without the plugin administer grants', async () => {
    // Unit tests that mount one route module never see the auth plugin and get
    // `createFullAccessContext()`, whose mode defaults to `disabled`. They must
    // behave as they did before auth existed.
    const app = await appWith(createFullAccessContext(), 'disabled');

    const response = await app.inject({ method: 'POST', url: '/auth/grants', payload: ADMIN_GRANT });

    expect(response.statusCode).toBe(201);
    await app.close();
  });
});

describe('reading the auth graph in dry-run', () => {
  /*
   * None of these changed, and that is the claim. The fix is about what a
   * `dry-run` window can leave behind, not about what it discloses — a
   * `dry-run` deployment answers every other read in the API the same way, so
   * tightening these would be a separate decision with a separate cost to a
   * share dialog that works today. §4 of the design note.
   */
  it('answers an unauthenticated caller the whole grant listing', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'],
    });
    const app = await anonymous('dry-run');

    const response = await app.inject({ method: 'GET', url: '/auth/grants' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    await app.close();
  });

  it('answers an unauthenticated caller the principal directory', async () => {
    await store.recordPrincipal(BOB, 'bob@example.com', 'user');
    const app = await anonymous('dry-run');

    const response = await app.inject({ method: 'GET', url: '/auth/principals' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    await app.close();
  });

  it('records the principal refusal it always made, which was never audited', async () => {
    // Unchanged behaviour — this route threw in every mode before — but the
    // throw reached no `decide`, so the reads the file header calls audited
    // were not. The row is the change here, not the status.
    const app = await as([ALICE], 'dry-run');

    const response = await app.inject({ method: 'GET', url: '/auth/principals' });

    expect(response.statusCode).toBe(403);
    expect(logged).toContainEqual(
      expect.objectContaining({ audit: true, decision: 'deny', mode: 'control' })
    );
    await app.close();
  });

  it('answers every caller its own identity', async () => {
    const app = await as([ALICE], 'dry-run');

    const response = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(response.statusCode).toBe(200);
    expect(response.json().subject).toBe(ALICE);
    await app.close();
  });
});

describe('writing the auth graph in required mode', () => {
  it('refuses a caller holding nothing, as it always has', async () => {
    const app = await as([ALICE], 'required');

    const response = await app.inject({ method: 'POST', url: '/auth/grants', payload: ADMIN_GRANT });

    expect(response.statusCode).toBe(403);
    expect(store.listGrants()).toEqual([]);
    await app.close();
  });
});
