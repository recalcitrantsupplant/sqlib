/**
 * OIDC bearer token validation (design §3.1).
 *
 * sqlib is a resource server only: it validates JWTs issued by whatever provider
 * the operator already runs, and never issues or stores credentials.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { AuthConfig, IssuerConfig } from './config.js';

/**
 * Asymmetric algorithms only. HS* would let a leaked public key mint tokens.
 * EdDSA because it is Rauthy's default, and the default of every client an MCP
 * client registers there for itself (design/auth-architecture.md).
 */
const ALLOWED_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'EdDSA'];

export type TokenErrorKind =
  | 'missing'
  | 'malformed'
  | 'unknown-issuer'
  | 'invalid'
  | 'jwks-unavailable';

export class TokenError extends Error {
  constructor(
    readonly kind: TokenErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'TokenError';
  }

  /** JWKS problems are ours, not the caller's — a 401 would blame the wrong party. */
  get statusCode(): number {
    return this.kind === 'jwks-unavailable' ? 503 : 401;
  }
}

export interface VerifiedToken {
  issuerConfig: IssuerConfig;
  subject: string;
  claims: JWTPayload & Record<string, unknown>;
}

function decodeIssuerUnverified(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
    if (!payload || typeof payload !== 'object') return null;
    const iss = (payload as { iss?: unknown }).iss;
    return typeof iss === 'string' && iss ? iss : null;
  } catch {
    return null;
  }
}

/**
 * Key-resolution failures that are the token's doing, not the key set's.
 *
 * Everything else `createRemoteJWKSet` can throw comes from fetching the set —
 * a timeout, a refused connection, a non-200, a body that is not a JWKS — and
 * is ours to answer for with a 503. A `kid` the set does not hold is not one of
 * those: the set was fetched fine and the token names a key nobody published.
 * Reporting that as 503 blamed the server for a forged or stale token, and
 * invited a client to retry it forever. jose already refuses to refetch for an
 * unknown `kid` inside `cooldownDuration`, so a stream of made-up key ids costs
 * one fetch per cooldown rather than one per request.
 */
const TOKEN_KEY_MISMATCH_CODES = new Set([
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JOSE_NOT_SUPPORTED',
]);

function isTokenKeyMismatch(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && TOKEN_KEY_MISMATCH_CODES.has(code);
}

function issuerBase(issuer: string): string {
  return issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
}

function defaultJwksUri(issuer: string): string {
  return `${issuerBase(issuer)}/.well-known/jwks.json`;
}

/**
 * Where an issuer publishes its keys, from its OIDC discovery document
 * (OpenID Connect Discovery §4). Few brokers serve `/.well-known/jwks.json`
 * (Rauthy: `/oidc/certs`; Keycloak: `/protocol/openid-connect/certs`; Entra:
 * `/discovery/v2.0/keys`), so without this nearly every broker needed
 * `SQLIB_AUTH_JWKS_URI` as a fourth setting. An issuer with no discovery
 * document (a 404) keeps the old default. A document naming another issuer
 * is refused, as §4.3 requires; anything unreachable throws, so the caller
 * answers 503 and the next request asks again.
 */
async function discoverJwksUri(issuer: string): Promise<string> {
  const response = await fetch(`${issuerBase(issuer)}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return defaultJwksUri(issuer);
  if (!response.ok) throw new Error(`Discovery for ${issuer} answered ${response.status}.`);
  const document = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown };
  if (document.issuer !== issuer) {
    throw new Error(`Discovery for ${issuer} names another issuer: ${String(document.issuer)}.`);
  }
  if (typeof document.jwks_uri !== 'string') throw new Error(`Discovery for ${issuer} has no jwks_uri.`);
  return document.jwks_uri;
}

function remoteKeySet(uri: string, issuer: string): JWTVerifyGetKey {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new TokenError('jwks-unavailable', `Invalid JWKS URI for issuer ${issuer}: ${uri}`);
  }
  return createRemoteJWKSet(parsed, {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
  });
}

export class TokenVerifier {
  /**
   * One JWKS per issuer, created lazily and kept for the process lifetime.
   * `createRemoteJWKSet` handles caching, cooldown and key rollover internally —
   * recreating it per request would defeat all three.
   */
  private readonly jwks = new Map<string, JWTVerifyGetKey>();

  constructor(private readonly config: AuthConfig) {}

  private issuerConfigFor(issuer: string): IssuerConfig | undefined {
    return this.config.issuers.find(candidate => candidate.issuer === issuer);
  }

  private jwksFor(issuerConfig: IssuerConfig): JWTVerifyGetKey {
    const existing = this.jwks.get(issuerConfig.issuer);
    if (existing) return existing;

    const { issuer, jwksUri } = issuerConfig;
    if (jwksUri) {
      const created = remoteKeySet(jwksUri, issuer);
      this.jwks.set(issuer, created);
      return created;
    }

    // Discovered on first use and kept once found. A failed discovery is not
    // kept, so a broker that was down at the first request is found later.
    let discovered: Promise<JWTVerifyGetKey> | null = null;
    const lazy: JWTVerifyGetKey = async (protectedHeader, flattened) => {
      discovered ??= discoverJwksUri(issuer)
        .then(uri => remoteKeySet(uri, issuer))
        .catch((error: unknown) => {
          discovered = null;
          throw error;
        });
      return (await discovered)(protectedHeader, flattened);
    };
    this.jwks.set(issuer, lazy);
    return lazy;
  }

  /** Extracts a bearer token from an Authorization header value. */
  static extractBearer(header: string | string[] | undefined): string | null {
    if (!header) return null;
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) return null;
    const match = /^Bearer\s+(.+)$/i.exec(value.trim());
    return match ? match[1].trim() : null;
  }

  async verify(token: string): Promise<VerifiedToken> {
    if (!token) {
      throw new TokenError('missing', 'No bearer token supplied.');
    }

    const issuer = decodeIssuerUnverified(token);
    if (!issuer) {
      throw new TokenError('malformed', 'Bearer token is not a well-formed JWT with an "iss" claim.');
    }

    const issuerConfig = this.issuerConfigFor(issuer);
    if (!issuerConfig) {
      throw new TokenError('unknown-issuer', `Token issuer is not configured: ${issuer}`);
    }

    const keySet = this.jwksFor(issuerConfig);
    const getKey: JWTVerifyGetKey = async (protectedHeader, flattened) => {
      try {
        return await keySet(protectedHeader, flattened);
      } catch (error) {
        if (isTokenKeyMismatch(error)) throw error;
        throw new TokenError('jwks-unavailable', `Unable to fetch signing keys for ${issuer}.`);
      }
    };

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(token, getKey, {
        issuer: issuerConfig.issuer,
        audience: issuerConfig.audience,
        algorithms: ALLOWED_ALGORITHMS,
        clockTolerance: this.config.clockSkewSeconds,
      });
      payload = verified.payload;
    } catch (error) {
      if (error instanceof TokenError) throw error;
      const err = error as { message?: string };
      throw new TokenError('invalid', err.message ?? 'Token verification failed.');
    }

    const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    if (!subject) {
      throw new TokenError('invalid', 'Token has no "sub" claim.');
    }

    return {
      issuerConfig,
      subject,
      claims: payload as JWTPayload & Record<string, unknown>,
    };
  }
}

let verifier: TokenVerifier | null = null;
let verifierConfig: AuthConfig | null = null;

export function getTokenVerifier(config: AuthConfig): TokenVerifier {
  if (!verifier || verifierConfig !== config) {
    verifier = new TokenVerifier(config);
    verifierConfig = config;
  }
  return verifier;
}

export function resetTokenVerifier(): void {
  verifier = null;
  verifierConfig = null;
}
