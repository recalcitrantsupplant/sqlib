/**
 * The plugin's contract: who gets a 401, what an AuthContext looks like when one
 * is built, and the guarantee that `disabled` mode changes nothing.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { AuthStore, setAuthStore, inMemoryPersistence } from '../../src/auth/AuthStore.js';
import { resetAuthConfig } from '../../src/auth/config.js';
import { registerAuthPlugin } from '../../src/auth/plugin.js';
import { resetTokenVerifier } from '../../src/auth/tokenVerifier.js';
import { authOf } from '../../src/auth/enforce.js';
import { principalIri } from '../../src/auth/principals.js';

const ISSUER = 'https://issuer.test/';
const AUDIENCE = 'sqlib-api';

let privateKey: CryptoKey;
let publicJwk: JWK;
let store: AuthStore;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = 'k1';
  publicJwk.alg = 'RS256';

  globalThis.fetch = (async (input: unknown) =>
    String(input).includes('/jwks')
      ? new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      : new Response('nope', { status: 404 })) as typeof fetch;
});

beforeEach(async () => {
  store = new AuthStore(inMemoryPersistence());
  await store.load();
  setAuthStore(store);
  resetTokenVerifier();
});

afterEach(() => {
  setAuthStore(null);
  vi.unstubAllEnvs();
});

async function token(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('5m')
    .sign(privateKey);
}

async function buildApp(mode: string): Promise<FastifyInstance> {
  resetAuthConfig({
    SQLIB_AUTH_MODE: mode,
    SQLIB_AUTH_ISSUER: ISSUER,
    SQLIB_AUTH_AUDIENCE: AUDIENCE,
    SQLIB_AUTH_JWKS_URI: 'https://issuer.test/jwks',
    SQLIB_AUTH_CLAIM_GROUPS: 'groups',
  } as NodeJS.ProcessEnv);

  const app = Fastify({ logger: false });
  await registerAuthPlugin(app);
  app.get('/whoami', async request => {
    const context = authOf(request);
    return {
      subject: context.subject,
      principals: context.principals,
      admin: context.grants.admin,
      fullAccess: context.fullAccess,
      tokenType: context.tokenType,
    };
  });
  app.get('/health', async () => ({ status: 'ok' }));
  await app.ready();
  return app;
}

describe('disabled mode', () => {
  it('serves anonymous requests with a full-access context', async () => {
    const app = await buildApp('disabled');
    const response = await app.inject({ method: 'GET', url: '/whoami' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ fullAccess: true, admin: true });
    await app.close();
  });

  it('ignores a token entirely rather than half-applying it', async () => {
    const app = await buildApp('disabled');
    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${await token({ sub: 'user-1' })}` },
    });

    expect(response.json()).toMatchObject({ fullAccess: true });
    await app.close();
  });
});

describe('required mode', () => {
  it('rejects a missing token with 401 and a challenge header', async () => {
    const app = await buildApp('required');
    const response = await app.inject({ method: 'GET', url: '/whoami' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toContain('Bearer');
    await app.close();
  });

  it('rejects an invalid token with 401', async () => {
    const app = await buildApp('required');
    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer not-a-token' },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('leaves /health reachable for load balancers', async () => {
    const app = await buildApp('required');
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    await app.close();
  });

  it('builds principals from the subject, groups and the sentinel', async () => {
    const app = await buildApp('required');
    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${await token({ sub: 'user-1', groups: ['team-geo'] })}` },
    });

    const body = response.json();
    expect(body.fullAccess).toBe(false);
    expect(body.subject).toBe(principalIri('user', ISSUER, 'user-1'));
    expect(body.principals).toContain('urn:sqlib:principal:authenticated');
    expect(body.principals).toContain(principalIri('group', ISSUER, 'team-geo'));
    await app.close();
  });

  it('resolves grants held by a group the caller belongs to', async () => {
    await store.createGrant({
      principal: principalIri('group', ISSUER, 'admins'),
      resourceKind: 'everything',
      resource: 'x',
      modes: ['control'],
    });
    const app = await buildApp('required');

    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${await token({ sub: 'user-2', groups: ['admins'] })}` },
    });

    expect(response.json().admin).toBe(true);
    await app.close();
  });

  it('classifies a client-credentials token as a client principal', async () => {
    const app = await buildApp('required');
    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${await token({ sub: 'svc-1', azp: 'svc-1' })}` },
    });

    expect(response.json().tokenType).toBe('client');
    await app.close();
  });

  it('records the principal so it can be found in the share dialog', async () => {
    const app = await buildApp('required');
    await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${await token({ sub: 'user-3' })}` },
    });

    // Recording is fire-and-forget; give the microtask queue a turn.
    await new Promise(resolve => setImmediate(resolve));

    expect(store.listPrincipals('user-3')).toHaveLength(1);
    await app.close();
  });
});

describe('dry-run mode', () => {
  it('lets an untokened request through', async () => {
    const app = await buildApp('dry-run');
    const response = await app.inject({ method: 'GET', url: '/whoami' });

    expect(response.statusCode).toBe(200);
    expect(response.json().fullAccess).toBe(true);
    await app.close();
  });

  it('builds a real context when a valid token is present', async () => {
    const app = await buildApp('dry-run');
    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${await token({ sub: 'user-1' })}` },
    });

    expect(response.json().fullAccess).toBe(false);
    await app.close();
  });

  it('falls back to full access rather than failing on a bad token', async () => {
    const app = await buildApp('dry-run');
    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer garbage' },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });
});

describe('configuration', () => {
  it('refuses to start an enforcing mode with no issuer', () => {
    expect(() => resetAuthConfig({ SQLIB_AUTH_MODE: 'required' } as NodeJS.ProcessEnv))
      .toThrow(/requires an issuer/);
  });

  it('rejects an unrecognised mode rather than defaulting to open', () => {
    expect(() => resetAuthConfig({ SQLIB_AUTH_MODE: 'enforced' } as NodeJS.ProcessEnv))
      .toThrow(/Invalid SQLIB_AUTH_MODE/);
  });

  it('defaults to disabled when unset', () => {
    expect(resetAuthConfig({} as NodeJS.ProcessEnv).mode).toBe('disabled');
  });
});
