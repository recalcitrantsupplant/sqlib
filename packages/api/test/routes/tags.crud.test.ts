import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import tagRoutes from '../../src/routes/tags.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const hoisted = vi.hoisted(() => ({
  tag: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  query: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  emptyRepo: () => ({
    list: vi.fn(() => []),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }),
  coordinatorGet: vi.fn(),
}));

overrideCacheCoordinatorProvider({
  getEntityRepositories: () => ({
    Tag: hoisted.tag,
    Query: hoisted.query,
    // The delete sweep walks every taggable type; the rest hold nothing here.
    QueryGroup: hoisted.emptyRepo(),
    Rule: hoisted.emptyRepo(),
    RuleSet: hoisted.emptyRepo(),
    DataBlock: hoisted.emptyRepo(),
    DataGraph: hoisted.emptyRepo(),
    Test: hoisted.emptyRepo(),
    ArgumentSet: hoisted.emptyRepo(),
    TupleSet: hoisted.emptyRepo(),
  }),
  getCacheCoordinator: () => ({
    get: hoisted.coordinatorGet,
  }),
});

const LIBRARY_ID = 'urn:sqlib:library:lib1';
const OTHER_LIBRARY_ID = 'urn:sqlib:library:lib2';
const TAG_ID = 'urn:sqlib:tag:t1';

describe('Tags Routes (/tags)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);

    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
      if (error.validation && Array.isArray(error.validation)) {
        return reply.status(statusCode).send({ error: error.validation[0]?.message ?? 'Validation failed' });
      }
      reply.status(statusCode).send({ error: error.message || 'An unexpected error occurred' });
    });

    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(tagRoutes, { prefix: '/tags' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.tag.list.mockReturnValue([]);
    hoisted.query.list.mockReturnValue([]);
    hoisted.coordinatorGet.mockImplementation((iri: string) => {
      if (iri === LIBRARY_ID) return { $id: LIBRARY_ID, '@type': 'Library', name: 'Lib' };
      if (iri === OTHER_LIBRARY_ID) return { $id: OTHER_LIBRARY_ID, '@type': 'Library', name: 'Other' };
      return null;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a tag in a library', async () => {
    hoisted.tag.create.mockImplementation(async (entity: Record<string, unknown>) => entity);

    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      payload: { name: 'geo', isPartOf: LIBRARY_ID, color: '#3b6ef5' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'geo', isPartOf: LIBRARY_ID, color: '#3b6ef5' });
    expect(res.json().id).toMatch(/^urn:sqlib:tag:/);
  });

  it('accepts a hex colour and rejects anything that is not one', async () => {
    hoisted.tag.create.mockImplementation(async (entity: Record<string, unknown>) => entity);

    const ok = await app.inject({
      method: 'POST',
      url: '/tags',
      payload: { name: 'geo', isPartOf: LIBRARY_ID, color: '#3b6ef5' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().color).toBe('#3b6ef5');

    // A palette token is exactly what the model used to store and no longer
    // does — it means nothing in an RDF export.
    for (const color of ['accent', 'tag-3', '#fff', 'rgb(1,2,3)']) {
      const res = await app.inject({
        method: 'POST',
        url: '/tags',
        payload: { name: 'geo', isPartOf: LIBRARY_ID, color },
      });
      expect(res.statusCode, color).toBe(400);
    }
  });

  it('rejects a tag whose parent is not a library', async () => {
    hoisted.coordinatorGet.mockImplementation((iri: string) =>
      iri === 'urn:sqlib:query:q1' ? { $id: 'urn:sqlib:query:q1', '@type': 'Query', name: 'Q' } : null,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      payload: { name: 'geo', isPartOf: 'urn:sqlib:query:q1' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('expected Library');
  });

  it('rejects a tag whose library does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      payload: { name: 'geo', isPartOf: 'urn:sqlib:library:nope' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('does not exist');
  });

  it('rejects a duplicate name in the same library, folding case and space', async () => {
    hoisted.tag.list.mockReturnValue([
      { $id: TAG_ID, '@type': 'Tag', name: 'Geo', isPartOf: LIBRARY_ID },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      payload: { name: '  geo  ', isPartOf: LIBRARY_ID },
    });

    expect(res.statusCode).toBe(409);
  });

  it('allows the same name in a different library', async () => {
    hoisted.tag.list.mockReturnValue([
      { $id: TAG_ID, '@type': 'Tag', name: 'geo', isPartOf: OTHER_LIBRARY_ID },
    ]);
    hoisted.tag.create.mockImplementation(async (entity: Record<string, unknown>) => entity);

    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      payload: { name: 'geo', isPartOf: LIBRARY_ID },
    });

    expect(res.statusCode).toBe(201);
  });

  it('scopes the listing to a library when asked', async () => {
    hoisted.tag.list.mockReturnValue([
      { $id: TAG_ID, '@type': 'Tag', name: 'geo', isPartOf: LIBRARY_ID },
      { $id: 'urn:sqlib:tag:t2', '@type': 'Tag', name: 'census', isPartOf: OTHER_LIBRARY_ID },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/tags?library=${encodeURIComponent(LIBRARY_ID)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0]).toMatchObject({ id: TAG_ID, name: 'geo' });
  });

  it('refuses to move a tag between libraries', async () => {
    hoisted.tag.get.mockReturnValue({
      $id: TAG_ID,
      '@type': 'Tag',
      name: 'geo',
      isPartOf: LIBRARY_ID,
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/tags/${encodeURIComponent(TAG_ID)}`,
      payload: { isPartOf: OTHER_LIBRARY_ID },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('cannot move between libraries');
  });

  it('renames a tag', async () => {
    hoisted.tag.get.mockReturnValue({
      $id: TAG_ID,
      '@type': 'Tag',
      name: 'geo',
      isPartOf: LIBRARY_ID,
    });
    hoisted.tag.update.mockImplementation(async (id: string, updates: Record<string, unknown>) => ({
      $id: id,
      '@type': 'Tag',
      isPartOf: LIBRARY_ID,
      ...updates,
    }));

    const res = await app.inject({
      method: 'PUT',
      url: `/tags/${encodeURIComponent(TAG_ID)}`,
      payload: { name: 'geography' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'geography', isPartOf: LIBRARY_ID });
  });

  it('unlabels carriers rather than cascading when a tag is deleted', async () => {
    hoisted.tag.get.mockReturnValue({
      $id: TAG_ID,
      '@type': 'Tag',
      name: 'geo',
      isPartOf: LIBRARY_ID,
    });
    hoisted.query.list.mockReturnValue([
      { $id: 'urn:sqlib:query:q1', '@type': 'Query', tags: [TAG_ID, 'urn:sqlib:tag:t2'] },
      { $id: 'urn:sqlib:query:q2', '@type': 'Query', tags: ['urn:sqlib:tag:t2'] },
    ]);

    const res = await app.inject({
      method: 'DELETE',
      url: `/tags/${encodeURIComponent(TAG_ID)}`,
    });

    expect(res.statusCode).toBe(204);
    // Only the carrier is touched, and it survives with its other tag intact.
    expect(hoisted.query.update).toHaveBeenCalledTimes(1);
    expect(hoisted.query.update).toHaveBeenCalledWith('urn:sqlib:query:q1', {
      tags: ['urn:sqlib:tag:t2'],
    });
    expect(hoisted.query.delete).not.toHaveBeenCalled();
    expect(hoisted.tag.delete).toHaveBeenCalledWith(TAG_ID);
  });

  it('404s deleting a tag that is not there', async () => {
    hoisted.tag.get.mockReturnValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: `/tags/${encodeURIComponent(TAG_ID)}`,
    });

    expect(res.statusCode).toBe(404);
    expect(hoisted.tag.delete).not.toHaveBeenCalled();
  });
});
