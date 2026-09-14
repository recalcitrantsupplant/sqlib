/**
 * OIDC bearer token validation (design §3.1).
 *
 * sqlib is a resource server only: it validates JWTs issued by whatever provider
 * the operator already runs, and never issues or stores credentials.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { AuthConfig, IssuerConfig } from './config.js';

/** Asymmetric algorithms only. HS* would let a leaked public key mint tokens. */
const ALLOWED_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384'];

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

function defaultJwksUri(issuer: string): string {
  const base = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
  return `${base}/.well-known/jwks.json`;
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

    const uri = issuerConfig.jwksUri ?? defaultJwksUri(issuerConfig.issuer);
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new TokenError('jwks-unavailable', `Invalid JWKS URI for issuer ${issuerConfig.issuer}: ${uri}`);
    }

    const created = createRemoteJWKSet(parsed, {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
    this.jwks.set(issuerConfig.issuer, created);
    return created;
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

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(token, keySet, {
        issuer: issuerConfig.issuer,
        audience: issuerConfig.audience,
        algorithms: ALLOWED_ALGORITHMS,
        clockTolerance: this.config.clockSkewSeconds,
      });
      payload = verified.payload;
    } catch (error) {
      const err = error as { code?: string; message?: string };
      // Distinguish "we cannot check" from "the token is bad": a JWKS fetch
      // failure must not be reported to the caller as an invalid token.
      if (err.code === 'ERR_JWKS_NO_MATCHING_KEY' || err.code === 'ERR_JWKS_TIMEOUT') {
        throw new TokenError('jwks-unavailable', `Unable to resolve signing keys for ${issuer}.`);
      }
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
