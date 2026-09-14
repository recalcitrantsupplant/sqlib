/**
 * Route-level enforcement for entity CRUD (design §7.1).
 *
 * Registered once per route plugin instead of hand-written into every handler.
 * That is not just brevity: a per-handler check is only as good as the next
 * handler someone adds, whereas a plugin-scoped `preHandler` covers routes that
 * do not exist yet. Handlers still add explicit checks where the rule is not
 * "the entity named in the path" — creation from a request body, execution, and
 * anything reaching a second entity.
 *
 * Resolution order for the target library:
 *   1. the `:id`-shaped path parameter → cached entity → owning library
 *   2. the request body's containment reference (creates)
 *   3. unresolved → the route is not library-scoped (§ "unowned entities")
 *
 * Step 3 has two cases that look identical from here and are not. An entity
 * that names no container at all is unowned by design — a benchmark experiment
 * has no `isPartOf` in its schema — and abstaining is the rule. An entity that
 * *names* a container which resolves to nothing is a dangling reference, and
 * abstaining there hands it to anyone: see `danglingContainer` below.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { authOf, requireAdmin, requireLibraryMode, resolveOwningLibrary } from './enforce.js';
import type { LibraryMode } from './types.js';

/** Path parameters that name the entity a route acts on. */
const ID_PARAM_NAMES = ['id', 'versionId', 'executionId', 'runId'] as const;

/** Body properties that name an entity's container on creation. */
const CONTAINER_BODY_KEYS = ['isPartOf', 'targetEntity', 'library', 'libraryId'] as const;

export interface EntityGuardOptions {
  /**
   * Routes (by path suffix) that execute rather than read or write. They need
   * Execute on the library, which is deliberately independent of Read.
   */
  executeSuffixes?: readonly string[];
  /**
   * Paths exempt from library resolution entirely — stateless helpers that
   * analyse caller-supplied input and touch no stored entity.
   */
  exemptSuffixes?: readonly string[];
  /**
   * Paths that require administrator access outright, whatever the caller's
   * library grants say.
   *
   * For the operations whose blast radius is not an entity: they touch no
   * stored entity, so library resolution has nothing to check, but what they
   * *do* is not something every authenticated principal should reach. ETL's
   * `/preview` is the case this exists for — it takes arbitrary DuckDB SQL,
   * which is a host filesystem primitive, so being exempt from resolution left
   * it open to any principal at all (issue #132).
   *
   * Checked before `exemptSuffixes`, so a path in both is admin-only.
   */
  adminSuffixes?: readonly string[];
}

function modeForRequest(
  request: FastifyRequest,
  options: EntityGuardOptions
): LibraryMode | null {
  const path = request.url.split('?')[0];

  for (const suffix of options.executeSuffixes ?? []) {
    if (path.endsWith(suffix)) return 'execute';
  }

  switch (request.method) {
    case 'GET':
    case 'HEAD':
      return 'read';
    case 'POST':
    case 'PUT':
    case 'PATCH':
      return 'write';
    case 'DELETE':
      return 'delete';
    default:
      return null;
  }
}

function targetIdFrom(request: FastifyRequest): string | null {
  const params = (request.params ?? {}) as Record<string, unknown>;
  for (const name of ID_PARAM_NAMES) {
    const value = params[name];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function containerRefsFrom(request: FastifyRequest): string[] {
  const body = request.body;
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;

  const refs: string[] = [];
  for (const key of CONTAINER_BODY_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value) refs.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item) refs.push(item);
      }
    }
  }
  return refs;
}

/**
 * True when the entity names a container and not one of the names resolves.
 *
 * `resolveOwningLibrary` answers null for two different situations, and the
 * guard treated them the same until it was asked what state produces each.
 *
 * - **Unowned by design.** `BenchmarkExperiment` has no `isPartOf` in its
 *   schema, so there is no container to look for and nothing to check. That is
 *   the case the module docblock's step 3 is about, and it still abstains.
 * - **A container that is gone.** `DELETE /libraries/:id` deletes the library
 *   entity and its grants, and nothing else: every tuple set, rule set, query
 *   and data graph it held stays in the cache with `isPartOf` naming an id
 *   that no longer resolves. Abstaining there does not leave the entity as
 *   protected as it was — it leaves it *unprotected*, reachable by any
 *   authenticated principal on every route whose handler does not re-check.
 *
 * So a dangling container is a denial. It is also what `requireEntityMode`
 * already does with the same entity — `requireLibraryMode(null, …)` refuses —
 * so the guard and the handler helper now agree rather than disagreeing by
 * accident.
 *
 * A container that resolves but is not a library (a benchmark run naming its
 * experiment; a chain too deep to follow) is deliberately *not* this case: the
 * reference is intact, so this says nothing about it and the guard abstains as
 * before.
 */
function danglingContainer(entity: unknown, cache: { get(id: string): unknown }): boolean {
  const record = entity as { isPartOf?: unknown; targetEntity?: unknown };
  // Same precedence as `resolveOwningLibrary`, which is what produced the null
  // this is explaining.
  const raw = record.isPartOf ?? record.targetEntity;
  const refs = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])
    .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);

  if (refs.length === 0) return false;
  return refs.every(ref => !cache.get(ref));
}

/**
 * Registers the guard on a route plugin. Fastify's encapsulation keeps the hook
 * scoped to routes registered on this instance, so each `register(..., {prefix})`
 * gets exactly its own coverage.
 */
export function registerEntityAuthGuard(
  fastify: FastifyInstance,
  options: EntityGuardOptions = {}
): void {
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    const context = authOf(request);
    // `disabled` mode and unauthenticated dry-run requests carry a full-access
    // context; there is nothing to resolve and nothing to deny.
    if (context.fullAccess || context.grants.admin) return;

    const path = request.url.split('?')[0];
    // Before the exempt list: an admin-only path is admin-only even when it is
    // also unresolvable, which is exactly the shape ETL's /preview has.
    for (const suffix of options.adminSuffixes ?? []) {
      if (path.endsWith(suffix)) {
        requireAdmin(request, `${path}`);
        return;
      }
    }
    for (const suffix of options.exemptSuffixes ?? []) {
      if (path.endsWith(suffix)) return;
    }

    const mode = modeForRequest(request, options);
    if (!mode) return;

    const cache = getCacheCoordinator();

    const targetId = targetIdFrom(request);
    if (targetId) {
      const entity = cache.get(targetId);
      // A miss is a 404 the handler will produce; denying here would leak
      // existence through the status code.
      if (!entity) return;
      const library = resolveOwningLibrary(entity);
      if (!library) {
        // Unowned by design — abstain. Owned by something that is gone —
        // refuse, because nobody can hold a grant on a library that is not
        // there and "no grant reaches it" must not read as "everyone may".
        if (danglingContainer(entity, cache)) requireLibraryMode(request, null, mode);
        return;
      }
      requireLibraryMode(request, library, mode);
      return;
    }

    // No path id: a create, whose container comes from the body.
    const refs = containerRefsFrom(request);
    if (refs.length === 0) return;

    for (const ref of refs) {
      const referenced = ref === undefined ? null : cache.get(ref);
      const library = referenced ? resolveOwningLibrary(referenced) : null;
      if (library) {
        requireLibraryMode(request, library, mode);
        return;
      }
    }
  });
}
