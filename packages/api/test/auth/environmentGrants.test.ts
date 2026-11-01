/**
 * Environment grants: `promote` moves an environment's pointers, `execute`
 * runs exactly the versions it points to. Neither is implied by a library
 * mode, and a library `execute` grant still runs every version.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { AuthStore, inMemoryPersistence } from '../../src/auth/AuthStore.js';
import { hasEnvironmentMode, resolveEffectiveGrants } from '../../src/auth/grants.js';
import {
  AuthorizationError,
  canEnvironment,
  creatorOf,
  requireEnvironmentMode,
  requireVersionExecute,
} from '../../src/auth/enforce.js';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const ALICE = 'urn:sqlib:principal:user:alice';
const LIBRARY = 'urn:sqlib:library:hydrology';
const PROD = 'urn:sqlib:environment:prod';
const DEV = 'urn:sqlib:environment:dev';

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: () => null }),
  getEntityRepositories: () => ({}),
});

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

function contextFor(principals: string[], fullAccess = false): AuthContext {
  return {
    subject: principals[0],
    principals,
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: resolveEffectiveGrants(principals, store),
    claims: {},
    fullAccess,
    mode: 'required',
  };
}

beforeEach(async () => {
  store = new AuthStore(inMemoryPersistence());
  await store.load();
});

describe('environment grants in the store', () => {
  it('creates, lists and deletes environment grants', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'environment', resource: PROD, modes: ['execute'] });
    expect(store.listGrants({ environment: PROD })).toHaveLength(1);
    expect(store.listGrants({ environment: DEV })).toHaveLength(0);

    await store.deleteGrantsForEnvironment(PROD);
    expect(store.listGrants({ environment: PROD })).toHaveLength(0);
  });

  it('refuses a library mode on an environment', async () => {
    await expect(
      store.createGrant({ principal: ALICE, resourceKind: 'environment', resource: PROD, modes: ['write' as never] }),
    ).rejects.toThrow();
  });

  it('round-trips through persistence', async () => {
    const persistence = inMemoryPersistence();
    const first = new AuthStore(persistence);
    await first.load();
    await first.createGrant({ principal: ALICE, resourceKind: 'environment', resource: PROD, modes: ['promote'] });
    const second = new AuthStore(persistence);
    await second.load();
    const grants = resolveEffectiveGrants([ALICE], second);
    expect(hasEnvironmentMode(grants, PROD, 'promote')).toBe(true);
  });
});

describe('hasEnvironmentMode', () => {
  it('is not implied by library control', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read', 'write', 'control'] });
    const grants = resolveEffectiveGrants([ALICE], store);
    expect(hasEnvironmentMode(grants, PROD, 'promote')).toBe(false);
    expect(hasEnvironmentMode(grants, PROD, 'execute')).toBe(false);
  });

  it('keeps promote and execute apart', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'environment', resource: PROD, modes: ['promote'] });
    const grants = resolveEffectiveGrants([ALICE], store);
    expect(hasEnvironmentMode(grants, PROD, 'promote')).toBe(true);
    expect(hasEnvironmentMode(grants, PROD, 'execute')).toBe(false);
    expect(hasEnvironmentMode(grants, DEV, 'promote')).toBe(false);
  });
});

describe('requireEnvironmentMode', () => {
  it('lets a promoter move pointers and refuses everyone else', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'environment', resource: PROD, modes: ['promote'] });
    const request = requestFor(contextFor([ALICE]));
    expect(() => requireEnvironmentMode(request, { $id: PROD, name: 'prod' }, 'promote')).not.toThrow();
    expect(() => requireEnvironmentMode(request, { $id: DEV, name: 'dev' }, 'promote')).toThrow(AuthorizationError);
    expect(canEnvironment(request, DEV, 'promote')).toBe(false);
  });

  it('lets full access through', () => {
    const request = requestFor(contextFor([ALICE], true));
    expect(canEnvironment(request, DEV, 'promote')).toBe(true);
  });
});

describe('requireVersionExecute', () => {
  it('runs any version with library execute', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read', 'execute'] });
    const request = requestFor(contextFor([ALICE]));
    expect(() => requireVersionExecute(request, LIBRARY, [])).not.toThrow();
  });

  it('runs only the versions an environment it holds execute on points to', async () => {
    await store.createGrant({ principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'] });
    await store.createGrant({ principal: ALICE, resourceKind: 'environment', resource: PROD, modes: ['execute'] });
    const request = requestFor(contextFor([ALICE]));

    // The version prod points to.
    expect(() => requireVersionExecute(request, LIBRARY, [{ $id: PROD }])).not.toThrow();
    // A version only dev points to.
    expect(() => requireVersionExecute(request, LIBRARY, [{ $id: DEV }])).toThrow(AuthorizationError);
    // A version no environment points to, such as latest.
    expect(() => requireVersionExecute(request, LIBRARY, [])).toThrow(AuthorizationError);
  });
});

describe('creatorOf', () => {
  it('records the subject, and nobody under full access', () => {
    expect(creatorOf(requestFor(contextFor([ALICE])))).toBe(ALICE);
    expect(creatorOf(requestFor(contextFor([ALICE], true)))).toBeNull();
    expect(creatorOf(null)).toBeNull();
  });
});
