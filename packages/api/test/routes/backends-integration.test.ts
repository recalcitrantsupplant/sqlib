import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

import { BackendTypeIri, type LdkitBackend } from '../../src/persistence/schemas/BackendSchema.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  backend: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  library: {
    list: vi.fn(),
    update: vi.fn(),
  },
  query: {
    list: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    Backend: hoisted.backend,
    Library: hoisted.library,
    Query: hoisted.query,
  }),
}));

// Mock crypto for consistent ID generation in tests
vi.mock('crypto', () => ({
    randomUUID: vi.fn(() => 'test-uuid-123'),
}));



function createMockBackend(overrides: Partial<LdkitBackend> = {}): LdkitBackend {
  return {
    $id: `urn:sqlib:backend:${Math.random().toString(36).substr(2, 9)}`,
    '@type': 'Backend',
    name: 'Test Backend',
    backendType: BackendTypeIri.http,
    endpoint: 'http://test.example.com/sparql',
    dateCreated: '2024-01-01T00:00:00.000Z',
    dateModified: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) {
      app.addSchema(schema);
    }
  }
  const backendRoutes = (await import('../../src/routes/backends.js')).default;
  await app.register(backendRoutes, { prefix: '/backends' });
  await app.ready();
  return app;
}

describe('Backend Routes Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    hoisted.library.list.mockReturnValue([]);
    hoisted.query.list.mockReturnValue([]);
    app = await buildTestApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('GET /backends', () => {
    it('should return list of backends from memory cache', async () => {
      const backend1 = createMockBackend({ name: 'Backend 1' });
      const backend2 = createMockBackend({ name: 'Backend 2' });
      hoisted.backend.list.mockReturnValue([backend1, backend2]);

      const response = await app.inject({
        method: 'GET',
        url: '/backends',
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveLength(2);
      expect(data[0].name).toBe('Backend 1');
      expect(data[1].name).toBe('Backend 2');
    });

    it('should return empty array when no backends exist', async () => {
        hoisted.backend.list.mockReturnValue([]);
        const response = await app.inject({
            method: 'GET',
            url: '/backends',
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual([]);
    });

    it('should return 500 if cache access fails', async () => {
        hoisted.backend.list.mockImplementation(() => { throw new Error('Cache Error'); });
        const response = await app.inject({
            method: 'GET',
            url: '/backends',
        });
        expect(response.statusCode).toBe(500);
    });
  });

  describe('GET /backends/:id', () => {
    it('should return single backend by ID', async () => {
      const backend = createMockBackend({ name: 'Specific Backend' });
      hoisted.backend.get.mockReturnValue(backend);

      const encodedId = encodeURIComponent(backend.$id);
      const response = await app.inject({
        method: 'GET',
        url: `/backends/${encodedId}`,
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.name).toBe('Specific Backend');
      expect(response.headers.etag).toBe(`"${backend.dateModified}"`);
      expect(response.headers['last-modified']).toBe(new Date(backend.dateModified as string).toUTCString());
    });

    it('should return 404 when backend not found', async () => {
        hoisted.backend.get.mockReturnValue(null);
        const nonExistentId = 'urn:sqlib:backend:nonexistent';
        const encodedId = encodeURIComponent(nonExistentId);
        
        const response = await app.inject({
            method: 'GET',
            url: `/backends/${encodedId}`,
        });

        expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /backends', () => {
    it('should create backend with auto-generated ID', async () => {
      const requestData = {
        name: 'New Backend',
        backendType: 'http',
        endpoint: 'http://new.example.com/sparql'
      };
      const createdBackend = {
        ...requestData,
        backendType: BackendTypeIri.http,
        $id: 'urn:sqlib:backend:test-uuid-123',
        dateCreated: '2024-01-01T00:00:00.000Z',
        dateModified: '2024-01-01T00:00:00.000Z',
        authEnvKey: 'NEW_BACKEND',
      };
      hoisted.backend.create.mockResolvedValue(createdBackend);

      const response = await app.inject({
        method: 'POST',
        url: '/backends',
        payload: requestData,
      });

      expect(response.statusCode).toBe(201);
      expect(hoisted.backend.create).toHaveBeenCalledWith(expect.objectContaining({
        name: requestData.name,
        backendType: BackendTypeIri.http,
        endpoint: requestData.endpoint,
        authEnvKey: 'NEW_BACKEND',
      }));
      const data = response.json();
      expect(data.id).toBe('urn:sqlib:backend:test-uuid-123');
      expect(response.headers.etag).toBe(`"${createdBackend.dateModified}"`);
      expect(response.headers['last-modified']).toBe(new Date(createdBackend.dateModified).toUTCString());
    });

    it('should return 500 if backend creation fails', async () => {
        hoisted.backend.create.mockRejectedValue(new Error('Create failed'));
        const requestData = {
            name: 'Failing Backend',
            backendType: 'http',
            endpoint: 'http://fail.example.com/sparql',
        };

        const response = await app.inject({
            method: 'POST',
            url: '/backends',
            payload: requestData,
        });

        expect(response.statusCode).toBe(500);
    });
  });

  describe('PUT /backends/:id', () => {
    it('should update existing backend', async () => {
      const backendId = 'urn:sqlib:backend:update-test';
      const updateData = { name: 'Updated Name' };
      const currentBackend = {
        $id: backendId,
        name: 'Original Name',
        backendType: BackendTypeIri.http,
        endpoint: 'http://test.example.com/sparql',
        dateModified: '2024-01-01T00:00:00.000Z',
        '@type': 'Backend',
      };
      const updatedBackend = {
        $id: backendId,
        name: 'Updated Name',
        backendType: BackendTypeIri.http,
        endpoint: 'http://test.example.com/sparql',
        dateModified: '2024-01-02T00:00:00.000Z',
        '@type': 'Backend',
      };
      hoisted.backend.get.mockReturnValue(currentBackend);
      hoisted.backend.update.mockResolvedValue(updatedBackend);

      const encodedId = encodeURIComponent(backendId);
      const response = await app.inject({
        method: 'PUT',
        url: `/backends/${encodedId}`,
        payload: updateData,
        headers: { 'if-match': currentBackend.dateModified },
      });

      expect(response.statusCode).toBe(200);
      expect(hoisted.backend.update).toHaveBeenCalledWith(backendId, updateData);
      const data = response.json();
      expect(data.name).toBe('Updated Name');
      expect(response.headers.etag).toBe(`"${updatedBackend.dateModified}"`);
      expect(response.headers['last-modified']).toBe(new Date(updatedBackend.dateModified).toUTCString());
    });

    it('should return 404 when updating non-existent backend', async () => {
        hoisted.backend.get.mockReturnValue(null);
        hoisted.backend.update.mockResolvedValue(null);
        const nonExistentId = 'urn:sqlib:backend:nonexistent';
        const encodedId = encodeURIComponent(nonExistentId);

        const response = await app.inject({
            method: 'PUT',
            url: `/backends/${encodedId}`,
            payload: { name: 'Updated Name' },
        });

        expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /backends/:id', () => {
    it('should delete backend successfully', async () => {
      const backendId = 'urn:sqlib:backend:delete-test';
      hoisted.backend.get.mockReturnValue({ $id: backendId });
      hoisted.backend.delete.mockResolvedValue(undefined);

      const encodedId = encodeURIComponent(backendId);
      const response = await app.inject({
        method: 'DELETE',
        url: `/backends/${encodedId}`,
      });

      expect(response.statusCode).toBe(204);
      expect(hoisted.backend.delete).toHaveBeenCalledWith(backendId);
    });

    it('should return 500 if deletion fails', async () => {
      const backendId = 'urn:sqlib:backend:fail-delete';
      hoisted.backend.get.mockReturnValue({ $id: backendId });
      hoisted.backend.delete.mockRejectedValue(new Error('Delete failed'));
      const response = await app.inject({
        method: 'DELETE',
        url: `/backends/${encodeURIComponent(backendId)}`,
      });
      expect(response.statusCode).toBe(500);
    });
  });

  describe('Schema Validation', () => {
    it('should reject POST with missing name', async () => {
      const invalidPayload = {
        backendType: BackendTypeIri.http,
        endpoint: 'http://test.com/sparql',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/backends',
        payload: invalidPayload,
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
