/**
 * `SQLIB_AUTH_MODE=trusted-header` (#208): the caller comes from a header a
 * sign-in proxy sets, and every request must carry the proxy's secret.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AuthStore, setAuthStore, inMemoryPersistence } from '../../src/auth/AuthStore.js';
import { resetAuthConfig } from '../../src/auth/config.js';
import { registerAuthPlugin } from '../../src/auth/plugin.js';
import { authOf } from '../../src/auth/enforce.js';
import { callerIdentityOf } from '../../src/auth/caller.js';
import { principalIri } from '../../src/auth/principals.js';
import { DEFAULT_TRUSTED_ISSUER } from '../../src/auth/trustedHeader.js';
import { PRINCIPAL_ANONYMOUS, PRINCIPAL_AUTHENTICATED } from '../../src/auth/types.js';

const SECRET = 'a-long-shared-secret-value';
const BASE_ENV = {
  SQLIB_AUTH_MODE: 'trusted-header',
  SQLIB_AUTH_TRUSTED_HEADER: 'X-Forwarded-User',
  SQLIB_AUTH_TRUSTED_GROUPS_HEADER: 'X-Forwarded-Groups',
  SQLIB_AUTH_TRUSTED_EMAIL_HEADER: 'X-Forwarded-Email',
  SQLIB_AUTH_TRUSTED_SECRET_HEADER: 'X-Proxy-Secret',
  SQLIB_AUTH_TRUSTED_SECRET: SECRET,
};

let store: AuthStore;

beforeEach(async () => {
  store = new AuthStore(inMemoryPersistence());
  await store.load();
  setAuthStore(store);
});

afterEach(() => {
  setAuthStore(null);
});

async function buildApp(env: Record<string, string> = {}): Promise<FastifyInstance> {
  resetAuthConfig({ ...BASE_ENV, ...env } as NodeJS.ProcessEnv);
  const app = Fastify({ logger: false });
  await registerAuthPlugin(app);
  app.get('/whoami', async request => {
    const context = authOf(request);
    return {
      subject: context.subject,
      principals: context.principals,
      issuer: context.issuer,
      fullAccess: context.fullAccess,
      mode: context.mode,
      caller: callerIdentityOf(context),
      backends: Object.fromEntries([...context.grants.backends].map(([iri, modes]) => [iri, [...modes].sort()])),
    };
  });
  app.get('/health', async () => ({ status: 'ok' }));
  await app.ready();
  return app;
}

const viaProxy = (headers: Record<string, string> = {}) => ({ 'x-proxy-secret': SECRET, ...headers });

describe('trusted-header configuration', () => {
  it('refuses to start without the identity header', () => {
    expect(() => resetAuthConfig({ ...BASE_ENV, SQLIB_AUTH_TRUSTED_HEADER: '' } as NodeJS.ProcessEnv))
      .toThrow(/requires SQLIB_AUTH_TRUSTED_HEADER/);
  });

  it('refuses to start without the shared secret', () => {
    expect(() => resetAuthConfig({ ...BASE_ENV, SQLIB_AUTH_TRUSTED_SECRET: '' } as NodeJS.ProcessEnv))
      .toThrow(/requires SQLIB_AUTH_TRUSTED_SECRET_HEADER and SQLIB_AUTH_TRUSTED_SECRET/);
  });

  it('refuses a short secret', () => {
    expect(() => resetAuthConfig({ ...BASE_ENV, SQLIB_AUTH_TRUSTED_SECRET: 'short' } as NodeJS.ProcessEnv))
      .toThrow(/at least 16 characters/);
  });

  it('refuses an unknown format', () => {
    expect(() => resetAuthConfig({ ...BASE_ENV, SQLIB_AUTH_TRUSTED_FORMAT: 'jwt' } as NodeJS.ProcessEnv))
      .toThrow(/Invalid SQLIB_AUTH_TRUSTED_FORMAT/);
  });

  it('needs no issuer', () => {
    expect(resetAuthConfig(BASE_ENV as NodeJS.ProcessEnv).trustedHeader).toMatchObject({
      header: 'x-forwarded-user',
      secretHeader: 'x-proxy-secret',
      issuer: DEFAULT_TRUSTED_ISSUER,
    });
  });
});

describe('trusted-header requests', () => {
  it('refuses a request without the secret with 403, even when it names a user', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/whoami', headers: { 'x-forwarded-user': 'admin' } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('refuses a request with a wrong secret', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-proxy-secret': 'not-the-secret-value', 'x-forwarded-user': 'admin' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('leaves /health reachable without the secret', async () => {
    const app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    await app.close();
  });

  it('serves a request with the secret and no identity as a guest', async () => {
    const app = await buildApp();
    const body = (await app.inject({ method: 'GET', url: '/whoami', headers: viaProxy() })).json();
    expect(body).toMatchObject({
      subject: PRINCIPAL_ANONYMOUS,
      principals: [PRINCIPAL_ANONYMOUS],
      fullAccess: false,
      mode: 'trusted-header',
      caller: null,
    });
    await app.close();
  });

  it('names the caller from a plain header, with groups, the sentinel and the guest grants', async () => {
    const user = principalIri('user', DEFAULT_TRUSTED_ISSUER, 'user-1');
    const group = principalIri('group', DEFAULT_TRUSTED_ISSUER, 'geo');
    await store.createGrant({ principal: PRINCIPAL_ANONYMOUS, resourceKind: 'backend', resource: 'urn:b:public', modes: ['query:saved'] });
    await store.createGrant({ principal: group, resourceKind: 'backend', resource: 'urn:b:geo', modes: ['update:adhoc'] });

    const app = await buildApp();
    const body = (await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: viaProxy({ 'x-forwarded-user': 'user-1', 'x-forwarded-groups': 'geo, ops', 'x-forwarded-email': 'ada@example.org' }),
    })).json();

    expect(body.subject).toBe(user);
    expect(body.issuer).toBe(DEFAULT_TRUSTED_ISSUER);
    expect(body.principals).toEqual(expect.arrayContaining([user, group, PRINCIPAL_AUTHENTICATED, PRINCIPAL_ANONYMOUS]));
    expect(body.caller.user).toBe(user);
    expect(body.backends).toEqual({ 'urn:b:public': ['query:saved'], 'urn:b:geo': ['update:adhoc'] });
    expect(store.principalRecord(user)?.label).toBe('ada@example.org');
    await app.close();
  });

  it('reads a Static Web Apps client principal, and leaves out the built-in roles', async () => {
    const app = await buildApp({ SQLIB_AUTH_TRUSTED_HEADER: 'x-ms-client-principal', SQLIB_AUTH_TRUSTED_FORMAT: 'ms-client-principal' });
    const principal = Buffer.from(JSON.stringify({
      identityProvider: 'aad',
      userId: 'abc123',
      userDetails: 'ada@example.org',
      userRoles: ['anonymous', 'authenticated', 'editors'],
    })).toString('base64');

    const body = (await app.inject({ method: 'GET', url: '/whoami', headers: viaProxy({ 'x-ms-client-principal': principal }) })).json();

    expect(body.subject).toBe(principalIri('user', DEFAULT_TRUSTED_ISSUER, 'abc123'));
    expect(body.caller.groups).toEqual([principalIri('group', DEFAULT_TRUSTED_ISSUER, 'editors')]);
    await app.close();
  });

  it('reads an App Service client principal by its object id claim', async () => {
    const app = await buildApp({ SQLIB_AUTH_TRUSTED_HEADER: 'x-ms-client-principal', SQLIB_AUTH_TRUSTED_FORMAT: 'ms-client-principal' });
    const principal = Buffer.from(JSON.stringify({
      auth_typ: 'aad',
      name_typ: 'name',
      role_typ: 'roles',
      claims: [
        { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: 'oid-1' },
        { typ: 'name', val: 'Ada Lovelace' },
        { typ: 'roles', val: 'Reader' },
      ],
    })).toString('base64');

    const body = (await app.inject({ method: 'GET', url: '/whoami', headers: viaProxy({ 'x-ms-client-principal': principal }) })).json();

    expect(body.subject).toBe(principalIri('user', DEFAULT_TRUSTED_ISSUER, 'oid-1'));
    expect(body.caller.groups).toEqual([principalIri('group', DEFAULT_TRUSTED_ISSUER, 'Reader')]);
    await app.close();
  });

  it('answers 400 to a client principal that is not base64 JSON', async () => {
    const app = await buildApp({ SQLIB_AUTH_TRUSTED_HEADER: 'x-ms-client-principal', SQLIB_AUTH_TRUSTED_FORMAT: 'ms-client-principal' });
    const response = await app.inject({ method: 'GET', url: '/whoami', headers: viaProxy({ 'x-ms-client-principal': '%%%' }) });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('builds principal IRIs with SQLIB_AUTH_TRUSTED_ISSUER when it is set', async () => {
    const app = await buildApp({ SQLIB_AUTH_TRUSTED_ISSUER: 'https://login.example.org/' });
    const body = (await app.inject({ method: 'GET', url: '/whoami', headers: viaProxy({ 'x-forwarded-user': 'user-1' }) })).json();
    expect(body.subject).toBe(principalIri('user', 'https://login.example.org/', 'user-1'));
    await app.close();
  });
});
