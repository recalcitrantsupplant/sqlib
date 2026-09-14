/**
 * Grant propagation through execution (design §7.2).
 *
 * The invariant under test: every executor — including each query-group leg —
 * is acquired through a factory carrying the caller's grants, so a group can
 * never read what the caller could not read directly. That is the confused-deputy
 * hole, and it has to be closed by construction rather than by convention.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import { AuthStore, inMemoryPersistence } from '../../src/auth/AuthStore.js';
import { resolveEffectiveGrants } from '../../src/auth/grants.js';
import { assertBackendAccess } from '../../src/auth/executionScope.js';
import { AuthorizationError } from '../../src/auth/enforce.js';
import type { AuthContext } from '../../src/auth/types.js';

const ALICE = 'urn:sqlib:principal:user:alice';
const LIBRARY = 'urn:sqlib:library:hydrology';
const BACKEND_A = 'urn:sqlib:backend:a';
const BACKEND_B = 'urn:sqlib:backend:b';

const entities = new Map<string, unknown>();

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => entities.get(id) ?? null }),
  getEntityRepositories: () => ({}),
}));

let store: AuthStore;

function requestFor(context: AuthContext): FastifyRequest {
  return {
    id: 'req-1',
    method: 'POST',
    url: '/execute',
    log: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
    authContext: context,
  } as unknown as FastifyRequest;
}

function contextFor(principals: string[]): AuthContext {
  return {
    subject: principals[0],
    principals,
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: resolveEffectiveGrants(principals, store),
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

beforeEach(async () => {
  store = new AuthStore(inMemoryPersistence());
  await store.load();
  entities.clear();
  entities.set(LIBRARY, {
    '@type': 'Library',
    $id: LIBRARY,
    defaultBackend: BACKEND_A,
    allowedBackends: [BACKEND_A],
  });
});

describe('assertBackendAccess', () => {
  it('does nothing without a scope — sqlib acting as itself', () => {
    // Entity persistence, system queries and the auth graph run under the
    // server's own identity; no caller grant applies to them.
    expect(() => assertBackendAccess(undefined, BACKEND_A)).not.toThrow();
    expect(() => assertBackendAccess(undefined, LIBRARY_STORAGE_BACKEND_ID)).not.toThrow();
  });

  it('allows a backend the caller holds Use on', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'backend', resource: BACKEND_A, modes: ['use'],
    });
    const scope = { request: requestFor(contextFor([ALICE])) };

    expect(() => assertBackendAccess(scope, BACKEND_A)).not.toThrow();
  });

  it('refuses a backend the caller holds nothing on', () => {
    const scope = { request: requestFor(contextFor([ALICE])) };
    expect(() => assertBackendAccess(scope, BACKEND_A)).toThrow(AuthorizationError);
  });

  it('refuses the library storage backend to a non-admin, grant or not', async () => {
    // It holds the auth graph itself; reaching it as a raw target would make
    // the grant system readable and writable from the outside.
    await store.createGrant({
      principal: ALICE, resourceKind: 'backend', resource: LIBRARY_STORAGE_BACKEND_ID, modes: ['use'],
    });
    const scope = { request: requestFor(contextFor([ALICE])) };

    expect(() => assertBackendAccess(scope, LIBRARY_STORAGE_BACKEND_ID))
      .toThrow(/reserved for administrators/);
  });

  it('allows an admin through the library storage backend', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'everything', resource: 'x', modes: ['control'],
    });
    const scope = { request: requestFor(contextFor([ALICE])) };

    expect(() => assertBackendAccess(scope, LIBRARY_STORAGE_BACKEND_ID)).not.toThrow();
  });

  it('allows a curated backend via the executing library', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['execute'],
    });
    const scope = { request: requestFor(contextFor([ALICE])), viaLibrary: LIBRARY };

    expect(() => assertBackendAccess(scope, BACKEND_A)).not.toThrow();
  });

  it('refuses a second leg whose backend the library does not list', async () => {
    // The confused deputy: a group leg must not reach further than its caller.
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['execute'],
    });
    const scope = { request: requestFor(contextFor([ALICE])), viaLibrary: LIBRARY };

    expect(() => assertBackendAccess(scope, BACKEND_A)).not.toThrow();
    expect(() => assertBackendAccess(scope, BACKEND_B)).toThrow(AuthorizationError);
  });

  it('applies the write mode for updates', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'backend', resource: BACKEND_A, modes: ['use'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(() => assertBackendAccess({ request }, BACKEND_A)).not.toThrow();
    expect(() => assertBackendAccess({ request, mode: 'write' }, BACKEND_A))
      .toThrow(AuthorizationError);
  });
});

describe('ExecutorFactory integration', () => {
  it('refuses to hand out an executor for a backend outside the caller grants', async () => {
    const { ExecutorFactory } = await import('../../src/lib/orchestration/ExecutorFactory.js');
    const factory = new ExecutorFactory({ request: requestFor(contextFor([ALICE])) });

    await expect(factory.getExecutorForBackendId(BACKEND_A)).rejects.toThrow(AuthorizationError);
  });

  it('checks before resolving the backend, so a denial never leaks its config', async () => {
    const { ExecutorFactory } = await import('../../src/lib/orchestration/ExecutorFactory.js');
    const factory = new ExecutorFactory({ request: requestFor(contextFor([ALICE])) });

    // BACKEND_B is not in the entity cache at all: if the check ran after
    // resolution this would surface "Backend not found" instead of a 403.
    await expect(factory.getExecutorForBackendId(BACKEND_B)).rejects.toThrow(AuthorizationError);
  });

  it('applies the same check to node execution', async () => {
    const { ExecutorFactory } = await import('../../src/lib/orchestration/ExecutorFactory.js');
    const factory = new ExecutorFactory({ request: requestFor(contextFor([ALICE])) });

    await expect(
      factory.getExecutorForNode({ id: 'node-1', backendId: BACKEND_A } as never)
    ).rejects.toThrow(AuthorizationError);
  });

  it('leaves internal callers (no scope) unaffected', async () => {
    const { ExecutorFactory } = await import('../../src/lib/orchestration/ExecutorFactory.js');
    const factory = new ExecutorFactory();

    // No grant exists, but this factory carries no caller — it fails on the
    // missing backend, not on authorization.
    await expect(factory.getExecutorForBackendId(BACKEND_A)).rejects.toThrow(/Backend not found/);
  });
});
