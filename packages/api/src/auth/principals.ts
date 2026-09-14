/**
 * Principal canonicalization and claim extraction (design §3.2).
 *
 * IdP identifiers (emails, GUIDs, group names) are hashed with their issuer into
 * stable IRIs, so grant data never carries raw identity strings while staying
 * deterministic across restarts. The raw value is stored beside the principal in
 * the auth graph as a literal, for admin readability and search.
 */
import { createHash } from 'node:crypto';
import { PRINCIPAL_AUTHENTICATED } from './types.js';

export type PrincipalKind = 'user' | 'group' | 'client';

const PRINCIPAL_PREFIX = 'urn:sqlib:principal:';

function hashPrincipal(issuer: string, rawValue: string): string {
  return createHash('sha256').update(`${issuer}|${rawValue}`).digest('hex').slice(0, 32);
}

export function principalIri(kind: PrincipalKind, issuer: string, rawValue: string): string {
  return `${PRINCIPAL_PREFIX}${kind}:${hashPrincipal(issuer, rawValue)}`;
}

/**
 * Canonicalizes a bootstrap admin entry from `SQLIB_AUTH_ADMIN_PRINCIPALS`.
 *
 * Accepted forms:
 *   - `https://issuer/|subject-value`            → user principal
 *   - `https://issuer/|group:group-value`        → group principal
 *   - `https://issuer/|client:client-id`         → client principal
 *   - `urn:sqlib:principal:...`                  → already canonical, passed through
 */
export function canonicalizeAdminEntry(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(PRINCIPAL_PREFIX)) return trimmed;

  const separator = trimmed.indexOf('|');
  if (separator <= 0 || separator === trimmed.length - 1) return null;

  const issuer = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  if (!issuer || !value) return null;

  let kind: PrincipalKind = 'user';
  if (value.startsWith('group:')) {
    kind = 'group';
    value = value.slice('group:'.length);
  } else if (value.startsWith('client:')) {
    kind = 'client';
    value = value.slice('client:'.length);
  }
  if (!value) return null;

  return principalIri(kind, issuer, value);
}

/** Reads a dot-path out of a claims object. Returns undefined for any miss. */
export function readClaimPath(claims: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = claims;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Extracts group/role values from a claim path.
 *
 * Arrays of strings only — a single string is accepted as a one-element list
 * because some IdPs collapse singletons, but objects and numbers are ignored
 * rather than coerced (a coerced group name is a silent authorization change).
 */
export function extractGroupValues(claims: Record<string, unknown>, path: string): string[] {
  const raw = readClaimPath(claims, path);
  if (typeof raw === 'string') {
    return raw.trim() ? [raw.trim()] : [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean);
}

export interface DerivedPrincipals {
  subject: string;
  principals: string[];
  tokenType: 'user' | 'client';
  /** Canonical IRI → raw claim value, for auth-graph principal descriptions. */
  rawByPrincipal: Map<string, string>;
}

/**
 * Builds the principal set for a validated token.
 *
 * The authenticated sentinel is always included, which is what makes
 * "any signed-in user" expressible as an ordinary grant (design §4.5).
 */
export function derivePrincipals(params: {
  issuer: string;
  subject: string;
  claims: Record<string, unknown>;
  claimGroups: string;
  claimClientId: string;
}): DerivedPrincipals {
  const { issuer, subject, claims, claimGroups, claimClientId } = params;

  const clientId = readClaimPath(claims, claimClientId);
  const isClient = typeof clientId === 'string' && clientId.length > 0 && clientId === subject;
  const kind: PrincipalKind = isClient ? 'client' : 'user';

  const subjectIri = principalIri(kind, issuer, subject);
  const rawByPrincipal = new Map<string, string>([[subjectIri, subject]]);

  const principals = [subjectIri, PRINCIPAL_AUTHENTICATED];

  for (const group of extractGroupValues(claims, claimGroups)) {
    const iri = principalIri('group', issuer, group);
    if (!rawByPrincipal.has(iri)) {
      rawByPrincipal.set(iri, group);
      principals.push(iri);
    }
  }

  return {
    subject: subjectIri,
    principals,
    tokenType: isClient ? 'client' : 'user',
    rawByPrincipal,
  };
}
