import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import queryRoutes from '../../src/routes/queries.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { createQueryVersionFlat } from '../../src/lib/QueryVersionWriter.js';
import { expandQueryVersion } from '../../src/lib/QueryVersionResolver.js';

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

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    Query: hoisted.query,
    QueryVersion: hoisted.queryVersion,
    Library: hoisted.library,
  }),
  getCacheCoordinator: () => ({
    get: hoisted.coordinatorGet,
  }),
}));

// Mock QueryVersionWriter
vi.mock('../../src/lib/QueryVersionWriter.js', () => ({
  createQueryVersionFlat: vi.fn(),
}));

// Mock QueryVersionResolver
vi.mock('../../src/lib/QueryVersionResolver.js', () => ({
  expandQueryVersion: vi.fn(),
}));

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
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
  return app;
}

describe('Queries Routes (/queries) - Basic', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
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
    app = await buildTestApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('POST /queries creates a Query', async () => {
    const libraryId = 'urn:sqlib:library:lib1';
    const payload = { name: 'My Query', isPartOf: libraryId };
    const created = {
      $id: 'urn:sqlib:query:abc',
      name: 'My Query',
      isPartOf: [libraryId],
      dateModified: '2024-02-01T00:00:00.000Z',
    };

    // Mock library exists
    hoisted.library.get.mockReturnValue({ $id: libraryId, '@type': 'Library', name: 'Test Library' });
    hoisted.coordinatorGet.mockReturnValue({ $id: libraryId, '@type': 'Library', name: 'Test Library' });
    hoisted.query.create.mockResolvedValue(created);

    const res = await app.inject({ method: 'POST', url: '/queries', payload });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: created.$id, name: 'My Query', isPartOf: [libraryId] });
    expect(res.headers.etag).toBe(`"${created.dateModified}"`);
    expect(res.headers['last-modified']).toBe(new Date(created.dateModified!).toUTCString());
    expect(hoisted.query.create).toHaveBeenCalledWith(expect.objectContaining({ $id: expect.any(String), name: 'My Query', isPartOf: [libraryId] }));
  });

  it('POST /queries/{id}/v creates version 1 and sets currentVersion', async () => {
    const queryId = 'urn:sqlib:query:abc';
    // Parent exists
    hoisted.query.get.mockReturnValue({ $id: queryId, name: 'My Query' });
    hoisted.coordinatorGet.mockReturnValue({ $id: queryId, name: 'My Query' });

    // Create version returns created version
    const createdVersion = {
      $id: 'urn:sqlib:query-version:generated',
      isPartOf: queryId,
      version: 1,
      queryString: 'SELECT * WHERE { ?s ?p ?o }',
      dateModified: '2024-02-01T00:00:00.000Z',
    };

    // Mock the createQueryVersionFlat function
    (createQueryVersionFlat as any).mockResolvedValue({
      created: createdVersion,
      iriMap: {}
    });

    // Mock the expandQueryVersion function
    const expandedVersion = {
      queryVersion: { id: createdVersion.$id, isPartOf: queryId, version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }' },
      limitParameters: [],
      offsetParameters: [],
      inputs: [],
      inputTuples: [],
      outputs: [],
      outputTuples: [],
      tupleMembers: []
    };
    (expandQueryVersion as any).mockResolvedValue(expandedVersion);

    const res = await app.inject({ method: 'POST', url: `/queries/${encodeURIComponent(queryId)}/v`, payload: { queryVersion: { queryString: 'SELECT * WHERE { ?s ?p ?o }' } } });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.queryVersion).toMatchObject({ isPartOf: queryId, version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }' });
    expect(json.queryVersion.id).toMatch(/^urn:sqlib:query-version:/);
    expect(res.headers.etag).toBe(`"${createdVersion.dateModified}"`);
    expect(res.headers['last-modified']).toBe(new Date(createdVersion.dateModified!).toUTCString());
    // Verify createQueryVersionFlat was called
    expect(createQueryVersionFlat).toHaveBeenCalledWith(queryId, expect.objectContaining({ queryString: 'SELECT * WHERE { ?s ?p ?o }' }));
  });

  it('POST /queries/{id}/v forwards immutable flag to writer', async () => {
    const queryId = 'urn:sqlib:query:abc';
    hoisted.queryVersion.list.mockReturnValue([]);
    hoisted.query.get.mockReturnValue({ $id: queryId, name: 'My Query' });
    const createdVersion = {
      $id: 'urn:sqlib:query-version:abcd',
      isPartOf: queryId,
      version: 1,
      immutable: true,
      queryString: 'SELECT * WHERE { ?s ?p ?o }',
      dateModified: '2024-02-01T00:00:00.000Z',
    };

    (createQueryVersionFlat as any).mockResolvedValue({ created: createdVersion, iriMap: {} });
    (expandQueryVersion as any).mockResolvedValue({
      queryVersion: { id: createdVersion.$id, isPartOf: queryId, version: 1, immutable: true, queryString: createdVersion.queryString },
      limitParameters: [],
      offsetParameters: [],
      inputs: [],
      inputTuples: [],
      outputs: [],
      outputTuples: [],
      tupleMembers: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(queryId)}/v`,
      payload: { queryVersion: { queryString: createdVersion.queryString, immutable: true } },
    });

    expect(res.statusCode).toBe(201);
    expect(createQueryVersionFlat).toHaveBeenCalledWith(queryId, expect.objectContaining({ immutable: true }));
    expect(res.json().queryVersion.immutable).toBe(true);
  });

  it('GET /queries/{id}/v lists versions sorted', async () => {
    const queryId = 'urn:sqlib:query:abc';

    hoisted.queryVersion.list.mockReturnValue([
      { $id: 'urn:x:ver2', '@type': 'QueryVersion', isPartOf: queryId, version: 2, queryString: 'SELECT * WHERE { ?s ?p ?o }' },
      { $id: 'urn:x:ver1', '@type': 'QueryVersion', isPartOf: queryId, version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }' },
      { $id: 'urn:x:other', '@type': 'QueryVersion', isPartOf: 'urn:other', version: 99, queryString: 'SELECT * WHERE { ?s ?p ?o }' },
    ]);
    hoisted.coordinatorGet.mockReturnValue({ $id: queryId, '@type': 'Query', name: 'Sample' });

    const res = await app.inject({ method: 'GET', url: `/queries/${encodeURIComponent(queryId)}/v` });

    expect(res.statusCode).toBe(200);
    const arr = res.json();
    expect(arr.map((v: any) => v.version)).toEqual([1, 2]);
  });

  it('GET /queries/:id returns concurrency headers', async () => {
    const queryId = 'urn:sqlib:query:abc';
    const query = {
      $id: queryId,
      name: 'Sample',
      isPartOf: ['urn:sqlib:library:lib1'],
      dateModified: '2024-04-10T12:34:56.000Z',
    };
    hoisted.query.get.mockReturnValue(query);
    hoisted.coordinatorGet.mockImplementation((id: string) => (id === queryId ? query : null));

    const res = await app.inject({ method: 'GET', url: `/queries/${encodeURIComponent(queryId)}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe(`"${query.dateModified}"`);
    expect(res.headers['last-modified']).toBe(new Date(query.dateModified!).toUTCString());
  });

  it('PUT /queries/:id enforces If-Match and updates entity', async () => {
    const queryId = 'urn:sqlib:query:abc';
    const currentQuery = { $id: queryId, name: 'Old', isPartOf: ['urn:sqlib:library:lib1'], dateModified: '2024-01-01T00:00:00.000Z' };
    const updatedQuery = { ...currentQuery, name: 'New', dateModified: '2024-01-02T00:00:00.000Z' };

    hoisted.query.get.mockImplementation((lookupId: string) => (lookupId === queryId ? currentQuery : null));
    hoisted.coordinatorGet.mockImplementation((lookupId: string) => (lookupId === queryId ? currentQuery : null));
    hoisted.queryVersion.list.mockImplementation(() => [{ ...currentQuery }]);
    hoisted.query.update.mockResolvedValue({ ...updatedQuery, '@type': 'QueryVersion' });

    const res = await app.inject({
      method: 'PUT',
      url: `/queries/${encodeURIComponent(queryId)}`,
      payload: { name: 'New' },
      headers: { 'if-match': currentQuery.dateModified },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: queryId, name: 'New' });
    expect(res.headers.etag).toBe(`"${updatedQuery.dateModified}"`);
    expect(res.headers['last-modified']).toBe(new Date(updatedQuery.dateModified!).toUTCString());
    expect(hoisted.query.update).toHaveBeenCalledWith(queryId, { name: 'New' });
  });

  it('PUT /queries/:id returns 412 for stale If-Match', async () => {
    const queryId = 'urn:sqlib:query:abc';
    const currentQuery = { $id: queryId, name: 'Old', isPartOf: ['urn:sqlib:library:lib1'], dateModified: '2024-01-01T00:00:00.000Z' };

    hoisted.query.get.mockImplementation((lookupId: string) => (lookupId === queryId ? currentQuery : null));
    hoisted.coordinatorGet.mockImplementation((lookupId: string) => (lookupId === queryId ? currentQuery : null));
    hoisted.queryVersion.list.mockImplementation(() => [{ ...currentQuery }]);

    const res = await app.inject({
      method: 'PUT',
      url: `/queries/${encodeURIComponent(queryId)}`,
      payload: { name: 'New' },
      headers: { 'if-match': 'mismatch' },
    });

    expect(res.statusCode).toBe(412);
    expect(hoisted.query.update).not.toHaveBeenCalled();
  });

  it('PATCH /queries/:id/v/:version enforces If-Match', async () => {
    const queryId = 'urn:sqlib:query:abc';
    const existingVersion = {
      $id: 'urn:sqlib:query-version:1',
      isPartOf: queryId,
      version: 1,
      queryString: 'SELECT * WHERE { ?s ?p ?o }',
      dateModified: '2024-01-01T00:00:00.000Z',
    };

    hoisted.queryVersion.list.mockImplementation(() => [{ ...existingVersion }]);
    hoisted.coordinatorGet.mockReturnValue({ $id: queryId, '@type': 'Query' });
    hoisted.queryVersion.update.mockResolvedValue({ ...existingVersion, comment: 'updated', dateModified: '2024-01-02T00:00:00.000Z', '@type': 'QueryVersion' });
    (expandQueryVersion as any).mockResolvedValue({
      queryVersion: {
        id: existingVersion.$id,
        isPartOf: existingVersion.isPartOf,
        version: existingVersion.version,
        queryString: existingVersion.queryString,
        comment: 'updated'
      },
      limitParameters: [],
      offsetParameters: [],
      inputs: [],
      outputs: [],
      inputTuples: [],
      outputTuples: [],
      tupleMembers: []
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/queries/${encodeURIComponent(queryId)}/v/1`,
      payload: { comment: 'updated' },
      headers: { 'if-match': existingVersion.dateModified },
    });

    expect(res.statusCode).toBe(200);
    expect(hoisted.queryVersion.update).toHaveBeenCalledWith(existingVersion.$id, { comment: 'updated' });

    hoisted.queryVersion.update.mockClear();

    const staleRes = await app.inject({
      method: 'PATCH',
      url: `/queries/${encodeURIComponent(queryId)}/v/1`,
      payload: { comment: 'updated' },
      headers: { 'if-match': 'wrong' },
    });

    expect(staleRes.statusCode).toBe(412);
    expect(hoisted.queryVersion.update).not.toHaveBeenCalled();
  });
});
