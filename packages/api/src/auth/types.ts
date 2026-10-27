/**
 * Core authorization types. See `docs/explanation/security-model.md`.
 *
 * `AuthContext` is the single object every enforcement point consults. It exists
 * in all three auth modes — in `disabled` mode it is a synthetic full-access
 * context — so downstream code never branches on "is auth on".
 */

/** Modes grantable on a library. `x` is deliberately independent of `r` (§4.2). */
export const LIBRARY_MODES = ['read', 'write', 'execute', 'delete', 'control'] as const;
export type LibraryMode = (typeof LIBRARY_MODES)[number];

/**
 * Modes grantable on a backend.
 *
 * Query and update each have two levels. `saved` runs saved queries (or
 * updates) only. `adhoc` also runs text the caller wrote, and includes
 * `saved`. So an analyst holding `query:adhoc` and `update:saved` can explore
 * freely and still change data only through updates someone saved.
 */
export const BACKEND_MODES = ['query:saved', 'query:adhoc', 'update:saved', 'update:adhoc'] as const;
export type BackendMode = (typeof BACKEND_MODES)[number];

/** The SPARQL operation a backend mode allows. */
export type BackendOperation = 'query' | 'update';

/** Whether the text being run was saved in a library or written by the caller. */
export type QueryTextSource = 'saved' | 'adhoc';

export function backendModeFor(operation: BackendOperation, source: QueryTextSource): BackendMode {
  return `${operation}:${source}`;
}

/** The modes that satisfy a required mode: itself, and `adhoc` for `saved`. */
export function modesSatisfying(mode: BackendMode): BackendMode[] {
  return mode.endsWith(':saved') ? [mode, mode.replace(':saved', ':adhoc') as BackendMode] : [mode];
}

export type AuthMode = 'disabled' | 'dry-run' | 'required';

/** Principal sentinel matching every successfully authenticated caller. */
export const PRINCIPAL_AUTHENTICATED = 'urn:sqlib:principal:authenticated';

/** Resource sentinel used by admin grants. */
export const RESOURCE_EVERYTHING = 'https://sparql-query-lib/auth#Everything';

export interface EffectiveGrants {
  admin: boolean;
  /** backend IRI → granted backend modes */
  backends: ReadonlyMap<string, ReadonlySet<BackendMode>>;
  /** library IRI → granted library modes */
  libraries: ReadonlyMap<string, ReadonlySet<LibraryMode>>;
}

export interface AuthContext {
  /** Canonical subject principal IRI, or a synthetic IRI in `disabled` mode. */
  subject: string;
  /** subject + group principals + the authenticated sentinel. */
  principals: readonly string[];
  issuer: string | null;
  tokenType: 'user' | 'client' | 'system';
  grants: EffectiveGrants;
  /**
   * Claims snapshot. Retained for audit and phase-2 templating; never serialized
   * wholesale into logs.
   */
  claims: Readonly<Record<string, unknown>>;
  /**
   * True when this context bypasses every check: `disabled` mode, and the
   * server's own identity (`SERVER_CONTEXT`). Distinct from `grants.admin`,
   * which a real principal can hold.
   */
  fullAccess: boolean;
  /** The mode this context was produced under. */
  mode: AuthMode;
}

const EMPTY_GRANTS: EffectiveGrants = {
  admin: true,
  backends: new Map(),
  libraries: new Map(),
};

/**
 * The server's own identity. Used by `SystemQueryRunner` and boot-time work that
 * runs on behalf of sqlib rather than a caller. One named constant rather than a
 * scattered convention — phase 2's policy evaluator reuses it (design §7.2).
 */
export const SERVER_CONTEXT: AuthContext = Object.freeze({
  subject: 'urn:sqlib:principal:system',
  principals: Object.freeze(['urn:sqlib:principal:system']) as readonly string[],
  issuer: null,
  tokenType: 'system' as const,
  grants: EMPTY_GRANTS,
  claims: Object.freeze({}),
  fullAccess: true,
  mode: 'disabled' as const,
});

/**
 * The context used when auth is disabled, or when a request reaches an
 * enforcement point without having passed through the auth plugin (unit tests
 * that mount a single route module). Full access, so behaviour is unchanged.
 */
export function createFullAccessContext(mode: AuthMode = 'disabled'): AuthContext {
  return {
    subject: 'urn:sqlib:principal:anonymous',
    principals: ['urn:sqlib:principal:anonymous', PRINCIPAL_AUTHENTICATED],
    issuer: null,
    tokenType: 'user',
    grants: EMPTY_GRANTS,
    claims: {},
    fullAccess: true,
    mode,
  };
}

export function isLibraryMode(value: string): value is LibraryMode {
  return (LIBRARY_MODES as readonly string[]).includes(value);
}

export function isBackendMode(value: string): value is BackendMode {
  return (BACKEND_MODES as readonly string[]).includes(value);
}
