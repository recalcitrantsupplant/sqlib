/**
 * `PUT /argument-sets/:id` — renaming a set without writing a version.
 *
 * A name is entity metadata, not content: nothing that pins a version is
 * invalidated by it, which is why `PUT /queries/:id` and `PUT /tuple-sets/:id`
 * have always taken one. Argument sets had no such route, so the only door to
 * a new name was the save bar — whose version body carries no name and
 * silently dropped it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const store = new Map<string, Record<string, unknown>>();
const libraryModeCalls: Array<{ libraryId: string; mode: string }> = [];

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
    update: async (_type: string, id: string, updates: Record<string, unknown>) => {
      const current = store.get(id);
      if (!current) return null;
      const next = { ...current, ...updates };
      store.set(id, next);
      return next;
    },
    delete: async (_type: string, id: string) => { store.delete(id); },
  }),
}));

vi.mock('../../src/auth/enforce.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../src/auth/enforce.js');
  return {
    ...actual,
    resolveOwningLibrary: (entity: unknown) => {
      const record = entity as { '@type'?: string; $id?: string; isPartOf?: string | string[] };
      if (record?.['@type'] === 'Library') return record.$id ?? null;
      const parent = Array.isArray(record?.isPartOf) ? record.isPartOf[0] : record?.isPartOf;
      return parent ?? null;
    },
    requireLibraryMode: (_request: unknown, libraryId: string, mode: string) => {
      libraryModeCalls.push({ libraryId, mode });
    },
  };
});

const LIBRARY = 'urn:sqlib:library:lib1';
const OTHER_LIBRARY = 'urn:sqlib:library:lib2';
const GROUP = 'urn:sqlib:query-group:g1';
const FOREIGN_GROUP = 'urn:sqlib:query-group:g2';

function seed() {
  store.clear();
  libraryModeCalls.length = 0;
  store.set(LIBRARY, { $id: LIBRARY, '@type': 'Library', name: 'Lib' });
  store.set(OTHER_LIBRARY, { $id: OTHER_LIBRARY, '@type': 'Library', name: 'Other' });
  store.set(GROUP, { $id: GROUP, '@type': 'QueryGroup', name: 'G', isPartOf: LIBRARY });
  store.set(FOREIGN_GROUP, { $id: FOREIGN_GROUP, '@type': 'QueryGroup', name: 'G2', isPartOf: OTHER_LIBRARY });
}

describe('PUT /argument-sets/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const argumentSetRoutes = (await import('../../src/routes/argument-sets.js')).default;
    app = Fastify({ logger: false });
    setupValidator(app);
    app.setErrorHandler((error, _request, reply) => {
      reply.status(error.statusCode || 500).send({ error: error.message });
    });
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
    }
    await app.register(argumentSetRoutes, { prefix: '/argument-sets' });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { vi.clearAllMocks(); seed(); });

  async function createSet() {
    const response = await app.inject({
      method: 'POST',
      url: '/argument-sets',
      payload: {
        name: 'Untitled set 1',
        libraryId: LIBRARY,
        tupleBindings: [{
          variables: ['s'],
          rows: [{ values: { s: { type: 'uri', value: 'urn:x:1' } } }],
        }],
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  it('renames without creating a version', async () => {
    const created = await createSet();
    const versionsBefore = await app.inject({ method: 'GET', url: `/argument-sets/${created.id}/v` });
    expect(versionsBefore.json()).toHaveLength(1);

    const response = await app.inject({
      method: 'PUT',
      url: `/argument-sets/${created.id}`,
      payload: { name: 'City seeds' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('City seeds');

    const versionsAfter = await app.inject({ method: 'GET', url: `/argument-sets/${created.id}/v` });
    expect(versionsAfter.json()).toHaveLength(1);
  });

  it('leaves the bindings where they are', async () => {
    const created = await createSet();
    await app.inject({ method: 'PUT', url: `/argument-sets/${created.id}`, payload: { name: 'Renamed' } });

    const reread = await app.inject({ method: 'GET', url: `/argument-sets/${created.id}` });
    expect(reread.json().tupleBindings[0].rows[0].values.s.value).toBe('urn:x:1');
  });

  it('rewords the description on its own', async () => {
    const created = await createSet();
    const response = await app.inject({
      method: 'PUT',
      url: `/argument-sets/${created.id}`,
      payload: { description: 'The ones that reproduce the timeout' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('Untitled set 1');
    expect(response.json().description).toBe('The ones that reproduce the timeout');
  });

  /* Bindings are content and live on a version; this route is not a back door. */
  it('refuses a body carrying bindings', async () => {
    const created = await createSet();
    const response = await app.inject({
      method: 'PUT',
      url: `/argument-sets/${created.id}`,
      payload: { name: 'Sneaky', tupleBindings: [] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses an empty body rather than reporting a successful no-op', async () => {
    const created = await createSet();
    const response = await app.inject({ method: 'PUT', url: `/argument-sets/${created.id}`, payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it('answers 404 for a set that does not exist', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/argument-sets/urn:sqlib:argument-set:nope',
      payload: { name: 'X' },
    });
    expect(response.statusCode).toBe(404);
  });
});
