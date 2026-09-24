import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import backendRoutes from '../../src/routes/backends.js';
import { toRestApi } from '../../src/persistence/utils/id-adapter.js';
import { BackendTypeIri, backendTypeIriToKey, type LdkitBackend } from '../../src/persistence/schemas/BackendSchema.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const repo = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const libraryRepo = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
}));

const queryRepo = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
}));

overrideCacheCoordinatorProvider({
  getEntityRepositories: () => ({
    Backend: repo,
    Library: libraryRepo,
    Query: queryRepo,
  }),
});

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) {
      app.addSchema(schema);
    }
  }
  await app.register(backendRoutes, { prefix: '/backends' });
  await app.ready();
  return app;
}

describe('Backend Routes (/backends) - Unit Tests (v1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    repo.list.mockReset();
    repo.get.mockReset();
    repo.create.mockReset();
    repo.update.mockReset();
    repo.delete.mockReset();
    libraryRepo.list.mockReset();
    libraryRepo.update.mockReset();
    queryRepo.list.mockReset();
    queryRepo.update.mockReset();
    libraryRepo.list.mockReturnValue([]);
    queryRepo.list.mockReturnValue([]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /backends', () => {
    const backendPayload = {
      name: 'Test Backend',
      description: 'A description',
      backendType: 'http',
      endpoint: 'http://example.org/sparql',
    };
    const mockBackendId = 'urn:sqlib:backend:test-backend';
    const createdTimestamp = '2024-01-01T12:00:00.000Z';
    const createdBackend: LdkitBackend = {
      $id: mockBackendId,
      name: backendPayload.name,
      description: backendPayload.description,
      backendType: BackendTypeIri.http,
      endpoint: backendPayload.endpoint,
      authEnvKey: 'TEST_BACKEND',
      username: 'admin',
      password: 'secret',
      dateCreated: createdTimestamp,
      dateModified: createdTimestamp,
    } as any;

    it('should create a backend and return it', async () => {
      repo.create.mockResolvedValue(createdBackend);

      const response = await app.inject({
        method: 'POST',
        url: '/backends',
        payload: backendPayload,
      });

      expect(response.statusCode).toBe(201);
      const expectedResponse = toRestApi(createdBackend) as Record<string, unknown>;
      delete expectedResponse.username;
      delete expectedResponse.password;
      expectedResponse.backendType = backendTypeIriToKey(createdBackend.backendType)!;
      expect(response.json()).toEqual(expectedResponse);
      expect(response.headers.etag).toBe(`"${createdTimestamp}"`);
      expect(response.headers['last-modified']).toBe(new Date(createdTimestamp).toUTCString());
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          $id: expect.stringMatching(/^urn:sqlib:backend:/),
          name: backendPayload.name,
          backendType: BackendTypeIri.http,
          endpoint: backendPayload.endpoint,
          authEnvKey: 'TEST_BACKEND',
        })
      );
    });

    it('should 400 on invalid backendType', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/backends',
        payload: { ...backendPayload, backendType: 'oxigraph' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should create an oxigraphEphemeral backend without requiring an endpoint', async () => {
      const payload = {
        name: 'Local Oxigraph',
        description: 'In-process store',
        backendType: 'oxigraphEphemeral' as const,
        oxigraphConfig: JSON.stringify({ storeType: 'durable', loadMethod: 'none' })
      };
      const createdEphemeral: LdkitBackend = {
        $id: mockBackendId,
        name: payload.name,
        description: payload.description,
        backendType: BackendTypeIri.oxigraphEphemeral,
        oxigraphConfig: { storeType: 'durable', loadMethod: 'none' } as any,
        dateCreated: createdTimestamp,
        dateModified: createdTimestamp,
      } as any;
      repo.create.mockResolvedValue(createdEphemeral);

      const response = await app.inject({
        method: 'POST',
        url: '/backends',
        payload,
      });

      expect(response.statusCode).toBe(201);
      const expected = toRestApi(createdEphemeral) as Record<string, unknown>;
      expected.backendType = backendTypeIriToKey(createdEphemeral.backendType)!;
      expected.oxigraphConfig = JSON.stringify({ storeType: 'durable', loadMethod: 'none' });
      expect(response.json()).toEqual(expected);
      // Written as the JSON string the store round-trips, not as an object:
      // an object reaches the literal as "[object Object]" and the config is
      // gone at the next reload. See `LdkitBackend.oxigraphConfig`.
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          backendType: BackendTypeIri.oxigraphEphemeral,
          oxigraphConfig: JSON.stringify({ storeType: 'durable', loadMethod: 'none' })
        })
      );
    });

    /**
     * The route registered the C1 snapshot until Phase B2 and now registers the
     * document generated from the entity model. `queryMethod` is the property
     * where the two could have differed silently: an `enum` and a `null` do not
     * coexist by default, because `nullable: true` is not a keyword ajv honours
     * and a `null` reaching a plain string schema is *coerced* to `''`.
     */
    it('should accept a null queryMethod and reject an empty one', async () => {
      repo.create.mockResolvedValue(createdBackend);

      const withNull = await app.inject({
        method: 'POST',
        url: '/backends',
        payload: { ...backendPayload, queryMethod: null },
      });
      expect(withNull.statusCode).toBe(201);

      const withEmpty = await app.inject({
        method: 'POST',
        url: '/backends',
        payload: { ...backendPayload, queryMethod: '' },
      });
      expect(withEmpty.statusCode).toBe(400);
    });

    it('should reject an empty endpoint', async () => {
      // Accepted by the snapshot, which typed `endpoint` as a bare string; the
      // entity model says `format: iri`.
      const response = await app.inject({
        method: 'POST',
        url: '/backends',
        payload: { ...backendPayload, endpoint: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 500 if create fails', async () => {
      repo.create.mockRejectedValue(new Error('DB Save Error'));

      const response = await app.inject({
        method: 'POST',
        url: '/backends',
        payload: backendPayload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('GET /backends', () => {
    it('should retrieve all backends', async () => {
      const mockBackendsData: LdkitBackend[] = [
        { $id: 'urn:sqlib:backend:test-1', name: 'B 1', backendType: BackendTypeIri.http, endpoint: 'http://a' } as any,
        { $id: 'urn:sqlib:backend:test-2', name: 'B 2', backendType: BackendTypeIri.oxigraphEphemeral, endpoint: 'http://b' } as any,
      ];
      repo.list.mockReturnValue(mockBackendsData);

      const response = await app.inject({ method: 'GET', url: '/backends' });

      expect(response.statusCode).toBe(200);
      const expected = mockBackendsData.map(entity => ({
        ...toRestApi(entity),
        backendType: backendTypeIriToKey(entity.backendType)!
      }));
      expect(response.json()).toEqual(expected);
      expect(repo.list).toHaveBeenCalled();
    });
  });

  describe('GET /backends/:id', () => {
    const backendId = 'urn:sqlib:backend:specific-backend';
    const backendTimestamp = '2024-01-05T00:00:00.000Z';
    const expectedBackend: LdkitBackend = {
      $id: backendId,
      name: 'Specific Backend',
      backendType: BackendTypeIri.http,
      endpoint: 'http://example.org/sparql',
      dateModified: backendTimestamp,
    } as any;

    it('should retrieve a specific backend by ID', async () => {
      repo.get.mockReturnValue(expectedBackend);

      const response = await app.inject({ method: 'GET', url: `/backends/${backendId}` });

      expect(response.statusCode).toBe(200);
      const expected = toRestApi(expectedBackend) as Record<string, unknown>;
      expected.backendType = backendTypeIriToKey(expectedBackend.backendType)!;
      expect(response.json()).toEqual(expected);
      expect(repo.get).toHaveBeenCalledWith(backendId);
      expect(response.headers.etag).toBe(`"${backendTimestamp}"`);
      expect(response.headers['last-modified']).toBe(new Date(backendTimestamp).toUTCString());
    });

    it('should return 404 if backend not found', async () => {
      repo.get.mockReturnValue(null);

      const response = await app.inject({ method: 'GET', url: `/backends/not-found` });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /backends/:id', () => {
    const backendId = 'urn:sqlib:backend:update-test';
    const updatePayload = { name: 'Updated Name' };
    const currentBackend: LdkitBackend = {
      $id: backendId,
      name: 'Existing Name',
      backendType: BackendTypeIri.http,
      endpoint: 'http://example.org/sparql',
      dateModified: '2024-01-01T00:00:00.000Z',
    } as any;
    const updatedBackend: LdkitBackend = {
      ...currentBackend,
      ...updatePayload,
      dateModified: '2024-01-02T00:00:00.000Z',
      '@type': 'Backend',
    } as any;

    it('should update and return the backend', async () => {
      repo.get.mockReturnValue(currentBackend);
      repo.update.mockResolvedValue(updatedBackend);

      const response = await app.inject({
        method: 'PUT',
        url: `/backends/${backendId}`,
        payload: updatePayload,
        headers: { 'if-match': `"${currentBackend.dateModified}"` },
      });

      expect(response.statusCode).toBe(200);
      const expected = toRestApi(updatedBackend) as Record<string, unknown>;
      expected.backendType = backendTypeIriToKey(updatedBackend.backendType)!;
      expect(response.json()).toEqual(expected);
      expect(repo.get).toHaveBeenCalledWith(backendId);
      expect(repo.update).toHaveBeenCalledWith(backendId, updatePayload);
      expect(response.headers.etag).toBe(`"${updatedBackend.dateModified}"`);

      if (!updatedBackend.dateModified) {
        throw new Error('updatedBackend.dateModified should be defined for this test');
      }

      expect(response.headers['last-modified']).toBe(new Date(updatedBackend.dateModified).toUTCString());
    });

    it('should allow changing backendType to oxigraphEphemeral', async () => {
      const updated = { ...currentBackend, backendType: BackendTypeIri.oxigraphEphemeral } as any;
      repo.get.mockReturnValue(currentBackend);
      repo.update.mockResolvedValue(updated);

      const response = await app.inject({
        method: 'PUT',
        url: `/backends/${backendId}` ,
        payload: { backendType: 'oxigraphEphemeral' },
        headers: { 'if-match': `"${currentBackend.dateModified}"` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().backendType).toBe('oxigraphEphemeral');
    });

    it('should return 500 if update fails', async () => {
      repo.get.mockReturnValue(currentBackend);
      repo.update.mockRejectedValue(new Error('DB Update Error'));

      const response = await app.inject({
        method: 'PUT',
        url: `/backends/${backendId}`,
        payload: updatePayload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal Server Error' });
    });

    it('should return 412 when If-Match does not match', async () => {
      repo.get.mockReturnValue(currentBackend);

      const response = await app.inject({
        method: 'PUT',
        url: `/backends/${backendId}`,
        payload: updatePayload,
        headers: { 'if-match': 'mismatch-etag' },
      });

      expect(response.statusCode).toBe(412);
      expect(response.json()).toMatchObject({ error: 'Precondition Failed' });
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /backends/:id', () => {
    const backendId = 'urn:sqlib:backend:to-delete';

    it('should delete the backend and return 204 No Content', async () => {
      repo.get.mockReturnValue({ $id: backendId, '@type': 'Backend' });
      repo.delete.mockResolvedValue(undefined);

      const response = await app.inject({ method: 'DELETE', url: `/backends/${backendId}` });

      expect(response.statusCode).toBe(204);
      expect(repo.delete).toHaveBeenCalledWith(backendId);
    });

    it('should return 500 if delete fails', async () => {
      repo.get.mockReturnValue({ $id: backendId, '@type': 'Backend' });
      repo.delete.mockRejectedValue(new Error('DB Delete Error'));

      const response = await app.inject({ method: 'DELETE', url: `/backends/${backendId}` });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'Internal Server Error' });
    });
  });
});
