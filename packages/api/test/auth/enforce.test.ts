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
  allowedBackendsOf,
  canBackend,
  filterReadable,
  requireCuratedBackendsChange,
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
const OTHER_BACKEND = 'urn:sqlib:backend:secret';

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
    allowedBackends: [],
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
      principal: ALICE, resourceKind: 'backend', resource: BACKEND, modes: ['use'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(canBackend(request, BACKEND, 'use')).toBe(true);
    expect(canBackend(request, BACKEND, 'write')).toBe(false);
  });

  it('route 2: Execute on a library reaches its allowedBackends for saved queries', async () => {
    entities.set(LIBRARY, {
      '@type': 'Library', $id: LIBRARY, allowedBackends: [OTHER_BACKEND], defaultBackend: BACKEND,
    });
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['execute'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(canBackend(request, BACKEND, 'use', { viaLibrary: LIBRARY })).toBe(true);
    expect(canBackend(request, OTHER_BACKEND, 'use', { viaLibrary: LIBRARY })).toBe(true);
  });

  it('route 2 does not leak into ad-hoc paths that pass no library', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['execute'],
    });
    const request = requestFor(contextFor([ALICE]));

    // This is what stops /sparql from inheriting curated access.
    expect(canBackend(request, BACKEND, 'use')).toBe(false);
    expect(() => requireBackendMode(request, BACKEND, 'use')).toThrow(AuthorizationError);
  });

  it('route 2 refuses a backend the library does not list', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['execute'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(canBackend(request, OTHER_BACKEND, 'use', { viaLibrary: LIBRARY })).toBe(false);
  });

  it('route 2 requires Execute, not merely Read, on the library', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['read'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(canBackend(request, BACKEND, 'use', { viaLibrary: LIBRARY })).toBe(false);
  });

  it('route 2 never covers writes', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['execute'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(canBackend(request, BACKEND, 'write', { viaLibrary: LIBRARY })).toBe(false);
  });

  it('route 3: a grant to the authenticated sentinel makes a backend global', async () => {
    await store.createGrant({
      principal: PRINCIPAL_AUTHENTICATED, resourceKind: 'backend', resource: BACKEND, modes: ['use'],
    });
    const request = requestFor(contextFor(['urn:sqlib:principal:user:nobody', PRINCIPAL_AUTHENTICATED]));

    expect(canBackend(request, BACKEND, 'use')).toBe(true);
  });

  it('always includes defaultBackend in a library allowed set', () => {
    entities.set(LIBRARY, { '@type': 'Library', $id: LIBRARY, defaultBackend: BACKEND, allowedBackends: [OTHER_BACKEND] });
    expect(allowedBackendsOf(LIBRARY).sort()).toEqual([BACKEND, OTHER_BACKEND].sort());
  });
});

describe('curated backends escalation guard', () => {
  it('refuses without Control on the library', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['write'],
    });
    await store.createGrant({
      principal: ALICE, resourceKind: 'backend', resource: OTHER_BACKEND, modes: ['use'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(() => requireCuratedBackendsChange(request, LIBRARY, {}, { allowedBackends: [OTHER_BACKEND] }))
      .toThrow(/control/i);
  });

  it('refuses to share backend reach the caller does not hold', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['write', 'control'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(() => requireCuratedBackendsChange(request, LIBRARY, {}, { allowedBackends: [OTHER_BACKEND] }))
      .toThrow(/only share backend access you hold yourself/);
  });

  it('allows adding a backend the caller may use, with Control', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['write', 'control'],
    });
    await store.createGrant({
      principal: ALICE, resourceKind: 'backend', resource: OTHER_BACKEND, modes: ['use'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(() => requireCuratedBackendsChange(request, LIBRARY, {}, { allowedBackends: [OTHER_BACKEND] })).not.toThrow();
  });

  it('needs only Control to remove a backend', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['write', 'control'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(() => requireCuratedBackendsChange(request, LIBRARY, { allowedBackends: [OTHER_BACKEND] }, {})).not.toThrow();
  });

  it('is a no-op when the list is unchanged', () => {
    const request = requestFor(contextFor([ALICE]));
    expect(() => requireCuratedBackendsChange(request, LIBRARY, { allowedBackends: [BACKEND] }, { allowedBackends: [BACKEND] })).not.toThrow();
  });

  /*
   * `defaultBackend` is in the curated set `canBackend` reads, so naming one is
   * the same escalation as adding to `allowedBackends`. The guard compared the
   * `allowedBackends` array alone, which made the default the way around it.
   */
  it('refuses a defaultBackend the caller may not use', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['write', 'control'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(() => requireCuratedBackendsChange(request, LIBRARY, {}, { defaultBackend: OTHER_BACKEND }))
      .toThrow(/only share backend access you hold yourself/);
  });

  it('allows a defaultBackend the caller may use', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'library', resource: LIBRARY, modes: ['write', 'control'],
    });
    await store.createGrant({
      principal: ALICE, resourceKind: 'backend', resource: OTHER_BACKEND, modes: ['use'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(() => requireCuratedBackendsChange(request, LIBRARY, {}, { defaultBackend: OTHER_BACKEND }))
      .not.toThrow();
  });

  /*
   * Creating: `previous` is null, so Control is not required — there is no
   * library to hold it on, and the creator is granted every mode on what it
   * makes. The Use half still binds, which is the half that matters here.
   */
  it('checks Use but not Control when the library is being created', async () => {
    const request = requestFor(contextFor([ALICE]));

    expect(() => requireCuratedBackendsChange(request, LIBRARY, null, { allowedBackends: [OTHER_BACKEND] }))
      .toThrow(/only share backend access you hold yourself/);
  });

  it('allows creating with a backend the caller holds, without Control', async () => {
    await store.createGrant({
      principal: ALICE, resourceKind: 'backend', resource: OTHER_BACKEND, modes: ['use'],
    });
    const request = requestFor(contextFor([ALICE]));

    expect(() => requireCuratedBackendsChange(request, LIBRARY, null, { allowedBackends: [OTHER_BACKEND] }))
      .not.toThrow();
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
});
