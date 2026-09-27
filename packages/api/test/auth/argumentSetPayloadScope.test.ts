/**
 * Argument set ids arrive in request bodies — `/execute`, `/sparql`,
 * `/substitute`, a test case — and the route's guard checks the entity being
 * run, not the sets it is handed. `exportRuntimePayload` is where every one of
 * those ids is resolved to values, so it is where Read on the set's library is
 * required: execute on one library must not read another library's argument
 * values into your own query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { AuthContext, LibraryMode } from '../../src/auth/types.js';
import { AuthorizationError } from '../../src/auth/enforce.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { ArgumentSetService } from '../../src/lib/ArgumentSetService.js';

const MINE = 'urn:sqlib:library:hydrology';
const THEIRS = 'urn:sqlib:library:payroll';
const THEIR_QUERY = 'urn:sqlib:query:salaries';

const store = new Map<string, Record<string, unknown>>();

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: (iri: string) => store.get(iri) ?? null,
    list: (type: string) => [...store.values()].filter(entity => entity['@type'] === type),
    create: async (type: string, entity: Record<string, unknown>) => {
      const id = String(entity.$id);
      store.set(id, { ...entity, '@type': type });
      return store.get(id);
    },
    update: async (_type: string, id: string, updates: Record<string, unknown>) => {
      const next = { ...store.get(id), ...updates };
      store.set(id, next);
      return next;
    },
  }),
  getEntityRepositories: () => ({}),
});

function requestFor(modes: LibraryMode[]): FastifyRequest {
  const context: AuthContext = {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: { admin: false, backends: new Map(), libraries: new Map([[MINE, new Set(modes)]]) },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
  return {
    id: 'req-1', method: 'POST', url: '/execute',
    log: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
    authContext: context,
  } as unknown as FastifyRequest;
}

const service = new ArgumentSetService();
let theirSet: string;

beforeEach(async () => {
  store.clear();
  store.set(MINE, { $id: MINE, '@type': 'Library' });
  store.set(THEIRS, { $id: THEIRS, '@type': 'Library' });
  store.set(THEIR_QUERY, { $id: THEIR_QUERY, '@type': 'Query', isPartOf: [THEIRS] });
  const rows = [{ values: { salary: { type: 'literal' as const, value: '1000000' } } }];
  const detail = await service.createForTarget('query', THEIR_QUERY, {
    name: 'salaries', tupleBindings: [{ variables: ['salary'], rows }],
  });
  await service.createVersion(detail.id, { tupleBindings: [{ variables: ['salary'], rows }] });
  theirSet = detail.id;
});

describe('exportRuntimePayload', () => {
  it('refuses a set in a library the caller cannot read, even with execute on their own', async () => {
    await expect(service.exportRuntimePayload([theirSet], { request: requestFor(['read', 'execute']) }))
      .rejects.toBeInstanceOf(AuthorizationError);
  });

  it('resolves it for sqlib itself', async () => {
    const payload = await service.exportRuntimePayload([theirSet], { internal: true });
    expect(payload.tupleList).toHaveLength(1);
  });
});
