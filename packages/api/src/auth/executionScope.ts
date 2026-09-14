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
import type { BackendMode } from './types.js';

export interface ExecutionAuthScope {
  /** The request whose caller this execution runs for. Drives audit output. */
  request: FastifyRequest;
  /**
   * The library owning the *saved* entity being executed, enabling curated
   * execution against that library's `allowedBackends` (design §4.3 route 2).
   * Left unset for ad-hoc query text, which must rely on an explicit grant.
   */
  viaLibrary?: string | null;
  /** Updates need `write` on the backend; reads need `use`. */
  mode?: BackendMode;
}

/**
 * Throws unless the scope's caller may reach this backend.
 *
 * An absent scope means sqlib is acting as itself — entity persistence, system
 * queries, the auth graph — and no caller grant applies.
 */
export function assertBackendAccess(
  scope: ExecutionAuthScope | undefined,
  backendId: string
): void {
  if (!scope) return;

  const context = authOf(scope.request);
  if (context.fullAccess || context.grants.admin) return;

  // The library storage backend holds the auth graph and every entity: reading
  // it directly would bypass the entity layer entirely.
  if (backendId === LIBRARY_STORAGE_BACKEND_ID) {
    throw new AuthorizationError('The library storage backend is reserved for administrators.');
  }

  requireBackendMode(scope.request, backendId, scope.mode ?? 'use', {
    viaLibrary: scope.viaLibrary,
  });
}
