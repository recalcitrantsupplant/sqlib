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
 *
 * `enforceInEveryMode` is the one exception, and it is narrow on purpose: see
 * `requireAuthGraphDecision`.
 */
function decide(
  request: FastifyRequest | null,
  context: AuthContext,
  allowed: boolean,
  event: {
    resource: string | null;
    resourceKind: 'library' | 'backend' | 'everything' | 'route' | 'session';
    mode: string;
    matchedGrant?: string | null;
    message: string;
    statusCode?: number;
    /**
     * Refuse in `dry-run` too. The audit row is then a real `deny` rather than
     * a `would-deny`, while `authMode` still records the mode it happened in —
     * so the log says both what was refused and that the deployment was not
     * otherwise enforcing.
     */
    enforceInEveryMode?: boolean;
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

  const enforcing = context.mode === 'required' || event.enforceInEveryMode === true;
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

/**
 * A resource that no grant can name, checked against the principal that made
 * it. Assistant sessions are the whole of this today.
 *
 * Every other helper here resolves a *library* or a *backend* and asks what the
 * caller holds on it. A chat session is neither: it lives in process memory, it
 * is explicitly not a library artifact, and no grant in the vocabulary can
 * mention one. So the only honest question about it is who opened it, and this
 * is the one place that asks.
 *
 * **An administrator is not an owner.** `grants.admin` is deliberately absent
 * from the decision: an admin grant is over the deployment's entities, and a
 * half-written prompt is not one of those. `fullAccess` *is* honoured, because
 * that is `disabled` mode — a single-tenant server where every caller is the
 * same anonymous subject, and where sessions have always been shared.
 *
 * The refusal is a 404 rather than a 403 for the reason the id is a uuid: the
 * id is the only thing standing between a session and a stranger, so an answer
 * that distinguishes "not yours" from "not there" would hand out the one bit
 * the id is keeping. It reads as the route's own "Session not found".
 */
export function requireOwner(
  request: FastifyRequest,
  owner: string | null | undefined,
  options: { resource: string; message: string; statusCode?: number }
): AuthContext {
  const context = authOf(request);
  const allowed = context.fullAccess || (!!owner && owner === context.subject);
  decide(request, context, allowed, {
    resource: options.resource,
    resourceKind: 'session',
    mode: 'owner',
    matchedGrant: allowed ? 'implicit:owner' : null,
    message: options.message,
    statusCode: options.statusCode ?? 404,
  });
  return context;
}

/**
 * Whether a full-access context is the deployment's answer or the absence of
 * one.
 *
 * `createFullAccessContext` produces both, and they mean opposite things.
 * In `disabled` mode it is the answer: there is one anonymous subject and
 * everything is open by configuration. On a `dry-run` request carrying no
 * token it is a stand-in for a caller nobody identified — the plugin builds it
 * so an unconverted client keeps working while the audit trail fills up.
 *
 * Most enforcement may treat the two alike, because everything `dry-run`
 * concedes it concedes only until the operator flips to `required`. Anything
 * writing the state that `required` will then *consult* may not: see
 * `requireAuthGraphDecision`.
 */
export function isOpenDeployment(context: AuthContext): boolean {
  return context.fullAccess && context.mode === 'disabled';
}

/**
 * A decision about the auth graph itself — who holds what, and who may change
 * it — recorded like every other and refused in every mode.
 *
 * Two things make these routes unlike the entity routes around them.
 *
 * **`dry-run` does not apply to them.** The mode exists so an operator can see
 * what enforcement would refuse without refusing it, which is safe precisely
 * because everything it concedes ends at the switch. A grant does not end at
 * the switch: it is the state the switch consults. A deployment that ran
 * `dry-run` to find out what would break, and had a grant written during the
 * window, does not close the door by flipping to `required` — it enforces the
 * door someone else fitted.
 *
 * **`fullAccess` is not authority here**, for the same reason and via
 * `isOpenDeployment`. Note that `grants.admin` is `true` on *every*
 * full-access context (`EMPTY_GRANTS`), so a caller computing standing for one
 * of these decisions must ask which kind of full access it has rather than ask
 * its grants.
 *
 * Callers pass the standing they computed; this ORs in the open-deployment
 * case, audits the outcome, and throws on refusal.
 */
export function requireAuthGraphDecision(
  request: FastifyRequest,
  allowed: boolean,
  event: {
    resource: string | null;
    resourceKind: 'library' | 'backend' | 'everything';
    mode: string;
    message: string;
  }
): AuthContext {
  const context = authOf(request);
  const permitted = allowed || isOpenDeployment(context);

  decide(request, context, permitted, {
    resource: event.resource,
    resourceKind: event.resourceKind,
    mode: event.mode,
    message: event.message,
    enforceInEveryMode: true,
  });
  return context;
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

/** The two fields of a library that decide which backends its Execute reaches. */
export interface CuratedBackendFields {
  allowedBackends?: string[] | null;
  defaultBackend?: string | null;
}

/**
 * The backends a library permits its own saved queries to run against, read off
 * a library record rather than out of the cache.
 *
 * Split from `allowedBackendsOf` so the escalation guard below compares exactly
 * the set that grants the reach. It compared `allowedBackends` alone while this
 * granted `allowedBackends` ∪ `defaultBackend`, and that gap was a door.
 */
export function curatedBackendsOf(library: CuratedBackendFields | null | undefined): string[] {
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
 * The backends a library permits its own saved queries to run against.
 * `defaultBackend` is always included: a library whose users cannot reach its
 * own default backend would be broken by construction.
 */
export function allowedBackendsOf(libraryIri: string): string[] {
  return curatedBackendsOf(
    getCacheCoordinator().get(libraryIri) as CuratedBackendFields | null
  );
}

/**
 * The properties an entity names its container with, in precedence order.
 *
 * `isPartOf` is the containment link nearly everything uses. The other two are
 * entity families that reach their parent under a name of their own:
 *
 * - `targetEntity` is how an argument set reaches the query or group it
 *   belongs to.
 * - `etlJobVersion` is how `EtlExecution` and `EtlColumnMapping` reach the ETL
 *   job version they are a run of, and a mapping for, respectively. Neither
 *   has an `isPartOf`, so before this was here both resolved to no library at
 *   all — and "no library" is where the entity guard *abstains*, so
 *   `GET /etl-jobs/executions/:executionId`, its `/output`, and
 *   `GET /etl-jobs/column-mappings/versions/:versionId` were reachable by any
 *   authenticated principal, a read-only grant on an unrelated library
 *   included. Found while building the run log (issue #211) and fixed here
 *   rather than in the three handlers, because the property the guard needs is
 *   "this entity has an owner", which is a fact about the entity.
 *
 * Kept in one place because `danglingContainer` in `entityGuard.ts` must agree
 * with it exactly: that helper is what turns "names a container that is gone"
 * into a denial, and a key listed here but not there would be a container the
 * guard abstains on the moment it dangles.
 */
export function containerRefsOf(entity: unknown): string[] {
  if (!entity || typeof entity !== 'object') return [];
  const record = entity as {
    isPartOf?: unknown;
    targetEntity?: unknown;
    etlJobVersion?: unknown;
  };

  const raw = record.isPartOf ?? record.targetEntity ?? record.etlJobVersion;
  const refs = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
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
  };
  if (record['@type'] === 'Library' && typeof record.$id === 'string') {
    return record.$id;
  }

  const parents = containerRefsOf(entity);
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
 * Escalation guard for a library's curated backends (design §4.3).
 *
 * Extending the set hands curated-execution reach to everyone holding Execute
 * on the library, so it requires Control on the library *and* an explicit Use
 * grant on each backend being added — you may only share reach you hold
 * yourself. Removal needs Control alone.
 *
 * The set is `allowedBackends` ∪ `defaultBackend`, because that is what
 * `curatedBackendsOf` hands to `canBackend`. The guard used to read
 * `allowedBackends` alone, so naming a backend as a library's *default* was the
 * same escalation through a field nobody was watching.
 *
 * `previous` is null when the library is being created. There is no library to
 * hold Control on yet and the creator is granted every mode on what it makes,
 * so that half is satisfied by construction; the Use half is not, and is the
 * half this call is for.
 */
export function requireCuratedBackendsChange(
  request: FastifyRequest,
  libraryIri: string,
  previous: CuratedBackendFields | null,
  next: CuratedBackendFields
): void {
  const context = authOf(request);
  if (context.fullAccess || context.grants.admin) return;

  const before = new Set(curatedBackendsOf(previous));
  const after = curatedBackendsOf(next);
  const added = after.filter(backend => !before.has(backend));
  const removed = [...before].filter(backend => !after.includes(backend));

  if (added.length === 0 && removed.length === 0) return;

  if (previous !== null) {
    requireLibraryMode(request, libraryIri, 'control');
  }

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
