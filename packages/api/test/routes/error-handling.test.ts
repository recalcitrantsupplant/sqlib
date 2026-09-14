import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { withCacheHandler } from '../../src/routes/route-helpers.js';
import { MemoryCacheManager } from '../../src/lib/MemoryCacheManager.js';

describe('Error Handling Improvements', () => {
  let app: FastifyInstance;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    // Store original NODE_ENV
    originalEnv = process.env.NODE_ENV;
  });

  afterAll(() => {
    // Restore original NODE_ENV
    if (originalEnv !== undefined) {
      process.env.NODE_ENV = originalEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  beforeEach(async () => {
    if (app) {
      await app.close();
    }
    app = Fastify({ logger: false });
    setupValidator(app);

    // Register schemas
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }

    // Set up the same error handler as the main application
    app.setErrorHandler((error, request, reply) => {
      // Enhanced error logging with structured data
      const errorContext = {
        route: `${request.method} ${request.url}`,
        requestId: request.id,
        statusCode: error.statusCode || 500,
        errorType: error.constructor.name,
        userAgent: request.headers['user-agent'],
        ip: request.ip,
        query: request.query,
        params: request.params,
        replySent: reply.sent
      };

      // Don't send response if already sent
      if (reply.sent) {
        return;
      }

      const statusCode = error.statusCode || 500;

      // Handle validation errors with enhanced details
      if (error.validation && Array.isArray(error.validation)) {
        const validationErrors = error.validation.map((err: any) => {
          const fieldPath = err.instancePath || err.dataPath || '';
          const field = err.params?.missingProperty || fieldPath.replace(/^\//, '') || 'Field';

          if (err.keyword === 'required') {
            return `"${field}" is required`;
          }
          if (err.keyword === 'type') {
            return `"${field}" must be of type ${err.params?.type}`;
          }
          if (err.keyword === 'format') {
            return `"${field}" has invalid format (expected: ${err.params?.format})`;
          }

          return err.message || 'Validation error';
        });

        const errorMessage = validationErrors.length > 0 ? validationErrors[0] : 'Validation failed';
        return reply.status(statusCode).send({
          error: errorMessage,
          validation: validationErrors,
          route: errorContext.route,
          requestId: request.id,
          timestamp: new Date().toISOString()
        });
      }

      // Determine error message based on environment and status code
      let message = error.message || 'An unexpected error occurred';
      let details: any = undefined;

      // In development, provide full error details
      if (process.env.NODE_ENV === 'development') {
        details = {
          stack: error.stack,
          type: error.constructor.name,
          code: (error as any).code,
          context: errorContext
        };
      } else if (statusCode >= 500) {
        // In production, mask server errors but preserve client errors
        message = 'Internal Server Error';
      }

      const errorResponse: any = {
        error: message,
        route: errorContext.route,
        requestId: request.id,
        timestamp: new Date().toISOString()
      };

      if (details) {
        errorResponse.details = details;
      }

      reply.status(statusCode).send(errorResponse);
    });

    // Don't call app.ready() here - let individual tests register routes first
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Global Error Handler', () => {
    it('should preserve error details in development mode', async () => {
      process.env.NODE_ENV = 'development';

      app.get('/test-error', async (request, reply) => {
        throw new Error('Test error message');
      });

      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test-error'
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);

      expect(body.error).toBe('Test error message');
      expect(body.route).toBe('GET /test-error');
      expect(body.requestId).toBeDefined();
      expect(body.timestamp).toBeDefined();
      expect(body.details).toBeDefined();
      expect(body.details.stack).toContain('Test error message');
      expect(body.details.type).toBe('Error');
    });

    it('should mask server errors in production mode', async () => {
      process.env.NODE_ENV = 'production';

      app.get('/test-error', async (request, reply) => {
        throw new Error('Internal database error');
      });

      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test-error'
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);

      expect(body.error).toBe('Internal Server Error');
      expect(body.route).toBe('GET /test-error');
      expect(body.requestId).toBeDefined();
      expect(body.timestamp).toBeDefined();
      expect(body.details).toBeUndefined();
    });

    it('should preserve client error messages in production', async () => {
      process.env.NODE_ENV = 'production';

      app.get('/test-client-error', async (request, reply) => {
        const error = new Error('Bad request data') as any;
        error.statusCode = 400;
        throw error;
      });

      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test-client-error'
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      expect(body.error).toBe('Bad request data');
      expect(body.route).toBe('GET /test-client-error');
    });

    it('should handle validation errors with enhanced details', async () => {
      // Register a test route with validation
      app.post('/test-validation', {
        schema: {
          body: {
            type: 'object',
            required: ['name', 'email'],
            properties: {
              name: { type: 'string' },
              email: { type: 'string', format: 'email' }
            }
          }
        }
      }, async (request, reply) => {
        return { success: true };
      });

      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/test-validation',
        payload: { name: 'test' } // missing email
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      expect(body.error).toContain('email');
      expect(body.error).toContain('required');
      expect(body.validation).toBeDefined();
      expect(body.route).toBe('POST /test-validation');
      expect(body.requestId).toBeDefined();
    });
  });

  describe('withCacheHandler Error Handling', () => {
    it('should preserve original error messages in development', async () => {
      process.env.NODE_ENV = 'development';

      const mockCache = {
        get: vi.fn(),
        getByType: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      } as any;

      const testHandler = withCacheHandler(async ({ cache, request, reply }) => {
        throw new Error('Cache operation failed');
      });

      app.get('/test-cache-error', testHandler);

      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test-cache-error'
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);

      expect(body.error).toBe('Cache operation failed');
      expect(body.route).toBe('GET /test-cache-error');
      expect(body.timestamp).toBeDefined();
      expect(body.details).toBeDefined();
      expect(body.details.stack).toContain('Cache operation failed');
    });

    it('should handle client errors properly', async () => {
      const testHandler = withCacheHandler(async ({ cache, request, reply }) => {
        const error = new Error('Invalid input data') as any;
        error.statusCode = 400;
        throw error;
      });

      app.get('/test-client-cache-error', testHandler);

      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test-client-cache-error'
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      expect(body.error).toBe('Invalid input data');
      expect(body.route).toBe('GET /test-client-cache-error');
    });

    it('should mask server errors in production', async () => {
      process.env.NODE_ENV = 'production';

      const testHandler = withCacheHandler(async ({ cache, request, reply }) => {
        throw new Error('Database connection failed');
      });

      app.get('/test-production-error', testHandler);

      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test-production-error'
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);

      expect(body.error).toBe('Internal Server Error');
      expect(body.details).toBeUndefined();
    });
  });

  describe('MemoryCacheManager Error Modes', () => {
    it('should support error mode configuration', () => {
      const cacheManager = new MemoryCacheManager();

      // Default mode should be 'log'
      expect(() => cacheManager.setErrorMode('log')).not.toThrow();
      expect(() => cacheManager.setErrorMode('throw')).not.toThrow();
    });
  });

  describe('Error Response Structure', () => {
    it('should include all required error response fields', async () => {
      process.env.NODE_ENV = 'development';

      app.get('/test-structure', async (request, reply) => {
        const error = new Error('Test error') as any;
        error.statusCode = 422;
        throw error;
      });

      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test-structure'
      });

      const body = JSON.parse(response.body);

      // Required fields
      expect(body.error).toBeDefined();
      expect(body.route).toBeDefined();
      expect(body.requestId).toBeDefined();
      expect(body.timestamp).toBeDefined();

      // Verify timestamp format
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);

      // Verify route format
      expect(body.route).toBe('GET /test-structure');
    });

    it('should handle non-Error objects', async () => {
      app.get('/test-non-error', async (request, reply) => {
        throw 'String error';
      });

      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/test-non-error'
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);

      // When a non-Error is thrown, Fastify converts it to a generic Error
      // Our error handler should handle this gracefully
      expect(body.error).toBe('An unexpected error occurred');
      expect(body.route).toBe('GET /test-non-error');
      expect(body.timestamp).toBeDefined();
      expect(body.requestId).toBeDefined();
    });
  });
});