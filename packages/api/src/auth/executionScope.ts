/**
 * Backend access for execution paths (design §7.2).
 *
 * Kept apart from `enforce.ts` so `ExecutorFactory` can depend on it without
 * pulling in the route helpers, and so the "no scope means server identity"
 * rule is stated in exactly one place.
 */
import type { FastifyRequest } from 'fastify';
import { LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import { AuthorizationError, authOf, requireBackendMode } from './enforce.js';
import { hasAnyBackendMode } from './grants.js';
import { isAuthBackend } from './graphPolicy.js';
import type { QueryTextSource } from './types.js';

export interface ExecutionAuthScope {
  /** The request whose caller this execution runs for. Drives audit output. */
  request: FastifyRequest;
  /**
   * The library owning the *saved* entity being executed. It grants no
   * backend access: library and backend grants are separate. The engine reads
   * it to tell which library a query group belongs to.
   */
  viaLibrary?: string | null;
  /**
   * Whether the text this scope runs was saved (`saved`, the default) or
   * written by the caller (`adhoc`). It picks the level of the `query` or
   * `update` mode that each call needs (`GuardedSparqlExecutor`).
   */
  source?: QueryTextSource;
}

/**
 * sqlib acting as itself, asked for by name.
 *
 * `ExecutorFactory` takes this or an `ExecutionAuthScope` and nothing else, so
 * server identity is never the result of a forgotten argument. The callers
 * entitled to it do sqlib's own work, never a caller's:
 *
 * - `persistence/EntityStore.ts` and `auth/persistence.ts`: entity and auth
 *   graph storage;
 * - `lib/system-queries/SystemQueryRunner.ts`: the system library's queries;
 * - `TestRunner` / `BenchmarkRunner` constructed with it, which only scripts
 *   and tests do — the routes pass the request.
 */
export interface InternalExecution {
  internal: true;
}

export function isInternalExecution(scope: ExecutionAuthScope | InternalExecution): scope is InternalExecution {
  return (scope as InternalExecution).internal === true;
}

/**
 * Throws unless the scope's caller may reach this backend at all.
 *
 * This is the check made when an executor is handed out, before the operation
 * is known: any backend mode will do. Each call then checks the exact mode it
 * needs
 * (`GuardedSparqlExecutor`).
 *
 * An absent scope means sqlib is acting as itself (see `InternalExecution`) and
 * no caller grant applies.
 */
export function assertBackendAccess(
  scope: ExecutionAuthScope | undefined,
  backendId: string
): void {
  if (!scope) return;

  const context = authOf(scope.request);
  if (context.fullAccess || context.grants.admin) return;

  // The library storage backend holds every entity: reading it directly
  // would bypass the entity layer entirely.
  if (backendId === LIBRARY_STORAGE_BACKEND_ID) {
    throw new AuthorizationError('The library storage backend is reserved for administrators.');
  }
  // An auth backend holds who may read what. Its graph policies run as sqlib,
  // never as the caller, so no caller route reaches it.
  if (isAuthBackend(backendId)) {
    throw new AuthorizationError(`Backend ${backendId} is an auth backend, reserved for administrators.`);
  }

  if (hasAnyBackendMode(context.grants, backendId)) return;
  requireBackendMode(scope.request, backendId, 'query:saved');
}
