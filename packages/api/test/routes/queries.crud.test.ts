import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import queryRoutes from '../../src/routes/queries.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const hoisted = vi.hoisted(() => ({
  query: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  queryVersion: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  library: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  coordinatorGet: vi.fn(),
}));

overrideCacheCoordinatorProvider({
  getEntityRepositories: () => ({
    Query: hoisted.query,
    QueryVersion: hoisted.queryVersion,
    Library: hoisted.library,
  }),
  getCacheCoordinator: () => ({
    get: hoisted.coordinatorGet,
  }),
});

describe('Queries Routes (/queries) - CRUD', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);

    // Add error handler to provide better validation messages
    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;

      // For validation errors, provide more specific messages
      if (error.validation && Array.isArray(error.validation)) {
        const validationErrors = error.validation.map((err: any) => {
          if (err.keyword === 'required') {
            return `${err.params?.missingProperty || 'Field'} is required`;
          }
          return err.message || 'Validation error';
        });

        const errorMessage = validationErrors.length > 0 ? validationErrors[0] : 'Validation failed';
        return reply.status(statusCode).send({ error: errorMessage });
      }

      reply.status(statusCode).send({ error: error.message || 'An unexpected error occurred' });
    });

    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(queryRoutes, { prefix: '/queries' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.query.list.mockReset();
    hoisted.query.get.mockReset();
    hoisted.query.create.mockReset();
    hoisted.query.update.mockReset();
    hoisted.query.delete.mockReset();
    hoisted.queryVersion.list.mockReset();
    hoisted.queryVersion.get.mockReset();
    hoisted.queryVersion.create.mockReset();
    hoisted.queryVersion.update.mockReset();
    hoisted.queryVersion.delete.mockReset();
    hoisted.library.list.mockReset();
    hoisted.library.get.mockReset();
    hoisted.library.create.mockReset();
    hoisted.library.update.mockReset();
    hoisted.library.delete.mockReset();
    hoisted.coordinatorGet.mockReset();
  });

  afterAll(async () => { await app.close(); });

  it('POST /queries creates stable Query', async () => {
    const libraryId = 'urn:sqlib:library:lib1';
    const library = { $id: libraryId, name: 'Test Library', '@type': 'Library' };
    const created = { $id: 'urn:sqlib:query:abc', name: 'Q', isPartOf: [libraryId] };
    
    hoisted.library.get.mockReturnValue(library);
    hoisted.coordinatorGet.mockReturnValue(library);
    hoisted.query.create.mockResolvedValue(created);
    
    const res = await app.inject({ 
      method: 'POST', 
      url: '/queries', 
      payload: { name: 'Q', isPartOf: libraryId } 
    });
    
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: created.$id, name: 'Q', isPartOf: [libraryId] });
  });

  it('POST /queries creates query with library and query group', async () => {
    const libraryId = 'urn:sqlib:library:lib1';
    const queryGroupId = 'urn:sqlib:querygroup:group1';
    const library = { $id: libraryId, name: 'Test Library', '@type': 'Library' };
    const queryGroup = { $id: queryGroupId, name: 'Test Group', '@type': 'QueryGroup' };
    const created = { $id: 'urn:sqlib:query:abc', name: 'Q', isPartOf: [libraryId, queryGroupId] };
    
    hoisted.query.get.mockImplementation((id: string) => {
      if (id === libraryId) return library;
      if (id === queryGroupId) return queryGroup;
      return null;
    });
    hoisted.library.get.mockImplementation((id: string) => {
      if (id === libraryId) return library;
      if (id === queryGroupId) return queryGroup;
      return null;
    });
    hoisted.coordinatorGet.mockImplementation((id: string) => {
      if (id === libraryId) return library;
      if (id === queryGroupId) return queryGroup;
      return null;
    });
    hoisted.query.create.mockResolvedValue(created);
    
    const res = await app.inject({ 
      method: 'POST', 
      url: '/queries', 
      payload: { name: 'Q', isPartOf: [libraryId, queryGroupId] } 
    });
    
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: created.$id, name: 'Q', isPartOf: [libraryId, queryGroupId] });
  });

  it('POST /queries requires isPartOf (library)', async () => {
    const res = await app.inject({ 
      method: 'POST', 
      url: '/queries', 
      payload: { name: 'Q' } 
    });
    
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('isPartOf is required');
  });

  it('POST /queries requires exactly one library', async () => {
    const queryGroupId = 'urn:sqlib:querygroup:group1';
    const queryGroup = { $id: queryGroupId, name: 'Test Group', '@type': 'QueryGroup' };
    
    hoisted.library.get.mockReturnValue(null);
    hoisted.query.get.mockReturnValue(queryGroup);
    hoisted.coordinatorGet.mockReturnValue(queryGroup);
    
    const res = await app.inject({ 
      method: 'POST', 
      url: '/queries', 
      payload: { name: 'Q', isPartOf: [queryGroupId] } 
    });
    
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Query must be part of exactly one library');
  });

  it('POST /queries prevents multiple libraries', async () => {
    const lib1Id = 'urn:sqlib:library:lib1';
    const lib2Id = 'urn:sqlib:library:lib2';
    const library1 = { $id: lib1Id, name: 'Library 1', '@type': 'Library' };
    const library2 = { $id: lib2Id, name: 'Library 2', '@type': 'Library' };
    
    hoisted.query.get.mockImplementation((id: string) => {
      if (id === lib1Id) return library1;
      if (id === lib2Id) return library2;
      return null;
    });
    hoisted.library.get.mockImplementation((id: string) => {
      if (id === lib1Id) return library1;
      if (id === lib2Id) return library2;
      return null;
    });
    hoisted.coordinatorGet.mockImplementation((id: string) => {
      if (id === lib1Id) return library1;
      if (id === lib2Id) return library2;
      return null;
    });
    
    const res = await app.inject({ 
      method: 'POST', 
      url: '/queries', 
      payload: { name: 'Q', isPartOf: [lib1Id, lib2Id] } 
    });
    
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Query can only be part of one library (multiple query groups allowed)');
  });

  it('POST /queries validates all referenced entities exist', async () => {
    hoisted.query.get.mockReturnValue(null);
    hoisted.library.get.mockReturnValue(null);
    hoisted.coordinatorGet.mockReturnValue(null);
    
    const res = await app.inject({ 
      method: 'POST', 
      url: '/queries', 
      payload: { name: 'Q', isPartOf: 'urn:sqlib:library:nonexistent' } 
    });
    
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Referenced entity urn:sqlib:library:nonexistent does not exist');
  });

  it('GET /queries/:id returns Query', async () => {
    const query = { $id: 'urn:sqlib:query:abc', name: 'Q', isPartOf: ['urn:sqlib:library:lib1'] };
    hoisted.query.get.mockReturnValue(query);
    hoisted.coordinatorGet.mockReturnValue(query);
    const res = await app.inject({ method: 'GET', url: `/queries/${encodeURIComponent(query.$id)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: query.$id, name: 'Q' });
  });

  it('PUT /queries/:id updates metadata', async () => {
    const id = 'urn:sqlib:query:abc';
    const currentQuery = { $id: id, '@type': 'Query', name: 'Q', isPartOf: ['urn:sqlib:library:lib1'], dateModified: '2024-01-01T00:00:00.000Z' };
    const updated = { $id: id, name: 'Q2', isPartOf: ['urn:sqlib:library:lib1'], '@type': 'Query', dateModified: '2024-01-02T00:00:00.000Z' };
    hoisted.query.get.mockImplementation((lookupId: string) => (lookupId === id ? currentQuery : null));
    hoisted.coordinatorGet.mockImplementation((lookupId: string) => (lookupId === id ? currentQuery : null));
    hoisted.query.update.mockResolvedValue(updated);
    const res = await app.inject({
      method: 'PUT',
      url: `/queries/${encodeURIComponent(id)}`,
      payload: { name: 'Q2' },
      headers: { 'if-match': currentQuery.dateModified },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, name: 'Q2' });
  });

  it('PUT /queries/:id allows moving to another library', async () => {
    const id = 'urn:sqlib:query:abc';
    const newLibraryId = 'urn:sqlib:library:lib2';
    const newLibrary = { $id: newLibraryId, name: 'New Library', '@type': 'Library' };
    const currentQuery = { $id: id, '@type': 'Query', name: 'Q', isPartOf: ['urn:sqlib:library:lib1'], dateModified: '2024-01-01T00:00:00.000Z' };
    const updated = { $id: id, name: 'Q', isPartOf: [newLibraryId], '@type': 'Query', dateModified: '2024-01-02T00:00:00.000Z' };
    
    hoisted.query.get.mockImplementation((lookupId: string) => {
      if (lookupId === id) return currentQuery;
      if (lookupId === newLibraryId) return newLibrary;
      return null;
    });
    hoisted.library.get.mockImplementation((lookupId: string) => (lookupId === newLibraryId ? newLibrary : null));
    hoisted.coordinatorGet.mockImplementation((lookupId: string) => (lookupId === newLibraryId ? newLibrary : null));
    hoisted.query.update.mockResolvedValue(updated);
    
    const res = await app.inject({ 
      method: 'PUT', 
      url: `/queries/${encodeURIComponent(id)}`, 
      payload: { isPartOf: newLibraryId },
      headers: { 'if-match': currentQuery.dateModified }
    });
    
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, isPartOf: [newLibraryId] });
  });

  it('PUT /queries/:id allows adding query group while keeping library', async () => {
    const id = 'urn:sqlib:query:abc';
    const libraryId = 'urn:sqlib:library:lib1';
    const queryGroupId = 'urn:sqlib:querygroup:group1';
    const library = { $id: libraryId, name: 'Library', '@type': 'Library' };
    const queryGroup = { $id: queryGroupId, name: 'Query Group', '@type': 'QueryGroup' };
    const currentQuery = { $id: id, '@type': 'Query', name: 'Q', isPartOf: [libraryId], dateModified: '2024-01-01T00:00:00.000Z' };
    const updated = { $id: id, name: 'Q', isPartOf: [libraryId, queryGroupId], '@type': 'Query', dateModified: '2024-01-02T00:00:00.000Z' };
    
    hoisted.query.get.mockImplementation((id: string) => {
      if (id === currentQuery.$id) return currentQuery;
      if (id === libraryId) return library;
      if (id === queryGroupId) return queryGroup;
      return null;
    });
    hoisted.library.get.mockImplementation((id: string) => {
      if (id === libraryId) return library;
      if (id === queryGroupId) return queryGroup;
      return null;
    });
    hoisted.coordinatorGet.mockImplementation((id: string) => {
      if (id === libraryId) return library;
      if (id === queryGroupId) return queryGroup;
      return null;
    });
    hoisted.query.update.mockResolvedValue(updated);
    
    const res = await app.inject({ 
      method: 'PUT', 
      url: `/queries/${encodeURIComponent(id)}`, 
      payload: { isPartOf: [libraryId, queryGroupId] },
      headers: { 'if-match': currentQuery.dateModified }
    });
    
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, isPartOf: [libraryId, queryGroupId] });
  });

  it('PUT /queries/:id prevents multiple libraries', async () => {
    const id = 'urn:sqlib:query:abc';
    const lib1Id = 'urn:sqlib:library:lib1';
    const lib2Id = 'urn:sqlib:library:lib2';
    const library1 = { $id: lib1Id, name: 'Library 1', '@type': 'Library' };
    const library2 = { $id: lib2Id, name: 'Library 2', '@type': 'Library' };
    const currentQuery = { $id: id, '@type': 'Query', name: 'Q', isPartOf: [lib1Id], dateModified: '2024-01-01T00:00:00.000Z' };
    
    hoisted.query.get.mockImplementation((id: string) => {
      if (id === currentQuery.$id) return currentQuery;
      if (id === lib1Id) return library1;
      if (id === lib2Id) return library2;
      return null;
    });
    hoisted.library.get.mockImplementation((id: string) => {
      if (id === lib1Id) return library1;
      if (id === lib2Id) return library2;
      return null;
    });
    hoisted.coordinatorGet.mockImplementation((id: string) => {
      if (id === lib1Id) return library1;
      if (id === lib2Id) return library2;
      return null;
    });
    
    const res = await app.inject({ 
      method: 'PUT', 
      url: `/queries/${encodeURIComponent(id)}`, 
      payload: { isPartOf: [lib1Id, lib2Id] },
      headers: { 'if-match': currentQuery.dateModified }
    });
    
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Query can only be part of one library (multiple query groups allowed)');
  });

  it('PUT /queries/:id validates referenced entities exist', async () => {
    const id = 'urn:sqlib:query:abc';
    const nonexistentId = 'urn:sqlib:library:nonexistent';
    const currentQuery = { $id: id, '@type': 'Query', name: 'Q', isPartOf: [], dateModified: '2024-01-01T00:00:00.000Z' };
    
    hoisted.query.get.mockImplementation((lookupId: string) => (lookupId === id ? currentQuery : null));
    hoisted.library.get.mockReturnValue(null);
    hoisted.coordinatorGet.mockReturnValue(null);
    
    const res = await app.inject({ 
      method: 'PUT', 
      url: `/queries/${encodeURIComponent(id)}`, 
      payload: { isPartOf: nonexistentId },
      headers: { 'if-match': currentQuery.dateModified }
    });
    
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Referenced entity urn:sqlib:library:nonexistent does not exist');
  });

  // The rule itself is covered in test/lib/tagMembership.test.ts. What these
  // check is that this route is wired to it, and that `tags` reaches the store.
  describe('tags', () => {
    const libraryId = 'urn:sqlib:library:lib1';
    const otherLibraryId = 'urn:sqlib:library:lib2';
    const library = { $id: libraryId, '@type': 'Library', name: 'Lib' };
    const otherLibrary = { $id: otherLibraryId, '@type': 'Library', name: 'Other' };
    const ownTag = { $id: 'urn:sqlib:tag:own', '@type': 'Tag', name: 'geo', isPartOf: libraryId };
    const foreignTag = {
      $id: 'urn:sqlib:tag:foreign',
      '@type': 'Tag',
      name: 'geo',
      isPartOf: otherLibraryId,
    };

    beforeEach(() => {
      hoisted.coordinatorGet.mockImplementation((id: string) => {
        if (id === libraryId) return library;
        if (id === otherLibraryId) return otherLibrary;
        if (id === ownTag.$id) return ownTag;
        if (id === foreignTag.$id) return foreignTag;
        return null;
      });
    });

    it('POST /queries stores tags from the query\'s own library', async () => {
      hoisted.query.create.mockImplementation(async (entity: Record<string, unknown>) => entity);

      const res = await app.inject({
        method: 'POST',
        url: '/queries',
        payload: { name: 'Q', isPartOf: [libraryId], tags: [ownTag.$id] },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().tags).toEqual([ownTag.$id]);
    });

    it('POST /queries rejects a tag from another library', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/queries',
        payload: { name: 'Q', isPartOf: [libraryId], tags: [foreignTag.$id] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('different library');
      expect(hoisted.query.create).not.toHaveBeenCalled();
    });

    it('PUT /queries/:id leaves tags untouched when the body omits them', async () => {
      const id = 'urn:sqlib:query:q1';
      const current = {
        $id: id,
        '@type': 'Query',
        name: 'Q',
        isPartOf: [libraryId],
        tags: [ownTag.$id],
      };
      hoisted.query.get.mockImplementation((lookupId: string) => (lookupId === id ? current : null));
      hoisted.query.update.mockImplementation(async (_id: string, updates: Record<string, unknown>) => ({
        ...current,
        ...updates,
      }));

      const res = await app.inject({
        method: 'PUT',
        url: `/queries/${encodeURIComponent(id)}`,
        payload: { name: 'Renamed' },
      });

      expect(res.statusCode).toBe(200);
      expect(hoisted.query.update).toHaveBeenCalledWith(id, { name: 'Renamed' });
    });

    it('PUT /queries/:id clears tags when given an empty array', async () => {
      const id = 'urn:sqlib:query:q1';
      const current = {
        $id: id,
        '@type': 'Query',
        name: 'Q',
        isPartOf: [libraryId],
        tags: [ownTag.$id],
      };
      hoisted.query.get.mockImplementation((lookupId: string) => (lookupId === id ? current : null));
      hoisted.query.update.mockImplementation(async (_id: string, updates: Record<string, unknown>) => ({
        ...current,
        ...updates,
      }));

      const res = await app.inject({
        method: 'PUT',
        url: `/queries/${encodeURIComponent(id)}`,
        payload: { tags: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(hoisted.query.update).toHaveBeenCalledWith(id, { tags: [] });
    });
  });

  it('DELETE /queries/:id deletes Query', async () => {
    hoisted.query.get.mockReturnValue({ $id: 'urn:sqlib:query:abc', '@type': 'Query' });
    hoisted.coordinatorGet.mockReturnValue({ $id: 'urn:sqlib:query:abc', '@type': 'Query' });
    hoisted.query.delete.mockResolvedValue(undefined);
    const id = 'urn:sqlib:query:abc';
    const res = await app.inject({ method: 'DELETE', url: `/queries/${encodeURIComponent(id)}` });
    expect(res.statusCode).toBe(204);
  });
});
