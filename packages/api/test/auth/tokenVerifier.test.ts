/**
 * Token validation is the front door: everything downstream trusts what comes
 * out of it. These cover the attacks that actually get used — algorithm
 * confusion, audience/issuer mix-ups, and expiry edges — not just the happy path.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { buildAuthConfig } from '../../src/auth/config.js';
import { TokenError, TokenVerifier } from '../../src/auth/tokenVerifier.js';

const ISSUER = 'https://issuer.test/';
const AUDIENCE = 'sqlib-api';

let privateKey: CryptoKey;
let publicJwk: JWK;
let fetchCalls = 0;

function configFor(overrides: Record<string, string> = {}) {
  return buildAuthConfig({
    SQLIB_AUTH_MODE: 'required',
    SQLIB_AUTH_ISSUER: ISSUER,
    SQLIB_AUTH_AUDIENCE: AUDIENCE,
    SQLIB_AUTH_JWKS_URI: 'https://issuer.test/jwks',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

async function sign(payload: Record<string, unknown>, options: { expiresIn?: string; notBefore?: string } = {}) {
  let builder = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer(String(payload.iss ?? ISSUER))
    .setAudience(String(payload.aud ?? AUDIENCE));
  builder = builder.setExpirationTime(options.expiresIn ?? '5m');
  if (options.notBefore) builder = builder.setNotBefore(options.notBefore);
  return builder.sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = 'test-key';
  publicJwk.alg = 'RS256';

  // Serve the JWKS locally: these tests must not depend on the network.
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls += 1;
    const url = String(input);
    if (url.includes('/jwks')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  fetchCalls = 0;
});

describe('TokenVerifier.extractBearer', () => {
  it('reads a bearer token case-insensitively', () => {
    expect(TokenVerifier.extractBearer('Bearer abc')).toBe('abc');
    expect(TokenVerifier.extractBearer('bearer abc')).toBe('abc');
  });

  it('ignores other authorization schemes and empty values', () => {
    expect(TokenVerifier.extractBearer('Basic abc')).toBeNull();
    expect(TokenVerifier.extractBearer(undefined)).toBeNull();
    expect(TokenVerifier.extractBearer('')).toBeNull();
  });
});

describe('TokenVerifier.verify', () => {
  it('accepts a well-formed token and returns its subject and claims', async () => {
    const verifier = new TokenVerifier(configFor());
    const token = await sign({ sub: 'user-1', groups: ['team-geo'] });

    const result = await verifier.verify(token);

    expect(result.subject).toBe('user-1');
    expect(result.issuerConfig.issuer).toBe(ISSUER);
    expect(result.claims.groups).toEqual(['team-geo']);
  });

  it('rejects an expired token', async () => {
    const verifier = new TokenVerifier(configFor({ SQLIB_AUTH_CLOCK_SKEW_S: '0' }));
    const token = await sign({ sub: 'user-1' }, { expiresIn: '-1s' });

    await expect(verifier.verify(token)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('honours the configured clock skew for a just-expired token', async () => {
    const token = await sign({ sub: 'user-1' }, { expiresIn: '-30s' });

    await expect(new TokenVerifier(configFor({ SQLIB_AUTH_CLOCK_SKEW_S: '0' })).verify(token))
      .rejects.toMatchObject({ kind: 'invalid' });
    await expect(new TokenVerifier(configFor({ SQLIB_AUTH_CLOCK_SKEW_S: '120' })).verify(token))
      .resolves.toMatchObject({ subject: 'user-1' });
  });

  it('rejects a not-yet-valid token', async () => {
    const verifier = new TokenVerifier(configFor({ SQLIB_AUTH_CLOCK_SKEW_S: '0' }));
    const token = await sign({ sub: 'user-1' }, { notBefore: '10m' });

    await expect(verifier.verify(token)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('rejects a token for a different audience', async () => {
    const verifier = new TokenVerifier(configFor());
    const token = await sign({ sub: 'user-1', aud: 'some-other-api' });

    await expect(verifier.verify(token)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('rejects a token from an unconfigured issuer without fetching keys', async () => {
    const verifier = new TokenVerifier(configFor());
    const token = await sign({ sub: 'user-1', iss: 'https://evil.test/' });

    await expect(verifier.verify(token)).rejects.toMatchObject({ kind: 'unknown-issuer' });
    expect(fetchCalls).toBe(0);
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const verifier = new TokenVerifier(configFor());
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user-1', iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 300 })
    ).toString('base64url');

    await expect(verifier.verify(`${header}.${payload}.`)).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects an HS256 token signed with the public key as the shared secret', async () => {
    // The classic algorithm-confusion attack: without an asymmetric-only
    // allowlist, a published public key becomes a signing secret.
    const verifier = new TokenVerifier(configFor());
    const secret = new TextEncoder().encode(JSON.stringify(publicJwk));
    const token = await new SignJWT({ sub: 'attacker' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(secret);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects a token with no subject claim', async () => {
    const verifier = new TokenVerifier(configFor());
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(privateKey);

    await expect(verifier.verify(token)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('rejects a malformed token', async () => {
    const verifier = new TokenVerifier(configFor());
    await expect(verifier.verify('not-a-jwt')).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('selects the matching issuer config in a multi-issuer deployment', async () => {
    const config = buildAuthConfig({
      SQLIB_AUTH_MODE: 'required',
      SQLIB_AUTH_ISSUERS_JSON: JSON.stringify([
        { issuer: 'https://other.test/', audience: 'other', jwksUri: 'https://other.test/jwks' },
        { issuer: ISSUER, audience: AUDIENCE, jwksUri: 'https://issuer.test/jwks', claimGroups: 'roles' },
      ]),
    } as NodeJS.ProcessEnv);

    const result = await new TokenVerifier(config).verify(await sign({ sub: 'user-1', roles: ['a'] }));

    expect(result.issuerConfig.claimGroups).toBe('roles');
  });

  it('reports a JWKS failure as 503 rather than blaming the caller', () => {
    const error = new TokenError('jwks-unavailable', 'boom');
    expect(error.statusCode).toBe(503);
    expect(new TokenError('invalid', 'boom').statusCode).toBe(401);
  });
});
