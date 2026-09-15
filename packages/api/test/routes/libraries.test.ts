import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import libraryRoutes from '../../src/routes/libraries.js';
import { toRestApi } from '../../src/persistence/utils/id-adapter.js';
import { LdkitLibrary } from '../../src/persistence/schemas/LibrarySchema.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const { systemQueryExecuteMock, repo } = vi.hoisted(() => ({
  systemQueryExecuteMock: vi.fn(),
  repo: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    Library: repo,
  }),
}));

vi.mock('../../src/lib/system-queries/SystemQueryRunner.js', () => ({
    SystemQueryRunner: vi.fn(function () {
      return {
        execute: systemQueryExecuteMock,
      };
    }),
  }));

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) {
      app.addSchema(schema);
    }
  }
  await app.register(libraryRoutes, { prefix: '/libraries' });
  await app.ready();
  return app;
}

describe('Library Routes (/libraries) - Unit Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    systemQueryExecuteMock.mockReset();
    repo.list.mockReset();
    repo.get.mockReset();
    repo.create.mockReset();
    repo.update.mockReset();
    repo.delete.mockReset();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('POST /libraries', () => {
    const libraryPayload = { name: 'Test Library', description: 'A description' };
    const mockLibraryId = 'urn:sqlib:library:test-library';
    const createdLibrary: LdkitLibrary = {
      $id: mockLibraryId,
      name: libraryPayload.name,
      description: libraryPayload.description,
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString(),
    } as any;

    it('should create a library and return it', async () => {
      repo.create.mockResolvedValue(createdLibrary);

      const response = await app.inject({
        method: 'POST',
        url: '/libraries',
        payload: libraryPayload,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual(toRestApi(createdLibrary));
      expect(response.headers.etag).toBe(`"${createdLibrary.dateModified}"`);
      expect(response.headers['last-modified']).toBe(new Date(createdLibrary.dateModified!).toUTCString());
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining(libraryPayload));
    });

    it('should return 500 if create fails', async () => {
      repo.create.mockRejectedValue(new Error('DB Save Error'));

      const response = await app.inject({
        method: 'POST',
        url: '/libraries',
        payload: libraryPayload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('GET /libraries', () => {
    it('should retrieve all libraries', async () => {
      const mockLibrariesData: LdkitLibrary[] = [
        { $id: 'urn:1', name: 'Lib 1' } as any,
        { $id: 'urn:2', name: 'Lib 2' } as any,
      ];
      repo.list.mockReturnValue(mockLibrariesData);

      const response = await app.inject({ method: 'GET', url: '/libraries' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockLibrariesData.map(toRestApi));
      expect(repo.list).toHaveBeenCalled();
      expect(systemQueryExecuteMock).not.toHaveBeenCalled();
    });

    it('should stream RDF when Accept requests Turtle', async () => {
      // The RDF branch reads the listing now, to narrow the dump to what the
      // caller may read (test/auth/libraryRoutes.test.ts). Nothing is filtered
      // out here — these tests mount the plugin with no auth context, which is
      // full access — so the collection query is still what runs.
      repo.list.mockReturnValue([{ $id: 'urn:1', name: 'Lib 1' }]);
      systemQueryExecuteMock.mockResolvedValue({
        mode: 'stream',
        contentType: 'text/turtle',
        stream: {
          statusCode: 200,
          headers: { 'content-type': 'text/turtle' },
          body: Readable.from(['graph-data']),
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/libraries',
        headers: { accept: 'text/turtle' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/turtle');
      expect(response.body).toBe('graph-data');
      expect(systemQueryExecuteMock).toHaveBeenCalledWith(
        'libraryCollection',
        expect.objectContaining({ acceptHeader: 'text/turtle' })
      );
    });
  });

  describe('GET /libraries/:id', () => {
    const libraryId = 'urn:sqlib:library:specific-lib';
    const expectedLibrary: LdkitLibrary = { $id: libraryId, name: 'Specific Lib', dateModified: '2024-03-01T12:00:00.000Z' } as any;

    it('should retrieve a specific library by ID', async () => {
      repo.get.mockReturnValue(expectedLibrary);

      const response = await app.inject({ method: 'GET', url: `/libraries/${libraryId}` });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(toRestApi(expectedLibrary));
      expect(response.headers.etag).toBe(`"${expectedLibrary.dateModified}"`);
      expect(response.headers['last-modified']).toBe(new Date(expectedLibrary.dateModified!).toUTCString());
      expect(repo.get).toHaveBeenCalledWith(libraryId);
      expect(systemQueryExecuteMock).not.toHaveBeenCalled();
    });

    it('should stream RDF when Accept header requests N-Triples', async () => {
      repo.get.mockReturnValue(expectedLibrary);
      systemQueryExecuteMock.mockResolvedValue({
        mode: 'stream',
        contentType: 'application/n-triples',
        stream: {
          statusCode: 200,
          headers: { 'content-type': 'application/n-triples' },
          body: Readable.from(['<graph>']),
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/libraries/${libraryId}`,
        headers: { accept: 'application/n-triples' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/n-triples');
      expect(response.body).toBe('<graph>');
      expect(systemQueryExecuteMock).toHaveBeenCalledWith(
        'libraryDescribe',
        expect.objectContaining({ acceptHeader: 'application/n-triples' })
      );
    });

    it('should return 404 if library not found', async () => {
      repo.get.mockReturnValue(null);

      const response = await app.inject({ method: 'GET', url: `/libraries/not-found` });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /libraries/export', () => {
    it('should stream RDF with attachment filename', async () => {
      // As above: the export narrows to the readable libraries, and with no
      // auth context that is all of them.
      repo.list.mockReturnValue([{ $id: 'urn:1', name: 'Lib 1' }]);
      systemQueryExecuteMock.mockResolvedValue({
        mode: 'stream',
        contentType: 'application/n-triples',
        stream: {
          statusCode: 200,
          headers: { 'content-type': 'application/n-triples' },
          body: Readable.from(['<all libraries>']),
        },
      });

      const response = await app.inject({ method: 'GET', url: '/libraries/export' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-disposition']).toContain('libraries.nt');
      expect(response.body).toBe('<all libraries>');
      expect(systemQueryExecuteMock).toHaveBeenCalledWith('libraryCollection', expect.any(Object));
    });
  });

  describe('GET /libraries/:id/export', () => {
    const exportId = 'urn:sqlib:library:file';

    it('should return 404 when library missing', async () => {
      repo.get.mockReturnValue(null);
      const response = await app.inject({ method: 'GET', url: `/libraries/${exportId}/export` });
      expect(response.statusCode).toBe(404);
      expect(systemQueryExecuteMock).not.toHaveBeenCalled();
    });

    it('should stream RDF for library export', async () => {
      repo.get.mockReturnValue({ $id: exportId } as any);
      systemQueryExecuteMock.mockResolvedValue({
        mode: 'stream',
        contentType: 'text/turtle',
        stream: {
          statusCode: 200,
          headers: { 'content-type': 'text/turtle' },
          body: Readable.from(['<library>']),
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/libraries/${exportId}/export`,
        headers: { accept: 'text/turtle' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-disposition']).toContain('library-urn-sqlib-library-file.ttl');
      expect(response.body).toBe('<library>');
      expect(systemQueryExecuteMock).toHaveBeenCalledWith('libraryDescribe', expect.any(Object));
    });
  });

  describe('PUT /libraries/:id', () => {
    const libraryId = 'urn:sqlib:library:update-test';
    const updatePayload = { name: 'Updated Name' };
    const currentLibrary: LdkitLibrary = { $id: libraryId, '@type': 'Library', name: 'Current', dateModified: '2024-01-01T00:00:00.000Z' } as any;
    const updatedLibrary: LdkitLibrary = { $id: libraryId, ...updatePayload, '@type': 'Library', dateModified: '2024-01-02T00:00:00.000Z' } as any;

    it('should update and return the library', async () => {
      repo.get.mockReturnValue(currentLibrary);
      repo.update.mockResolvedValue(updatedLibrary);

      const response = await app.inject({
        method: 'PUT',
        url: `/libraries/${libraryId}`,
        payload: updatePayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(toRestApi(updatedLibrary));
      expect(response.headers.etag).toBe(`"${updatedLibrary.dateModified}"`);
      expect(response.headers['last-modified']).toBe(new Date(updatedLibrary.dateModified!).toUTCString());
      expect(repo.get).toHaveBeenCalledWith(libraryId);
      expect(repo.update).toHaveBeenCalledWith(libraryId, updatePayload);
    });

    it('should return 500 if update fails', async () => {
      repo.get.mockReturnValue(currentLibrary);
      repo.update.mockRejectedValue(new Error('DB Update Error'));

      const response = await app.inject({
        method: 'PUT',
        url: `/libraries/${libraryId}`,
        payload: updatePayload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal Server Error' });
    });

    it('should return 412 when If-Match does not match', async () => {
      repo.get.mockReturnValue(currentLibrary);

      const response = await app.inject({
        method: 'PUT',
        url: `/libraries/${libraryId}`,
        payload: updatePayload,
        headers: { 'if-match': '2024-01-01T10:00:00.000Z' },
      });

      expect(response.statusCode).toBe(412);
      expect(response.json()).toMatchObject({ error: 'Precondition Failed', expected: currentLibrary.dateModified });
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /libraries/:id', () => {
    const libraryId = 'urn:sqlib:library:to-delete';

    it('should delete the library and return 204 No Content', async () => {
      repo.delete.mockResolvedValue(undefined);

      const response = await app.inject({ method: 'DELETE', url: `/libraries/${libraryId}` });

      expect(response.statusCode).toBe(204);
      expect(repo.delete).toHaveBeenCalledWith(libraryId);
    });

    it('should return 500 if delete fails', async () => {
      repo.delete.mockRejectedValue(new Error('DB Delete Error'));

      const response = await app.inject({ method: 'DELETE', url: `/libraries/${libraryId}` });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal Server Error' });
    });
  });
});
