import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import Fastify, { FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

describe('Schema Validation for Query Version Creation', () => {
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
            return `"${err.params?.missingProperty || 'Field'}" is required!`;
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

    // Create a simple test route that uses the createQueryVersionForQuerySchema validation
    app.post(
      '/test-validation/:id/v',
      { schema: schemas.createQueryVersionForQuerySchema as any },
      async (request, reply) => {
        // Just return success if validation passes
        return reply.status(200).send({ success: true });
      }
    );

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows queryVersion object with id field (should pass validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test-validation/test-query-id/v',
      payload: {
        queryVersion: {
          id: 'urn:sqlib:query-version:custom-id',
          queryString: 'SELECT * {?s ?p ?o }LIMIT 10',
          queryType: QueryTypeIri.select,
          comment: 'Version 1 - Basic city population query with parameterization'
        }
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });
});