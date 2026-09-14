/**
 * Auth configuration from environment (design §10).
 *
 * Follows the `featureFlags.ts` shape: resolved once, re-resolvable so tests can
 * point the module at a different environment.
 */
import type { AuthMode } from './types.js';

export interface IssuerConfig {
  issuer: string;
  audience?: string;
  jwksUri?: string;
  /** Dot-path to the group/role claim. Entra: `groups`; Keycloak: `realm_access.roles`. */
  claimGroups: string;
  /** Dot-path used for machine-to-machine detection. */
  claimClientId: string;
}

export interface AuthConfig {
  mode: AuthMode;
  issuers: IssuerConfig[];
  clockSkewSeconds: number;
  /** Raw claim values (`iss|sub`, `iss|group:value`) treated as admins at boot. */
  adminPrincipals: string[];
  seedGrantsPath?: string;
  allowLibraryCreate: 'all' | 'admin';
  protectDocs: boolean;
}

function parseMode(raw: string | undefined): AuthMode {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'required':
      return 'required';
    case 'dry-run':
    case 'dryrun':
      return 'dry-run';
    case 'disabled':
    case '':
      return 'disabled';
    default:
      throw new Error(
        `Invalid SQLIB_AUTH_MODE "${raw}". Expected one of: disabled, dry-run, required.`
      );
  }
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function parseIssuers(env: NodeJS.ProcessEnv): IssuerConfig[] {
  const json = env.SQLIB_AUTH_ISSUERS_JSON?.trim();
  if (json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new Error(`SQLIB_AUTH_ISSUERS_JSON is not valid JSON: ${(error as Error).message}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('SQLIB_AUTH_ISSUERS_JSON must be a non-empty array of issuer configs.');
    }
    return parsed.map((entry, index) => {
      const item = entry as Partial<IssuerConfig>;
      if (!item || typeof item.issuer !== 'string' || !item.issuer.trim()) {
        throw new Error(`SQLIB_AUTH_ISSUERS_JSON[${index}] is missing a string "issuer".`);
      }
      return {
        issuer: item.issuer.trim(),
        audience: typeof item.audience === 'string' ? item.audience : undefined,
        jwksUri: typeof item.jwksUri === 'string' ? item.jwksUri : undefined,
        claimGroups: typeof item.claimGroups === 'string' ? item.claimGroups : 'groups',
        claimClientId: typeof item.claimClientId === 'string' ? item.claimClientId : 'azp',
      };
    });
  }

  const issuer = env.SQLIB_AUTH_ISSUER?.trim();
  if (!issuer) return [];

  return [
    {
      issuer,
      audience: env.SQLIB_AUTH_AUDIENCE?.trim() || undefined,
      jwksUri: env.SQLIB_AUTH_JWKS_URI?.trim() || undefined,
      claimGroups: env.SQLIB_AUTH_CLAIM_GROUPS?.trim() || 'groups',
      claimClientId: env.SQLIB_AUTH_CLAIM_CLIENT_ID?.trim() || 'azp',
    },
  ];
}

export function buildAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const mode = parseMode(env.SQLIB_AUTH_MODE);
  const issuers = parseIssuers(env);

  if (mode !== 'disabled' && issuers.length === 0) {
    throw new Error(
      `SQLIB_AUTH_MODE=${mode} requires an issuer: set SQLIB_AUTH_ISSUER (+ SQLIB_AUTH_AUDIENCE) or SQLIB_AUTH_ISSUERS_JSON.`
    );
  }

  const skewRaw = env.SQLIB_AUTH_CLOCK_SKEW_S?.trim();
  const clockSkewSeconds = skewRaw ? Number.parseInt(skewRaw, 10) : 60;
  if (!Number.isFinite(clockSkewSeconds) || clockSkewSeconds < 0) {
    throw new Error(`Invalid SQLIB_AUTH_CLOCK_SKEW_S "${skewRaw}". Expected a non-negative integer.`);
  }

  const allowLibraryCreateRaw = (env.SQLIB_AUTH_ALLOW_LIBRARY_CREATE ?? 'all').trim().toLowerCase();
  if (allowLibraryCreateRaw !== 'all' && allowLibraryCreateRaw !== 'admin') {
    throw new Error(
      `Invalid SQLIB_AUTH_ALLOW_LIBRARY_CREATE "${allowLibraryCreateRaw}". Expected "all" or "admin".`
    );
  }

  return {
    mode,
    issuers,
    clockSkewSeconds,
    adminPrincipals: parseList(env.SQLIB_AUTH_ADMIN_PRINCIPALS),
    seedGrantsPath: env.SQLIB_AUTH_SEED_GRANTS?.trim() || undefined,
    allowLibraryCreate: allowLibraryCreateRaw,
    protectDocs: (env.SQLIB_AUTH_PROTECT_DOCS ?? '').trim().toLowerCase() === 'true',
  };
}

let currentConfig: AuthConfig | null = null;

export function getAuthConfig(): AuthConfig {
  if (!currentConfig) {
    currentConfig = buildAuthConfig(process.env);
  }
  return currentConfig;
}

export function resetAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  currentConfig = buildAuthConfig(env);
  return currentConfig;
}

export function getAuthMode(): AuthMode {
  return getAuthConfig().mode;
}
