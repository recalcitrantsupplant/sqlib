/**
 * Enforcement helpers (design §7).
 *
 * Every route consults these rather than inspecting grants directly, so the
 * three auth modes, the audit trail and the 401/403 shapes are decided in one
 * place. Routes that never received an `AuthContext` (unit tests mounting a
 * single route module) fall back to full access, which is exactly `disabled`
 * mode — the enforced path and the open path are the same code.
 */
import type { FastifyRequest } from 'fastify';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { auditDecision } from './audit.js';
import { getAuthConfig } from './config.js';
import { hasBackendMode, hasLibraryMode } from './grants.js';
import {
  createFullAccessContext,
  type AuthContext,
  type BackendMode,
  type LibraryMode,
} from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}

export class AuthorizationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = 'AuthorizationError';
    this.statusCode = statusCode;
  }
}

/**
 * The caller's context, or a full-access context when the auth plugin was not
 * registered. Never returns undefined — enforcement code has no null branch.
 */
export function authOf(request: FastifyRequest | null | undefined): AuthContext {
  return request?.authContext ?? createFullAccessContext();
}

/**
 * Applies a decision under the current mode.
 *
 * `dry-run` audits what it *would* have refused and lets the request through;
 * that is the whole point of the mode, and it is why every decision funnels
 * here rather than each route deciding for itself.
 */
function decide(
  request: FastifyRequest | null,
  context: AuthContext,
  allowed: boolean,
  event: {
    resource: string | null;
    resourceKind: 'library' | 'backend' | 'everything' | 'route';
    mode: string;
    matchedGrant?: string | null;
    message: string;
    statusCode?: number;
  }
): void {
  if (allowed) {
    auditDecision(request, context, {
      decision: 'allow',
      resource: event.resource,
      resourceKind: event.resourceKind,
      mode: event.mode,
      matchedGrant: event.matchedGrant,
    });
    return;
  }

  const enforcing = context.mode === 'required';
  auditDecision(request, context, {
    decision: enforcing ? 'deny' : 'would-deny',
    resource: event.resource,
    resourceKind: event.resourceKind,
    mode: event.mode,
    matchedGrant: null,
    detail: event.message,
  });

  if (enforcing) {
    throw new AuthorizationError(event.message, event.statusCode ?? 403);
  }
}

export function requireAuthenticated(request: FastifyRequest): AuthContext {
  const context = authOf(request);
  if (context.fullAccess) return context;
  // Reaching a handler at all means the plugin already validated a token in
  // `required` mode; this exists for routes that want the context explicitly.
  return context;
}

export function requireAdmin(request: FastifyRequest, what = 'this operation'): AuthContext {
  const context = authOf(request);
  const allowed = context.fullAccess || context.grants.admin;
  decide(request, context, allowed, {
    resource: null,
    resourceKind: 'everything',
    mode: 'admin',
    matchedGrant: allowed ? 'implicit:admin' : null,
    message: `Administrator access is required for ${what}.`,
  });
  return context;
}

export function isAdmin(request: FastifyRequest): boolean {
  const context = authOf(request);
  return context.fullAccess || context.grants.admin;
}

/** Non-throwing check, for list filtering and conditional responses. */
export function canLibrary(
  request: FastifyRequest,
  libraryIri: string | null | undefined,
  mode: LibraryMode
): boolean {
  const context = authOf(request);
  if (context.fullAccess) return true;
  return hasLibraryMode(context.grants, libraryIri, mode);
}

export function requireLibraryMode(
  request: FastifyRequest,
  libraryIri: string | null | undefined,
  mode: LibraryMode
): AuthContext {
  const context = authOf(request);
  const allowed = context.fullAccess || hasLibraryMode(context.grants, libraryIri, mode);
  decide(request, context, allowed, {
    resource: libraryIri ?? null,
    resourceKind: 'library',
    mode,
    matchedGrant: allowed && context.grants.admin ? 'implicit:admin' : undefined,
    message: libraryIri
      ? `Missing "${mode}" permission on library ${libraryIri}.`
      : `Missing "${mode}" permission: the target library could not be resolved.`,
  });
  return context;
}

export interface BackendCheckOptions {
  /**
   * The library owning the *saved* entity being executed. Supplying it enables
   * the curated-execution route (design §4.3 route 2). Ad-hoc paths — raw
   * `/sparql`, caller-supplied query text — must not pass it, which is what
   * confines the implied grant to curated queries.
   */
  viaLibrary?: string | null;
}

export function canBackend(
  request: FastifyRequest,
  backendIri: string | null | undefined,
  mode: BackendMode,
  options: BackendCheckOptions = {}
): boolean {
  const context = authOf(request);
  if (context.fullAccess) return true;
  if (hasBackendMode(context.grants, backendIri, mode)) return true;

  // Route 2: execute-on-library implies use-of-its-allowed-backends, for that
  // library's own saved entities only, and never for writes.
  if (mode !== 'use' || !options.viaLibrary || !backendIri) return false;
  if (!hasLibraryMode(context.grants, options.viaLibrary, 'execute')) return false;
  return allowedBackendsOf(options.viaLibrary).includes(backendIri);
}

export function requireBackendMode(
  request: FastifyRequest | null,
  backendIri: string | null | undefined,
  mode: BackendMode,
  options: BackendCheckOptions = {}
): AuthContext {
  const context = authOf(request);
  let allowed = context.fullAccess || hasBackendMode(context.grants, backendIri, mode);
  let via: string | null = null;

  if (!allowed && mode === 'use' && options.viaLibrary && backendIri) {
    if (
      hasLibraryMode(context.grants, options.viaLibrary, 'execute') &&
      allowedBackendsOf(options.viaLibrary).includes(backendIri)
    ) {
      allowed = true;
      via = options.viaLibrary;
    }
  }

  decide(request, context, allowed, {
    resource: backendIri ?? null,
    resourceKind: 'backend',
    mode,
    matchedGrant: via ? `implicit:library:${via}` : undefined,
    message: backendIri
      ? `Missing "${mode}" permission on backend ${backendIri}.`
      : `Missing "${mode}" permission: no backend resolved for this request.`,
  });
  return context;
}

/**
 * The backends a library permits its own saved queries to run against.
 * `defaultBackend` is always included: a library whose users cannot reach its
 * own default backend would be broken by construction.
 */
export function allowedBackendsOf(libraryIri: string): string[] {
  const library = getCacheCoordinator().get(libraryIri) as
    | { allowedBackends?: string[] | null; defaultBackend?: string | null }
    | null;
  if (!library) return [];

  const allowed = new Set<string>();
  if (Array.isArray(library.allowedBackends)) {
    for (const backend of library.allowedBackends) {
      if (typeof backend === 'string' && backend) allowed.add(backend);
    }
  }
  if (typeof library.defaultBackend === 'string' && library.defaultBackend) {
    allowed.add(library.defaultBackend);
  }
  return [...allowed];
}

/**
 * Resolves the library that owns an entity, following one query-group hop.
 *
 * `Query.isPartOf` is an array that may name query groups as well as a library
 * (QuerySchema.ts), so a query reached through a group still resolves to the
 * group's library.
 */
export function resolveOwningLibrary(entity: unknown, depth = 0): string | null {
  if (!entity || typeof entity !== 'object' || depth > 4) return null;

  const record = entity as {
    '@type'?: unknown;
    $id?: unknown;
    isPartOf?: unknown;
    targetEntity?: unknown;
  };
  if (record['@type'] === 'Library' && typeof record.$id === 'string') {
    return record.$id;
  }

  // `isPartOf` is the containment link; `targetEntity` is how an argument set
  // reaches the query or group it belongs to. Both lead to a library.
  const raw = record.isPartOf ?? record.targetEntity;
  const parents = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  if (parents.length === 0) return null;

  const cache = getCacheCoordinator();
  const unresolved: string[] = [];

  for (const parent of parents) {
    if (typeof parent !== 'string' || !parent) continue;
    const parentEntity = cache.get(parent) as { '@type'?: unknown } | null;
    if (parentEntity?.['@type'] === 'Library') return parent;
    if (parentEntity) unresolved.push(parent);
  }

  // No direct library parent: follow groups (or anything else referenced) one
  // level up. Depth-bounded so a cyclic isPartOf cannot spin.
  for (const parent of unresolved) {
    const resolved = resolveOwningLibrary(cache.get(parent), depth + 1);
    if (resolved) return resolved;
  }

  return null;
}

/** Convenience: resolve an entity's library and require a mode on it. */
export function requireEntityMode(
  request: FastifyRequest,
  entity: unknown,
  mode: LibraryMode
): AuthContext {
  return requireLibraryMode(request, resolveOwningLibrary(entity), mode);
}

export function canReadEntity(request: FastifyRequest, entity: unknown): boolean {
  const context = authOf(request);
  if (context.fullAccess) return true;
  return hasLibraryMode(context.grants, resolveOwningLibrary(entity), 'read');
}

/** Filters a list to the entities whose owning library the caller may read. */
export function filterReadable<T>(request: FastifyRequest, items: T[]): T[] {
  const context = authOf(request);
  if (context.fullAccess || context.grants.admin) return items;
  if (context.mode !== 'required') return items;
  return items.filter(item => canReadEntity(request, item));
}

/** Library creation policy (`SQLIB_AUTH_ALLOW_LIBRARY_CREATE`). */
export function requireLibraryCreate(request: FastifyRequest): AuthContext {
  const context = authOf(request);
  if (context.fullAccess) return context;
  if (getAuthConfig().allowLibraryCreate === 'admin') {
    return requireAdmin(request, 'creating libraries');
  }
  return context;
}

/**
 * Escalation guard for `Library.allowedBackends` (design §4.3).
 *
 * Extending the list hands curated-execution reach to everyone holding Execute
 * on the library, so it requires Control on the library *and* an explicit Use
 * grant on each backend being added — you may only share reach you hold
 * yourself. Removal needs Control alone.
 */
export function requireAllowedBackendsChange(
  request: FastifyRequest,
  libraryIri: string,
  previous: readonly string[] | null | undefined,
  next: readonly string[] | null | undefined
): void {
  const context = authOf(request);
  if (context.fullAccess || context.grants.admin) return;

  const before = new Set(previous ?? []);
  const added = (next ?? []).filter(backend => !before.has(backend));
  const removed = [...before].filter(backend => !(next ?? []).includes(backend));

  if (added.length === 0 && removed.length === 0) return;

  requireLibraryMode(request, libraryIri, 'control');

  for (const backend of added) {
    const allowed = hasBackendMode(context.grants, backend, 'use');
    decide(request, context, allowed, {
      resource: backend,
      resourceKind: 'backend',
      mode: 'use',
      message:
        `Cannot add backend ${backend} to library ${libraryIri}: ` +
        'you may only share backend access you hold yourself.',
    });
  }
}
