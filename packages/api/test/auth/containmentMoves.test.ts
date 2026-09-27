/**
 * Moving an entity between libraries needs write on both.
 *
 * The guard checks write on the entity in the path — the source library.
 * `isPartOf` in a PUT body names the destination, which the guard never sees;
 * without a check of its own an author could move their query into a library
 * they hold nothing on. `requireContainmentWritable` is that check, called
 * from every PUT that accepts `isPartOf`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext, LibraryMode } from '../../src/auth/types.js';
import { AuthorizationError, requireContainmentWritable } from '../../src/auth/enforce.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const MINE = 'urn:sqlib:library:hydrology';
const ALSO_MINE = 'urn:sqlib:library:limnology';
const THEIRS = 'urn:sqlib:library:payroll';
const QUERY = 'urn:sqlib:query:flow';
const MY_GROUP = 'urn:sqlib:group:flows';

const store = vi.hoisted(() => ({ entities: new Map<string, Record<string, unknown>>() }));

overrideCacheCoordinatorProvider((() => {
  const repo = (type: string) => ({
    get: (id: string) => {
      const entity = store.entities.get(id);
      return entity && entity['@type'] === type ? entity : null;
    },
    list: () => [...store.entities.values()].filter(entity => entity['@type'] === type),
    update: async (id: string, patch: Record<string, unknown>) => {
      const next = { ...store.entities.get(id), ...patch, dateModified: new Date().toISOString() };
      store.entities.set(id, next);
      return next;
    },
  });
  return {
    getCacheCoordinator: () => ({ get: (id: string) => store.entities.get(id) ?? null }),
    getEntityRepositories: () => ({ Query: repo('Query'), QueryVersion: repo('QueryVersion'), Library: repo('Library') }),
  };
})());

function contextFor(libraries: Array<[string, LibraryMode[]]>): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map(),
      libraries: new Map(libraries.map(([library, modes]) => [library, new Set(modes)])),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

const writesBoth = contextFor([[MINE, ['read', 'write']], [ALSO_MINE, ['read', 'write']]]);
const writesMine = contextFor([[MINE, ['read', 'write']], [THEIRS, ['read']]]);

const requestAs = (context: AuthContext) => ({
  id: 'req-1', method: 'PUT', url: '/x',
  log: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
  authContext: context,
}) as unknown as FastifyRequest;

beforeEach(() => {
  store.entities.clear();
  for (const library of [MINE, ALSO_MINE, THEIRS]) store.entities.set(library, { '@type': 'Library', $id: library });
  store.entities.set(MY_GROUP, { '@type': 'QueryGroup', $id: MY_GROUP, isPartOf: MINE });
  store.entities.set(QUERY, {
    '@type': 'Query', $id: QUERY, name: 'Flow', isPartOf: [MINE], dateModified: '2026-01-01T00:00:00.000Z',
  });
});

describe('requireContainmentWritable', () => {
  const current = () => store.entities.get(QUERY);

  it('asks nothing when the body leaves isPartOf alone, or keeps the library', () => {
    expect(() => requireContainmentWritable(requestAs(writesMine), current(), { name: 'x' } as never)).not.toThrow();
    // A group in the same library is not a move between libraries.
    expect(() => requireContainmentWritable(requestAs(writesMine), current(), { isPartOf: [MINE, MY_GROUP] }))
      .not.toThrow();
  });

  it('refuses a destination the caller may only read', () => {
    expect(() => requireContainmentWritable(requestAs(writesMine), current(), { isPartOf: [THEIRS] }))
      .toThrow(AuthorizationError);
  });

  it('allows a destination the caller may write', () => {
    expect(() => requireContainmentWritable(requestAs(writesBoth), current(), { isPartOf: [ALSO_MINE] }))
      .not.toThrow();
  });
});

describe('PUT /queries/:id', () => {
  async function put(context: AuthContext, payload: object) {
    const app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
    }
    app.setErrorHandler((error, _request, reply) => {
      reply.status((error as { statusCode?: number }).statusCode ?? 500).send({ error: error.message });
    });
    app.decorateRequest('authContext', undefined);
    app.addHook('onRequest', async request => {
      request.authContext = context;
    });
    const { default: queryRoutes } = await import('../../src/routes/queries.js');
    await app.register(queryRoutes, { prefix: '/queries' });
    await app.ready();
    const response = await app.inject({ method: 'PUT', url: `/queries/${encodeURIComponent(QUERY)}`, payload });
    await app.close();
    return response;
  }

  it('refuses a move into a library the caller cannot write, and leaves the query where it was', async () => {
    const response = await put(writesMine, { isPartOf: [THEIRS] });

    expect(response.statusCode, response.payload).toBe(403);
    expect(store.entities.get(QUERY)?.isPartOf).toEqual([MINE]);
  });

  it('moves it when the caller writes both', async () => {
    const response = await put(writesBoth, { isPartOf: [ALSO_MINE] });

    expect(response.statusCode, response.payload).toBe(200);
    expect(store.entities.get(QUERY)?.isPartOf).toEqual([ALSO_MINE]);
  });
});
