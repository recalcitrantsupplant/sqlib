/**
 * `POST /argument-sets` — creating a set with no callable to derive from.
 *
 * Creation used to live only under a callable, which derived the library from
 * the target. A set composed on the rail names its library instead; these go
 * through `app.inject` because the schema is half the contract — `scope` and
 * `targetId` became nullable, and a response schema that still required them
 * would empty or reject exactly the rows the rail lists.
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

describe('POST /argument-sets', () => {
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

  const create = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/argument-sets', payload });

  it('creates a set from a library and no provenance', async () => {
    const response = await create({
      name: 'Composed',
      libraryId: LIBRARY,
      tupleBindings: [{
        variables: ['city'],
        rows: [{ values: { city: { type: 'literal', value: 'Perth' } } }],
      }],
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe('Composed');
    expect(body.libraryId).toBe(LIBRARY);
    // Nullable, and the response schema has to carry them through as null
    // rather than dropping the keys or rejecting the row.
    expect(body.scope).toBeNull();
    expect(body.targetId).toBeNull();
    expect(body.tupleBindings[0].rows[0].values.city.value).toBe('Perth');
  });

  it('scopes the write by the library on the body', async () => {
    await create({ name: 'Composed', libraryId: LIBRARY });
    expect(libraryModeCalls).toContainEqual({ libraryId: LIBRARY, mode: 'write' });
  });

  /* A set may fill only numbers, or only graph ports — plan D4. */
  it('accepts a set with no table bindings', async () => {
    const response = await create({
      name: 'Numbers only',
      libraryId: LIBRARY,
      scalarBindings: [{ parameterKind: 'limit', parameterName: 'pageSize', numericValue: 20 }],
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().tupleBindings).toEqual([]);
    expect(response.json().scalarBindings[0].parameterName).toBe('pageSize');
  });

  it('keeps provenance that agrees with the library', async () => {
    const response = await create({
      name: 'With provenance', libraryId: LIBRARY, scope: 'queryGroup', targetId: GROUP,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().scope).toBe('queryGroup');
    expect(response.json().targetId).toBe(GROUP);
  });

  it('refuses a target from another library rather than letting the two disagree', async () => {
    const response = await create({
      name: 'Disagreeing', libraryId: LIBRARY, scope: 'queryGroup', targetId: FOREIGN_GROUP,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/library/i);
  });

  it('refuses an unknown library', async () => {
    const response = await create({ name: 'Nowhere', libraryId: 'urn:sqlib:library:missing' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/not found/i);
  });

  it('refuses a graph binding naming both a version and inline content', async () => {
    store.set('urn:sqlib:data-graph-version:v1', {
      $id: 'urn:sqlib:data-graph-version:v1',
      '@type': 'DataGraphVersion',
      contentString: '<http://ex/a> <http://ex/p> <http://ex/b> .',
      contentFormat: 'text/turtle',
    });
    const response = await create({
      name: 'Both',
      libraryId: LIBRARY,
      graphBindings: [{
        dataGraphVersionId: 'urn:sqlib:data-graph-version:v1',
        contentString: '<http://ex/a> <http://ex/p> <http://ex/b> .',
      }],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/not both/i);
  });

  it('rejects an unknown property rather than dropping it silently', async () => {
    const response = await create({ name: 'Typo', libraryId: LIBRARY, tuppleBindings: [] });
    expect(response.statusCode).toBe(400);
  });
});
