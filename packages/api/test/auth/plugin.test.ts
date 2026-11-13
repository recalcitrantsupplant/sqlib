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
import { PRINCIPAL_AUTHENTICATED } from '../../src/auth/types.js';

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

async function buildApp(
  mode: string,
  options: { basePath?: string; publicBasePath?: string; trustProxy?: boolean; env?: Record<string, string> } = {}
): Promise<FastifyInstance> {
  resetAuthConfig({
    SQLIB_AUTH_MODE: mode,
    SQLIB_AUTH_ISSUER: ISSUER,
    SQLIB_AUTH_AUDIENCE: AUDIENCE,
    SQLIB_AUTH_JWKS_URI: 'https://issuer.test/jwks',
    SQLIB_AUTH_CLAIM_GROUPS: 'groups',
    ...options.env,
  } as NodeJS.ProcessEnv);

  const app = Fastify({ logger: false, trustProxy: options.trustProxy ?? false });
  await registerAuthPlugin(app, { basePath: options.basePath, publicBasePath: options.publicBasePath });
  if (options.basePath) {
    await app.register(async scoped => registerRoutes(scoped), { prefix: options.basePath });
  } else {
    registerRoutes(app);
  }
  await app.ready();
  return app;
}

function registerRoutes(app: FastifyInstance): void {
  app.get('/whoami', async request => {
    const context = authOf(request);
    return {
      subject: context.subject,
      principals: context.principals,
      admin: context.grants.admin,
      fullAccess: context.fullAccess,
      tokenType: context.tokenType,
      mode: context.mode,
      backends: Object.fromEntries([...context.grants.backends].map(([iri, modes]) => [iri, [...modes].sort()])),
    };
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/mcp', async () => ({ reached: true }));
  app.get('/', async () => ({ redirect: 'docs' }));
  app.get('/docs', async () => ({ docs: true }));
  app.get('/docs/json', async () => ({ openapi: '3.0.0' }));
  // Shaped like the routes the raw-URL matcher waved through: a real entity
  // route that happens to end in `/health` or pass through `/docs/`.
  app.get('/backends/:id/health', async () => ({ reachable: true }));
  app.get('/libraries/:id/docs/:page', async () => ({ page: true }));
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

describe('anonymous mode', () => {
  const BACKEND = 'urn:sqlib:backend:demo';

  it('needs no issuer', () => {
    expect(() => resetAuthConfig({ SQLIB_AUTH_MODE: 'anonymous' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(resetAuthConfig({ SQLIB_AUTH_MODE: 'anonymous' } as NodeJS.ProcessEnv).mode).toBe('anonymous');
  });

  it('serves every request as the anonymous principal, with no full access and no admin', async () => {
    const app = await buildApp('anonymous');
    const response = await app.inject({ method: 'GET', url: '/whoami' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      subject: 'urn:sqlib:principal:anonymous',
      principals: ['urn:sqlib:principal:anonymous'],
      fullAccess: false,
      admin: false,
      mode: 'anonymous',
    });
    await app.close();
  });

  it('gives a visitor the grants on the anonymous principal, and applies a change at once', async () => {
    const app = await buildApp('anonymous');
    expect((await app.inject({ method: 'GET', url: '/whoami' })).json().backends).toEqual({});

    await store.createGrant({
      principal: 'urn:sqlib:principal:anonymous',
      resourceKind: 'backend',
      resource: BACKEND,
      modes: ['query:saved'],
    });

    expect((await app.inject({ method: 'GET', url: '/whoami' })).json().backends).toEqual({
      [BACKEND]: ['query:saved'],
    });
    await app.close();
  });

  it('does not reach a visitor through the authenticated sentinel', async () => {
    const app = await buildApp('anonymous');
    await store.createGrant({
      principal: PRINCIPAL_AUTHENTICATED,
      resourceKind: 'backend',
      resource: BACKEND,
      modes: ['query:adhoc'],
    });

    expect((await app.inject({ method: 'GET', url: '/whoami' })).json().backends).toEqual({});
    await app.close();
  });

  it('ignores a bearer token rather than verifying it', async () => {
    const app = await buildApp('anonymous');
    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${await token({ sub: 'user-1' })}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ subject: 'urn:sqlib:principal:anonymous', fullAccess: false });
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

  it('rejects a token minted for another audience with 401', async () => {
    const app = await buildApp('required');
    const foreign = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience('some-other-api')
      .setExpirationTime('5m')
      .sign(privateKey);

    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${foreign}` },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('leaves / and the docs public', async () => {
    const app = await buildApp('required');
    for (const url of ['/', '/docs', '/docs/json']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
    }
    await app.close();
  });

  it('protects the docs when SQLIB_AUTH_PROTECT_DOCS=true', async () => {
    const app = await buildApp('required', { env: { SQLIB_AUTH_PROTECT_DOCS: 'true' } });
    expect((await app.inject({ method: 'GET', url: '/docs/json' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    await app.close();
  });

  it('matches public routes by pattern, so an entity route ending in /health is not public', async () => {
    const app = await buildApp('required');
    // Both answered 200 without a token while matching was `endsWith('/health')`
    // and `includes('/docs/')` on the raw URL.
    expect((await app.inject({ method: 'GET', url: '/backends/b1/health' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/libraries/l1/docs/intro' })).statusCode).toBe(401);
    // An unrouted URL has no pattern: a 401, not a 404 that says what exists.
    expect((await app.inject({ method: 'GET', url: '/nothing/here/health' })).statusCode).toBe(401);
    await app.close();
  });

  it('keeps the public routes public under APP_BASE_PATH, and only those', async () => {
    const app = await buildApp('required', { basePath: '/sqlib' });
    for (const url of ['/sqlib', '/sqlib/', '/sqlib/health', '/sqlib/docs/json']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: '/sqlib/backends/b1/health' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/sqlib/whoami' })).statusCode).toBe(401);
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

  it('labels a person by email, then username, then name', async () => {
    const app = await buildApp('required');
    const cases = [
      { sub: 'user-4', email: 'four@example.org', preferred_username: 'four', name: 'Four' },
      { sub: 'user-5', preferred_username: 'five', name: 'Five' },
      { sub: 'user-6', name: 'Six' },
      { sub: 'user-7' },
    ];
    for (const claims of cases) {
      await app.inject({ method: 'GET', url: '/whoami', headers: { authorization: `Bearer ${await token(claims)}` } });
    }
    await new Promise(resolve => setImmediate(resolve));

    const labelOf = (sub: string) => store.listPrincipals(sub)[0]?.label;
    expect(labelOf('user-4')).toBe('four@example.org');
    expect(labelOf('user-5')).toBe('five');
    expect(labelOf('user-6')).toBe('Six');
    expect(labelOf('user-7')).toBeUndefined();
    await app.close();
  });
});

describe('protected-resource metadata (RFC 9728)', () => {
  it('serves the document without a token under required, naming the issuer and the resource', async () => {
    const app = await buildApp('required', {
      env: { SQLIB_AUTH_RESOURCE: 'https://sqlib.test/mcp', SQLIB_AUTH_SCOPES: 'openid sqlib' },
    });
    for (const url of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.json(), url).toEqual({
        resource: 'https://sqlib.test/mcp',
        authorization_servers: [ISSUER],
        bearer_methods_supported: ['header'],
        scopes_supported: ['openid', 'sqlib'],
      });
    }
    await app.close();
  });

  it('defaults the resource to the audience and leaves scopes out when none are configured', async () => {
    const app = await buildApp('required');
    const body = (await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' })).json();
    expect(body.resource).toBe(AUDIENCE);
    expect(body).not.toHaveProperty('scopes_supported');
    await app.close();
  });

  it('points a tokenless /mcp request at the document, with no error code', async () => {
    const app = await buildApp('required', {
      env: { SQLIB_AUTH_RESOURCE: 'https://sqlib.test/mcp', SQLIB_AUTH_SCOPES: 'sqlib' },
    });
    const response = await app.inject({ method: 'POST', url: '/mcp', payload: {} });

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="https://sqlib.test/.well-known/oauth-protected-resource/mcp", scope="sqlib"'
    );
    await app.close();
  });

  it('keeps the error code on a rejected token and still names the document', async () => {
    const app = await buildApp('required');
    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer not-a-token', host: 'api.test' },
    });

    expect(response.statusCode).toBe(401);
    const challenge = String(response.headers['www-authenticate']);
    expect(challenge).toMatch(/^Bearer error="invalid_token", error_description="[^"]+"/);
    // An audience that is not a URL gives no origin, so the request's is used.
    expect(challenge).toContain('resource_metadata="http://api.test/.well-known/oauth-protected-resource"');
    await app.close();
  });

  it('serves the document at the root and under APP_BASE_PATH', async () => {
    const app = await buildApp('required', { basePath: '/sqlib' });
    for (const url of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/sqlib',
      '/sqlib/.well-known/oauth-protected-resource',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
    }
    await app.close();
  });

  /*
   * #175. Under a base path, `/mcp` is served under it, and a reverse proxy
   * may route only that prefix to sqlib. The challenge then names the copy of
   * the document under the prefix, and the fallback resource names the MCP URL
   * under the prefix. Each test follows the challenge to the document, as an
   * MCP client does.
   */
  describe('under APP_BASE_PATH', () => {
    const UNCHECKED = { SQLIB_AUTH_AUDIENCE: '', SQLIB_AUTH_AUDIENCE_UNCHECKED: 'true' };
    const publicOriginBefore = process.env.SQLIB_PUBLIC_ORIGIN;

    afterEach(() => {
      if (publicOriginBefore === undefined) delete process.env.SQLIB_PUBLIC_ORIGIN;
      else process.env.SQLIB_PUBLIC_ORIGIN = publicOriginBefore;
    });

    /** The 401 of a tokenless MCP request, and the document its challenge names. */
    async function discover(app: FastifyInstance, url: string, headers: Record<string, string> = {}) {
      const refused = await app.inject({ method: 'POST', url, payload: {}, headers: { host: 'api.test', ...headers } });
      expect(refused.statusCode).toBe(401);
      const metadataUrl = /resource_metadata="([^"]+)"/.exec(String(refused.headers['www-authenticate']))?.[1] ?? '';
      const path = new URL(metadataUrl).pathname;
      const document = await app.inject({ method: 'GET', url: path, headers: { host: 'api.test', ...headers } });
      expect(document.statusCode, metadataUrl).toBe(200);
      return { metadataUrl, resource: (document.json() as { resource: string }).resource };
    }

    it('names the document under the base path when the audience is not a URL', async () => {
      const app = await buildApp('required', { basePath: '/api/sqlib' });
      const { metadataUrl, resource } = await discover(app, '/api/sqlib/mcp');

      expect(metadataUrl).toBe('http://api.test/api/sqlib/.well-known/oauth-protected-resource');
      expect(resource).toBe(AUDIENCE);
      await app.close();
    });

    it('names the MCP URL under the base path as the resource when no audience is checked', async () => {
      const app = await buildApp('required', { basePath: '/api/sqlib', env: UNCHECKED });
      const { metadataUrl, resource } = await discover(app, '/api/sqlib/mcp');

      expect(metadataUrl).toBe('http://api.test/api/sqlib/.well-known/oauth-protected-resource');
      expect(resource).toBe('http://api.test/api/sqlib/mcp');
      await app.close();
    });

    it('keeps a URL resource as it is, and names the document under the base path at its origin', async () => {
      const app = await buildApp('required', {
        basePath: '/api/sqlib',
        env: { SQLIB_AUTH_RESOURCE: 'https://sqlib.test/api/sqlib/mcp' },
      });
      const { metadataUrl, resource } = await discover(app, '/api/sqlib/mcp');

      expect(metadataUrl).toBe('https://sqlib.test/api/sqlib/.well-known/oauth-protected-resource');
      expect(resource).toBe('https://sqlib.test/api/sqlib/mcp');
      await app.close();
    });

    it('uses the public base path when a proxy removes the prefix', async () => {
      // The proxy forwards `/sqlib/mcp` as `/mcp`, so sqlib has no base path of its own.
      const app = await buildApp('required', { publicBasePath: '/sqlib', env: UNCHECKED });
      const refused = await app.inject({ method: 'POST', url: '/mcp', payload: {}, headers: { host: 'api.test' } });

      expect(String(refused.headers['www-authenticate'])).toContain(
        'resource_metadata="http://api.test/sqlib/.well-known/oauth-protected-resource"'
      );
      const document = await app.inject({
        method: 'GET',
        url: '/.well-known/oauth-protected-resource',
        headers: { host: 'api.test' },
      });
      expect(document.json().resource).toBe('http://api.test/sqlib/mcp');
      await app.close();
    });

    it('ignores forwarded headers unless the proxy is trusted', async () => {
      const forwarded = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'data.example.org' };

      const untrusting = await buildApp('required', { basePath: '/api/sqlib', env: UNCHECKED });
      expect((await discover(untrusting, '/api/sqlib/mcp', forwarded)).resource).toBe('http://api.test/api/sqlib/mcp');
      await untrusting.close();

      const trusting = await buildApp('required', { basePath: '/api/sqlib', env: UNCHECKED, trustProxy: true });
      const { metadataUrl, resource } = await discover(trusting, '/api/sqlib/mcp', forwarded);
      expect(metadataUrl).toBe('https://data.example.org/api/sqlib/.well-known/oauth-protected-resource');
      expect(resource).toBe('https://data.example.org/api/sqlib/mcp');
      await trusting.close();
    });

    it('builds both URLs from SQLIB_PUBLIC_ORIGIN when it is set', async () => {
      process.env.SQLIB_PUBLIC_ORIGIN = 'https://data.example.org';
      const app = await buildApp('required', { basePath: '/api/sqlib', env: UNCHECKED });
      const { metadataUrl, resource } = await discover(app, '/api/sqlib/mcp');

      expect(metadataUrl).toBe('https://data.example.org/api/sqlib/.well-known/oauth-protected-resource');
      expect(resource).toBe('https://data.example.org/api/sqlib/mcp');
      await app.close();
    });
  });

  it('uses SQLIB_PUBLIC_ORIGIN with no base path, for a resource that is not a URL', async () => {
    const before = process.env.SQLIB_PUBLIC_ORIGIN;
    process.env.SQLIB_PUBLIC_ORIGIN = 'https://data.example.org';
    try {
      const app = await buildApp('required');
      const refused = await app.inject({ method: 'POST', url: '/mcp', payload: {}, headers: { host: 'internal:3000' } });
      expect(String(refused.headers['www-authenticate'])).toContain(
        'resource_metadata="https://data.example.org/.well-known/oauth-protected-resource"'
      );
      await app.close();
    } finally {
      if (before === undefined) delete process.env.SQLIB_PUBLIC_ORIGIN;
      else process.env.SQLIB_PUBLIC_ORIGIN = before;
    }
  });

  it('answers 404 when no issuer is configured', async () => {
    resetAuthConfig({ SQLIB_AUTH_MODE: 'disabled' } as NodeJS.ProcessEnv);
    const app = Fastify({ logger: false });
    await registerAuthPlugin(app);
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' })).statusCode).toBe(404);
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

  it('refuses to start an enforcing mode with no audience', () => {
    for (const mode of ['required', 'dry-run']) {
      expect(() =>
        resetAuthConfig({ SQLIB_AUTH_MODE: mode, SQLIB_AUTH_ISSUER: ISSUER } as NodeJS.ProcessEnv)
      ).toThrow(/requires an audience.*SQLIB_AUTH_AUDIENCE_UNCHECKED=true/);
    }
  });

  it('refuses an issuer list in which any entry has no audience', () => {
    expect(() =>
      resetAuthConfig({
        SQLIB_AUTH_MODE: 'required',
        SQLIB_AUTH_ISSUERS_JSON: JSON.stringify([
          { issuer: ISSUER, audience: AUDIENCE },
          { issuer: 'https://other.test/', audience: '  ' },
        ]),
      } as NodeJS.ProcessEnv)
    ).toThrow(/missing for https:\/\/other\.test\//);
  });

  it('starts without an audience only when SQLIB_AUTH_AUDIENCE_UNCHECKED=true says so', () => {
    expect(() =>
      resetAuthConfig({
        SQLIB_AUTH_MODE: 'required',
        SQLIB_AUTH_ISSUER: ISSUER,
        SQLIB_AUTH_AUDIENCE_UNCHECKED: 'yes',
      } as NodeJS.ProcessEnv)
    ).toThrow(/requires an audience/);

    const config = resetAuthConfig({
      SQLIB_AUTH_MODE: 'required',
      SQLIB_AUTH_ISSUER: ISSUER,
      SQLIB_AUTH_AUDIENCE_UNCHECKED: 'true',
    } as NodeJS.ProcessEnv);
    expect(config.audienceUnchecked).toBe(true);
    expect(config.issuers[0].audience).toBeUndefined();
  });

  it('does not ask for an audience in disabled mode', () => {
    expect(() =>
      resetAuthConfig({ SQLIB_AUTH_MODE: 'disabled', SQLIB_AUTH_ISSUER: ISSUER } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it('rejects an unrecognised mode rather than defaulting to open', () => {
    expect(() => resetAuthConfig({ SQLIB_AUTH_MODE: 'enforced' } as NodeJS.ProcessEnv))
      .toThrow(/Invalid SQLIB_AUTH_MODE/);
  });

  it('takes the resource from SQLIB_AUTH_RESOURCE, else the first audience', () => {
    const base = { SQLIB_AUTH_MODE: 'required', SQLIB_AUTH_ISSUER: ISSUER, SQLIB_AUTH_AUDIENCE: AUDIENCE };
    expect(resetAuthConfig(base as NodeJS.ProcessEnv).resource).toBe(AUDIENCE);
    expect(
      resetAuthConfig({ ...base, SQLIB_AUTH_RESOURCE: ' https://sqlib.test/mcp ' } as NodeJS.ProcessEnv).resource
    ).toBe('https://sqlib.test/mcp');
  });

  it('reads SQLIB_AUTH_SCOPES as a space- or comma-separated list', () => {
    expect(resetAuthConfig({ SQLIB_AUTH_SCOPES: 'openid, profile  sqlib,openid' } as NodeJS.ProcessEnv).scopes)
      .toEqual(['openid', 'profile', 'sqlib']);
  });

  it('defaults to disabled when unset', () => {
    expect(resetAuthConfig({} as NodeJS.ProcessEnv).mode).toBe('disabled');
  });
});
