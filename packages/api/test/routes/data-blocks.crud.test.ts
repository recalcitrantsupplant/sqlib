import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import dataBlockRoutes from '../../src/routes/data-blocks.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  dataBlock: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  dataBlockVersion: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  coordinatorGet: vi.fn(),
  mockCreateVersion: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    DataBlock: hoisted.dataBlock,
    DataBlockVersion: hoisted.dataBlockVersion,
  }),
  getCacheCoordinator: () => ({
    get: hoisted.coordinatorGet,
  }),
}));

vi.mock('../../src/lib/DataBlockVersionWriter.js', () => ({
  createDataBlockVersion: hoisted.mockCreateVersion,
}));

describe('DataBlocks Routes (/data-blocks) - CRUD', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);

    app.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
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
    await app.register(dataBlockRoutes, { prefix: '/data-blocks' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.dataBlock.list.mockReset();
    hoisted.dataBlock.get.mockReset();
    hoisted.dataBlock.create.mockReset();
    hoisted.dataBlock.update.mockReset();
    hoisted.dataBlock.delete.mockReset();
    hoisted.dataBlockVersion.list.mockReset();
    hoisted.dataBlockVersion.get.mockReset();
    hoisted.dataBlockVersion.create.mockReset();
    hoisted.dataBlockVersion.update.mockReset();
    hoisted.dataBlockVersion.delete.mockReset();
    hoisted.coordinatorGet.mockReset();
  });

  afterAll(async () => { await app.close(); });

  it('POST /data-blocks creates stable DataBlock', async () => {
    const libraryId = 'urn:sqlib:library:lib1';
    const library = { $id: libraryId, name: 'Test Library', '@type': 'Library' };
    const created = { $id: 'urn:sqlib:data-block:abc', name: 'DB', isPartOf: [libraryId] };
    
    hoisted.coordinatorGet.mockReturnValue(library);
    hoisted.dataBlock.create.mockResolvedValue(created);
    
    const res = await app.inject({ 
      method: 'POST', 
      url: '/data-blocks', 
      payload: { name: 'DB', isPartOf: libraryId } 
    });
    
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: created.$id, name: 'DB', isPartOf: [libraryId] });
  });

  it('GET /data-blocks/:id returns DataBlock', async () => {
    const dataBlock = { $id: 'urn:sqlib:data-block:abc', name: 'DB', isPartOf: ['urn:sqlib:library:lib1'] };
    hoisted.dataBlock.get.mockReturnValue(dataBlock);
    const res = await app.inject({ method: 'GET', url: `/data-blocks/${encodeURIComponent(dataBlock.$id)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: dataBlock.$id, name: 'DB' });
  });

  it('PUT /data-blocks/:id updates metadata', async () => {
    const id = 'urn:sqlib:data-block:abc';
    const currentDataBlock = { $id: id, '@type': 'DataBlock', name: 'DB', isPartOf: ['urn:sqlib:library:lib1'], dateModified: '2024-01-01T00:00:00.000Z' };
    const updated = { $id: id, name: 'DB2', isPartOf: ['urn:sqlib:library:lib1'], '@type': 'DataBlock', dateModified: '2024-01-02T00:00:00.000Z' };
    hoisted.dataBlock.get.mockImplementation((lookupId: string) => (lookupId === id ? currentDataBlock : null));
    hoisted.dataBlock.update.mockResolvedValue(updated);
    const res = await app.inject({
      method: 'PUT',
      url: `/data-blocks/${encodeURIComponent(id)}`,
      payload: { name: 'DB2' },
      headers: { 'if-match': currentDataBlock.dateModified },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, name: 'DB2' });
    expect(res.headers.etag).toBe('"2024-01-02T00:00:00.000Z"');
    expect(res.headers['last-modified']).toBe('Tue, 02 Jan 2024 00:00:00 GMT');
  });

  it('PUT /data-blocks/:id rejects mismatched ETag', async () => {
    const id = 'urn:sqlib:data-block:abc';
    const currentDataBlock = { $id: id, '@type': 'DataBlock', name: 'DB', isPartOf: ['urn:sqlib:library:lib1'], dateModified: '2024-01-01T00:00:00.000Z' };
    hoisted.dataBlock.get.mockReturnValue(currentDataBlock);

    const res = await app.inject({
      method: 'PUT',
      url: `/data-blocks/${encodeURIComponent(id)}`,
      payload: { name: 'DB2' },
      headers: { 'if-match': '"different-etag"' },
    });

    expect(res.statusCode).toBe(412);
    expect(res.json()).toMatchObject({
      error: 'Precondition Failed',
      expected: '2024-01-01T00:00:00.000Z',
    });
  });

  it('POST /data-blocks requires existing referenced parents', async () => {
    const libraryId = 'urn:sqlib:library:lib1';
    const library = { $id: libraryId, '@type': 'Library', name: 'Test Library' };
    hoisted.coordinatorGet.mockImplementation((iri: string) => {
      if (iri === libraryId) return library;
      return null;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/data-blocks',
      payload: { name: 'DB', isPartOf: [libraryId, 'urn:sqlib:rule-set:missing'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Referenced entity urn:sqlib:rule-set:missing does not exist' });
  });

  it('POST /data-blocks/:id/versions creates a new version', async () => {
    const id = 'urn:sqlib:data-block:abc';
    const parent = { $id: id, '@type': 'DataBlock', name: 'DB', isPartOf: ['urn:sqlib:library:lib1'] };
    const createdVersion = {
      $id: 'urn:sqlib:data-block-version:1',
      '@type': 'DataBlockVersion',
      isPartOf: id,
      version: 1,
      dataString: 'INSERT DATA { <a> <b> <c> . }',
      normalizedInsertData: 'INSERT DATA { <a> <b> <c> . }',
      comment: null,
      defaultBackend: null,
      dateModified: '2024-01-03T00:00:00.000Z',
    };

    hoisted.dataBlock.get.mockReturnValue(parent);
    hoisted.mockCreateVersion.mockResolvedValue(createdVersion);

    const res = await app.inject({
      method: 'POST',
      url: `/data-blocks/${encodeURIComponent(id)}/versions`,
      payload: { dataString: 'INSERT DATA { <a> <b> <c> . }' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: createdVersion.$id,
      isPartOf: id,
      version: 1,
      dataString: createdVersion.dataString,
      normalizedInsertData: createdVersion.normalizedInsertData,
      comment: null,
      defaultBackend: null,
      dateModified: createdVersion.dateModified,
    });
    expect(res.headers.etag).toBe('"2024-01-03T00:00:00.000Z"');
    expect(res.headers['last-modified']).toBe('Wed, 03 Jan 2024 00:00:00 GMT');
    expect(hoisted.mockCreateVersion).toHaveBeenCalledWith(id, {
      dataString: 'INSERT DATA { <a> <b> <c> . }',
      comment: null,
      defaultBackend: null,
    });
  });

  it('POST /data-blocks/:id/versions forwards immutable flag', async () => {
    const id = 'urn:sqlib:data-block:abc';
    const parent = { $id: id, '@type': 'DataBlock' };
    const createdVersion = { $id: 'urn:sqlib:data-block-version:1', '@type': 'DataBlockVersion', immutable: true, isPartOf: id, version: 1, dataString: 'INSERT DATA {}' };
    hoisted.dataBlock.get.mockReturnValue(parent);
    hoisted.mockCreateVersion.mockResolvedValue(createdVersion);

    const res = await app.inject({
      method: 'POST',
      url: `/data-blocks/${encodeURIComponent(id)}/versions`,
      payload: { dataString: 'INSERT DATA {}', immutable: true },
    });

    expect(res.statusCode).toBe(201);
    expect(hoisted.mockCreateVersion).toHaveBeenCalledWith(id, expect.objectContaining({ immutable: true }));
  });

  it('POST /data-blocks/:id/versions requires dataString', async () => {
    const id = 'urn:sqlib:data-block:abc';
    hoisted.dataBlock.get.mockReturnValue({ $id: id, '@type': 'DataBlock' });

    const res = await app.inject({
      method: 'POST',
      url: `/data-blocks/${encodeURIComponent(id)}/versions`,
      payload: { dataString: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'dataString must be provided' });
    expect(hoisted.mockCreateVersion).not.toHaveBeenCalled();
  });

  it('POST /data-blocks/:id/versions returns 404 when parent missing', async () => {
    const id = 'urn:sqlib:data-block:missing';
    hoisted.dataBlock.get.mockReturnValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/data-blocks/${encodeURIComponent(id)}/versions`,
      payload: { dataString: 'INSERT DATA { <a> <b> <c> . }' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Data block not found' });
  });

  it('DELETE /data-blocks/:id cascading deletes data block and all versions', async () => {
    const id = 'urn:sqlib:data-block:abc';
    const dataBlock = { $id: id, '@type': 'DataBlock', name: 'DB', isPartOf: ['urn:sqlib:library:lib1'] };
    const version1 = { $id: 'urn:sqlib:data-block-version:1', '@type': 'DataBlockVersion', isPartOf: id, version: 1 };
    const version2 = { $id: 'urn:sqlib:data-block-version:2', '@type': 'DataBlockVersion', isPartOf: id, version: 2 };

    hoisted.dataBlock.get.mockReturnValue(dataBlock);
    hoisted.dataBlockVersion.list.mockReturnValue([version1, version2]);
    hoisted.dataBlockVersion.delete.mockResolvedValue(undefined);
    hoisted.dataBlock.delete.mockResolvedValue(undefined);

    const res = await app.inject({ method: 'DELETE', url: `/data-blocks/${encodeURIComponent(id)}` });

    expect(res.statusCode).toBe(204);
    expect(hoisted.dataBlockVersion.delete).toHaveBeenCalledTimes(2);
    expect(hoisted.dataBlockVersion.delete).toHaveBeenCalledWith(version1.$id);
    expect(hoisted.dataBlockVersion.delete).toHaveBeenCalledWith(version2.$id);
    expect(hoisted.dataBlock.delete).toHaveBeenCalledWith(id);
  });

  it('DELETE /data-blocks/:id deletes data block when no versions exist', async () => {
    const id = 'urn:sqlib:data-block:abc';
    const dataBlock = { $id: id, '@type': 'DataBlock', name: 'DB', isPartOf: ['urn:sqlib:library:lib1'] };
    hoisted.dataBlock.get.mockReturnValue(dataBlock);
    hoisted.dataBlockVersion.list.mockReturnValue([]);
    hoisted.dataBlock.delete.mockResolvedValue(undefined);

    const res = await app.inject({ method: 'DELETE', url: `/data-blocks/${encodeURIComponent(id)}` });

    expect(res.statusCode).toBe(204);
    expect(hoisted.dataBlock.delete).toHaveBeenCalledWith(id);
  });

  it('DELETE /data-blocks/:id/versions/:version deletes specific version', async () => {
    const id = 'urn:sqlib:data-block:abc';
    const parent = { $id: id, '@type': 'DataBlock', name: 'DB' };
    const version = { $id: 'urn:sqlib:data-block-version:1', '@type': 'DataBlockVersion', isPartOf: id, version: 1 };

    hoisted.dataBlock.get.mockReturnValue(parent);
    hoisted.dataBlockVersion.list.mockReturnValue([version]);
    hoisted.dataBlockVersion.delete.mockResolvedValue(undefined);

    const res = await app.inject({ method: 'DELETE', url: `/data-blocks/${encodeURIComponent(id)}/versions/1` });

    expect(res.statusCode).toBe(204);
    expect(hoisted.dataBlockVersion.delete).toHaveBeenCalledWith(version.$id);
  });

  it('DELETE /data-blocks/:id/versions/:version returns 404 when version not found', async () => {
    const id = 'urn:sqlib:data-block:abc';
    const parent = { $id: id, '@type': 'DataBlock', name: 'DB' };

    hoisted.dataBlock.get.mockReturnValue(parent);
    hoisted.dataBlockVersion.list.mockReturnValue([]);

    const res = await app.inject({ method: 'DELETE', url: `/data-blocks/${encodeURIComponent(id)}/versions/99` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Data block version not found' });
  });

  it('GET /data-blocks/:id/versions/:version serves an immutable version', async () => {
    /*
     * The read handler carried the write guard: `if (match.immutable) return
     * 409 'Version is immutable; create a new version instead.'`, so a version
     * frozen on purpose — the state a rule set version names when it wants the
     * triples it was validated against — was the one version that could not be
     * read back. Found while sweeping this plugin into `route-coverage.test.ts`.
     */
    const id = 'urn:sqlib:data-block:abc';
    const parent = { $id: id, '@type': 'DataBlock', name: 'DB' };
    const version = {
      $id: 'urn:sqlib:data-block-version:1',
      '@type': 'DataBlockVersion',
      isPartOf: id,
      version: 1,
      immutable: true,
      dataString: 'INSERT DATA { <http://ex/s> <http://ex/p> <http://ex/o> }',
    };
    hoisted.dataBlock.get.mockReturnValue(parent);
    hoisted.dataBlockVersion.list.mockReturnValue([version]);

    const res = await app.inject({
      method: 'GET',
      url: `/data-blocks/${encodeURIComponent(id)}/versions/1`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().dataString).toBe(version.dataString);
    expect(res.json().immutable).toBe(true);
  });

  it('PATCH /data-blocks/:id/versions/:version refuses a content change', async () => {
    // A version is a snapshot (issue #192): a rule set version that names this
    // one was validated against exactly these triples.
    const id = 'urn:sqlib:data-block:abc';
    const parent = { $id: id, '@type': 'DataBlock', name: 'DB' };
    const version = { $id: 'urn:sqlib:data-block-version:1', '@type': 'DataBlockVersion', isPartOf: id, version: 1, immutable: true };
    hoisted.dataBlock.get.mockReturnValue(parent);
    hoisted.dataBlockVersion.list.mockReturnValue([version]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/data-blocks/${encodeURIComponent(id)}/versions/1`,
      payload: { dataString: 'INSERT DATA {}' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().fields).toEqual(['dataString']);
    expect(hoisted.dataBlockVersion.update).not.toHaveBeenCalled();
  });

  it('DELETE /data-blocks/:id/versions/:version returns 404 when parent not found', async () => {
    hoisted.dataBlock.get.mockReturnValue(null);

    const res = await app.inject({ method: 'DELETE', url: '/data-blocks/urn%3Asqlib%3Adata-block%3Amissing/versions/1' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Data block not found' });
  });
});
