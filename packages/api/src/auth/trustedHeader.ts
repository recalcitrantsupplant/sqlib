/**
 * `SQLIB_AUTH_MODE=trusted-header` (#208): the caller comes from a header that
 * a sign-in proxy sets, such as Azure App Service authentication
 * (`x-ms-client-principal`) or oauth2-proxy (`x-forwarded-user`).
 *
 * The proxy keeps the session in its own cookie and sends no bearer token, so
 * sqlib reads the header on every request and stores nothing from it. Anyone
 * who can reach sqlib without the proxy could set the header to any user, so
 * the mode also needs a secret that the proxy adds to every request
 * (`SQLIB_AUTH_TRUSTED_SECRET_HEADER`, `SQLIB_AUTH_TRUSTED_SECRET`). A
 * request without the secret is refused.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export type TrustedHeaderFormat = 'plain' | 'ms-client-principal';

export interface TrustedHeaderConfig {
  /** The identity header, lower case. */
  header: string;
  format: TrustedHeaderFormat;
  /** `plain` only: a comma-separated groups header, lower case. */
  groupsHeader?: string;
  /** `plain` only: an email header, lower case, used to label the person. */
  emailHeader?: string;
  /**
   * The issuer that principal IRIs and `SQLIB_AUTH_ADMIN_PRINCIPALS` entries
   * are built with, as a token's `iss` is in the other modes.
   */
  issuer: string;
  /** The header that carries the shared secret, lower case. */
  secretHeader: string;
  secret: string;
}

/** The default `SQLIB_AUTH_TRUSTED_ISSUER`. */
export const DEFAULT_TRUSTED_ISSUER = 'urn:sqlib:trusted-header';

/** The shortest secret the server accepts at start. */
export const MIN_TRUSTED_SECRET_LENGTH = 16;

/** Roles that Azure adds to every caller. They are not groups. */
const AZURE_BUILT_IN_ROLES = new Set(['anonymous', 'authenticated']);

/** The caller a proxy header names, in the shape `derivePrincipals` reads. */
export interface TrustedIdentity {
  subject: string;
  /** Claims for `labelOf` and `displayNameOf`, and `groups` for the groups. */
  claims: Record<string, unknown>;
}

export class TrustedHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrustedHeaderError';
  }
}

function single(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** True when the request carries the proxy's secret. Constant time in the secret. */
export function hasTrustedSecret(headers: IncomingHttpHeaders, config: TrustedHeaderConfig): boolean {
  const sent = single(headers[config.secretHeader]);
  if (!sent) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(sent), digest(config.secret));
}

function splitList(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map(part => part.trim()).filter(Boolean))];
}

function readPlain(headers: IncomingHttpHeaders, config: TrustedHeaderConfig): TrustedIdentity | null {
  const subject = single(headers[config.header]);
  if (!subject) return null;
  const claims: Record<string, unknown> = {
    groups: config.groupsHeader ? splitList(single(headers[config.groupsHeader])) : [],
  };
  const email = config.emailHeader ? single(headers[config.emailHeader]) : null;
  if (email) claims.email = email;
  // oauth2-proxy sends a username beside the user id.
  if (subject.includes('@') && !email) claims.email = subject;
  // The user id is the caller's display name. `displayNameOf` skips an email.
  else claims.preferred_username = subject;
  return { subject, claims };
}

interface MsClaim {
  typ?: unknown;
  val?: unknown;
}

/** The claim types App Service authentication uses for the user id, in order. */
const APP_SERVICE_ID_CLAIMS = [
  'http://schemas.microsoft.com/identity/claims/objectidentifier',
  'oid',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
  'sub',
];

/**
 * Reads `x-ms-client-principal`: base64 JSON in one of two shapes.
 *
 * - Static Web Apps: `{ identityProvider, userId, userDetails, userRoles }`.
 * - App Service authentication: `{ auth_typ, claims: [{ typ, val }], name_typ, role_typ }`.
 */
function readMsClientPrincipal(headers: IncomingHttpHeaders, config: TrustedHeaderConfig): TrustedIdentity | null {
  const raw = single(headers[config.header]);
  if (!raw) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new TrustedHeaderError(`The ${config.header} header is not base64 JSON.`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new TrustedHeaderError(`The ${config.header} header is not a JSON object.`);
  }

  if (typeof parsed.userId === 'string' && parsed.userId.trim()) {
    const roles = Array.isArray(parsed.userRoles) ? parsed.userRoles : [];
    const claims: Record<string, unknown> = {
      groups: roles.filter((role): role is string => typeof role === 'string' && !AZURE_BUILT_IN_ROLES.has(role)),
    };
    if (typeof parsed.userDetails === 'string' && parsed.userDetails.trim()) {
      claims.preferred_username = parsed.userDetails.trim();
    }
    return { subject: parsed.userId.trim(), claims };
  }

  if (Array.isArray(parsed.claims)) {
    const list = (parsed.claims as MsClaim[]).filter(
      (claim): claim is { typ: string; val: string } => typeof claim?.typ === 'string' && typeof claim?.val === 'string'
    );
    const first = (types: string[]) => {
      for (const type of types) {
        const found = list.find(claim => claim.typ === type);
        if (found?.val.trim()) return found.val.trim();
      }
      return undefined;
    };
    const nameType = typeof parsed.name_typ === 'string' ? parsed.name_typ : 'name';
    const roleType = typeof parsed.role_typ === 'string' ? parsed.role_typ : 'roles';
    const subject = first(APP_SERVICE_ID_CLAIMS);
    if (!subject) throw new TrustedHeaderError(`The ${config.header} header names no user id.`);
    const claims: Record<string, unknown> = {
      groups: [...new Set(list.filter(claim => claim.typ === roleType || claim.typ === 'groups').map(claim => claim.val))],
    };
    const name = first([nameType, 'name']);
    if (name) claims.name = name;
    const email = first(['preferred_username', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'email']);
    if (email) claims.email = email;
    return { subject, claims };
  }

  throw new TrustedHeaderError(`The ${config.header} header names no user id.`);
}

/**
 * The caller the proxy names, or null when the identity header is absent.
 * Throws `TrustedHeaderError` when the header is present and unreadable.
 */
export function readTrustedIdentity(headers: IncomingHttpHeaders, config: TrustedHeaderConfig): TrustedIdentity | null {
  return config.format === 'ms-client-principal' ? readMsClientPrincipal(headers, config) : readPlain(headers, config);
}

/** Builds the mode's settings from the environment, or throws a start-up error. */
export function parseTrustedHeaderConfig(env: NodeJS.ProcessEnv): TrustedHeaderConfig {
  const lower = (value: string | undefined) => value?.trim().toLowerCase() || undefined;
  const header = lower(env.SQLIB_AUTH_TRUSTED_HEADER);
  if (!header) {
    throw new Error('SQLIB_AUTH_MODE=trusted-header requires SQLIB_AUTH_TRUSTED_HEADER: the header the sign-in proxy sets.');
  }
  const formatRaw = lower(env.SQLIB_AUTH_TRUSTED_FORMAT) ?? 'plain';
  if (formatRaw !== 'plain' && formatRaw !== 'ms-client-principal') {
    throw new Error(`Invalid SQLIB_AUTH_TRUSTED_FORMAT "${formatRaw}". Expected "plain" or "ms-client-principal".`);
  }
  const secretHeader = lower(env.SQLIB_AUTH_TRUSTED_SECRET_HEADER);
  const secret = env.SQLIB_AUTH_TRUSTED_SECRET?.trim();
  if (!secretHeader || !secret) {
    throw new Error(
      'SQLIB_AUTH_MODE=trusted-header requires SQLIB_AUTH_TRUSTED_SECRET_HEADER and SQLIB_AUTH_TRUSTED_SECRET: ' +
        'a secret the proxy adds to every request, so a request that bypasses the proxy cannot name a user.'
    );
  }
  if (secret.length < MIN_TRUSTED_SECRET_LENGTH) {
    throw new Error(`SQLIB_AUTH_TRUSTED_SECRET must be at least ${MIN_TRUSTED_SECRET_LENGTH} characters.`);
  }
  if (secretHeader === header) {
    throw new Error('SQLIB_AUTH_TRUSTED_SECRET_HEADER must differ from SQLIB_AUTH_TRUSTED_HEADER.');
  }
  return {
    header,
    format: formatRaw,
    groupsHeader: formatRaw === 'plain' ? lower(env.SQLIB_AUTH_TRUSTED_GROUPS_HEADER) : undefined,
    emailHeader: formatRaw === 'plain' ? lower(env.SQLIB_AUTH_TRUSTED_EMAIL_HEADER) : undefined,
    issuer: env.SQLIB_AUTH_TRUSTED_ISSUER?.trim() || DEFAULT_TRUSTED_ISSUER,
    secretHeader,
    secret,
  };
}
