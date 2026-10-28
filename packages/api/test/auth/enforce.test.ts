/**
 * Enforcement semantics: the three modes, library resolution, and the
 * backend-access rules that decide whether a library's Execute grant reaches a
 * backend (design §4.3/§4.4).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { AuthStore, inMemoryPersistence } from '../../src/auth/AuthStore.js';
import { resolveEffectiveGrants } from '../../src/auth/grants.js';
import {
  AuthorizationError,
  canBackend,
  filterReadable,
  requireBackendMode,
  requireLibraryMode,
  resolveOwningLibrary,
} from '../../src/auth/enforce.js';
import type { AuthContext, AuthMode } from '../../src/auth/types.js';
import { PRINCIPAL_AUTHENTICATED } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const ALICE = 'urn:sqlib:principal:user:alice';
const LIBRARY = 'urn:sqlib:library:hydrology';
const OTHER_LIBRARY = 'urn:sqlib:library:finance';
const BACKEND = 'urn:sqlib:backend:main';

const entities = new Map<string, unknown>();

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: (id: string) => entities.get(id) ?? null,
  }),
  getEntityRepositories: () => ({}),
});

let store: AuthStore;

function requestFor(context: AuthContext | null): FastifyRequest {
  return {
    id: 'req-1',
    method: 'GET',
    url: '/test',
    log: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
    ...(context ? { authContext: context } : {}),
  } as unknown as FastifyRequest;
}

function contextFor(principals: string[], mode: AuthMode = 'required'): AuthContext {
  return {
    subject: principals[0],
    principals,
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: resolveEffectiveGrants(principals, store),
    claims: {},
    fullAccess: false,
    mode,
  };
}

beforeEach(async () => {
  store = new AuthStore(inMemoryPersistence());
  await store.load();
  entities.clear();
  entities.set(LIBRARY, {
    '@type': 'Library',
    $id: LIBRARY,
    defaultBackend: BACKEND,
  });
  entities.set(OTHER_LIBRARY, { '@type': 'Library', $id: OTHER_LIBRARY });
});

describe('auth modes', () => {
  it('allows everything when no auth context is present', () => {
    // Route modules mounted standalone in unit tests never see the plugin; they
    // must behave exactly as they did before auth existed.
    expect(() => requireLibraryMode(requestFor(null), LIBRARY, 'delete')).not.toThrow();
  });

  it('denies in required mode', () => {
    expect(() => requireLibraryMode(requestFor(contextFor([ALICE])), LIBRARY, 'read'))
      .toThrow(AuthorizationError);
  });

  it('permits the request in dry-run mode but records the denial', () => {
    const request = requestFor(contextFor([ALICE], 'dry-run'));

    expect(() => requireLibraryMode(request, LIBRARY, 'read')).not.toThrow();
    expect(request.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'would-deny', resource: LIBRARY }),
      'authz decision'
    );
  });
});

describe('library modes', () => {
  it('allows a granted mode and refuses the others', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read', 'execute'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(() => requireLibraryMode(request, LIBRARY, 'read')).not.toThrow();
    expect(() => requireLibraryMode(request, LIBRARY, 'execute')).not.toThrow();
    expect(() => requireLibraryMode(request, LIBRARY, 'write')).toThrow(AuthorizationError);
    expect(() => requireLibraryMode(request, OTHER_LIBRARY, 'read')).toThrow(AuthorizationError);
  });

  it('refuses when the owning library cannot be resolved', () => {
    expect(() => requireLibraryMode(requestFor(contextFor([ALICE])), null, 'read'))
      .toThrow(/could not be resolved/);
  });
});

describe('resolveOwningLibrary', () => {
  it('resolves a direct library parent', () => {
    entities.set('urn:q:1', { '@type': 'Query', $id: 'urn:q:1', isPartOf: [LIBRARY] });
    expect(resolveOwningLibrary(entities.get('urn:q:1'))).toBe(LIBRARY);
  });

  it('follows a query-group hop when the query names only a group', () => {
    entities.set('urn:g:1', { '@type': 'QueryGroup', $id: 'urn:g:1', isPartOf: LIBRARY });
    entities.set('urn:q:2', { '@type': 'Query', $id: 'urn:q:2', isPartOf: ['urn:g:1'] });
    expect(resolveOwningLibrary(entities.get('urn:q:2'))).toBe(LIBRARY);
  });

  it('follows targetEntity for argument sets', () => {
    entities.set('urn:q:3', { '@type': 'Query', $id: 'urn:q:3', isPartOf: [LIBRARY] });
    entities.set('urn:as:1', { '@type': 'ArgumentSet', $id: 'urn:as:1', targetEntity: 'urn:q:3' });
    expect(resolveOwningLibrary(entities.get('urn:as:1'))).toBe(LIBRARY);
  });

  it('returns the library itself', () => {
    expect(resolveOwningLibrary(entities.get(LIBRARY))).toBe(LIBRARY);
  });

  it('gives up rather than looping on a cyclic isPartOf', () => {
    entities.set('urn:a', { '@type': 'Query', $id: 'urn:a', isPartOf: ['urn:b'] });
    entities.set('urn:b', { '@type': 'Query', $id: 'urn:b', isPartOf: ['urn:a'] });
    expect(resolveOwningLibrary(entities.get('urn:a'))).toBeNull();
  });
});

describe('backend access routes (design §4.3)', () => {
  it('route 1: an explicit Use grant allows any path, including ad-hoc', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'backend', resource: BACKEND, modes: ['query:adhoc'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(canBackend(request, BACKEND, 'query:adhoc')).toBe(true);
    expect(canBackend(request, BACKEND, 'update:saved')).toBe(false);
  });

  it('gives no backend access through a library, not even its defaultBackend', async () => {
    entities.set(LIBRARY, { '@type': 'Library', $id: LIBRARY, defaultBackend: BACKEND });
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read', 'execute', 'control'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(canBackend(request, BACKEND, 'query:saved')).toBe(false);
    expect(() => requireBackendMode(request, BACKEND, 'query:saved')).toThrow(AuthorizationError);
  });

  it('route 3: a grant to the authenticated sentinel makes a backend global', async () => {
    await store.createGrant({
      principal: PRINCIPAL_AUTHENTICATED, resourceKind: 'backend', resource: BACKEND, modes: ['query:adhoc'],
    });
    const request = requestFor(contextFor(['urn:sqlib:principal:user:nobody', PRINCIPAL_AUTHENTICATED]));

    expect(canBackend(request, BACKEND, 'query:adhoc')).toBe(true);
  });
});

describe('filterReadable', () => {
  it('drops entities whose library the caller cannot read', async () => {
    entities.set('urn:q:a', { '@type': 'Query', $id: 'urn:q:a', isPartOf: [LIBRARY] });
    entities.set('urn:q:b', { '@type': 'Query', $id: 'urn:q:b', isPartOf: [OTHER_LIBRARY] });
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'],
    });

    const visible = filterReadable(requestFor(contextFor([ALICE])), [
      entities.get('urn:q:a'),
      entities.get('urn:q:b'),
    ]);

    expect(visible).toHaveLength(1);
    expect((visible[0] as { $id: string }).$id).toBe('urn:q:a');
  });

  it('does not filter in dry-run mode', async () => {
    entities.set('urn:q:b', { '@type': 'Query', $id: 'urn:q:b', isPartOf: [OTHER_LIBRARY] });
    const visible = filterReadable(requestFor(contextFor([ALICE], 'dry-run')), [entities.get('urn:q:b')]);
    expect(visible).toHaveLength(1);
  });

  it('audits each item dry-run would hide, and nothing it would show', async () => {
    entities.set('urn:q:a', { '@type': 'Query', $id: 'urn:q:a', isPartOf: [LIBRARY] });
    entities.set('urn:q:b', { '@type': 'Query', $id: 'urn:q:b', isPartOf: [OTHER_LIBRARY] });
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'],
    });
    const request = requestFor(contextFor([ALICE], 'dry-run'));

    filterReadable(request, [entities.get('urn:q:a'), entities.get('urn:q:b')]);

    const wouldDeny = (request.log.warn as ReturnType<typeof vi.fn>).mock.calls
      .map(([event]) => event as { decision?: string; resource?: string; detail?: string })
      .filter(event => event.decision === 'would-deny');
    expect(wouldDeny).toHaveLength(1);
    expect(wouldDeny[0]).toMatchObject({ resource: OTHER_LIBRARY });
    expect(wouldDeny[0]!.detail).toContain('urn:q:b');
  });
});
