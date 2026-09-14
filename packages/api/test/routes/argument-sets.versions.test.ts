/**
 * `PATCH` on an argument set version, now that versions are frozen on create
 * and the `immutable` flag itself is gone (issue #210).
 *
 * Argument sets were the last version family left out of issue #192: they were
 * created mutable, frozen by a separate call, and refused at execution time
 * until someone made that call. `immutable` survived that as a stored flag
 * with exactly one reachable value, plus a `POST .../freeze` route that could
 * only ever no-op — both are gone now. A version's content never changing is
 * an invariant of the type, not a per-row boolean; the PATCH route has no
 * annotation field left to accept, so any body beyond an empty one is refused.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const store = new Map<string, Record<string, unknown>>();

const hoisted = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({}),
  getCacheCoordinator: () => ({
    get: (iri: string) => store.get(iri) ?? null,
    list: (type: string) => [...store.values()].filter(entity => entity['@type'] === type),
    create: async (type: string, entity: Record<string, unknown>) => {
      const id = String(entity.$id ?? entity.id);
      store.set(id, { ...entity, $id: id, '@type': type });
      return store.get(id);
    },
    update: async (type: string, id: string, updates: Record<string, unknown>) => {
      hoisted.update(type, id, updates);
      const current = store.get(id);
      if (!current) return null;
      const next = { ...current, ...updates };
      store.set(id, next);
      return next;
    },
    delete: async (_type: string, id: string) => {
      store.delete(id);
    },
  }),
}));

vi.mock('../../src/auth/enforce.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../src/auth/enforce.js');
  return { ...actual, resolveOwningLibrary: () => 'urn:sqlib:library:lib1', requireLibraryMode: () => {} };
});

const SET_ID = 'urn:sqlib:argument-set:set1';
const VERSION_ID = 'urn:sqlib:argument-set-version:v1';

/** A version as the store now writes one: frozen from the moment it exists. */
function seedFrozenVersion() {
  store.clear();
  store.set(SET_ID, {
    $id: SET_ID,
    '@type': 'ArgumentSet',
    name: 'cities',
    argumentScope: 'query',
    targetEntity: 'urn:sqlib:query:q1',
    currentVersion: VERSION_ID,
  });
  store.set(VERSION_ID, {
    $id: VERSION_ID,
    '@type': 'ArgumentSetVersion',
    isPartOf: SET_ID,
    version: 1,
    tupleBindings: [],
    scalarBindings: [],
  });
}

describe('argument set version writes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const argumentSetRoutes = (await import('../../src/routes/argument-sets.js')).default;
    app = Fastify({ logger: false });
    setupValidator(app);
    app.setErrorHandler((error, _request, reply) => {
      reply.status(error.statusCode || 500).send({ error: error.message });
    });
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(argumentSetRoutes, { prefix: '/argument-sets' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    seedFrozenVersion();
  });

  it('refuses a content PATCH, naming the fields it refused', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/argument-sets/${encodeURIComponent(SET_ID)}/v/1`,
      payload: { tupleBindings: [{ variables: ['city'], rows: [] }] },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().fields).toEqual(['tupleBindings']);
    expect(hoisted.update).not.toHaveBeenCalled();
  });

  it('accepts an empty PATCH and returns the version unchanged', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/argument-sets/${encodeURIComponent(SET_ID)}/v/1`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('immutable');
    expect(hoisted.update).not.toHaveBeenCalled();
  });

  it('rejects `immutable` in a PATCH body: the flag no longer exists (#210)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/argument-sets/${encodeURIComponent(SET_ID)}/v/1`,
      payload: { immutable: true },
    });

    expect(res.statusCode).toBe(400);
    expect(hoisted.update).not.toHaveBeenCalled();
  });

  it('there is no freeze route any more', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/argument-sets/${encodeURIComponent(SET_ID)}/v/1/freeze`,
    });

    expect(res.statusCode).toBe(404);
  });
});
