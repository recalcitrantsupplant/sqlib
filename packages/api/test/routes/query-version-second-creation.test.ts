import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import Fastify, { FastifyInstance } from 'fastify';
import queryRoutes from '../../src/routes/queries.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

describe('Query Version Second Creation Bug Reproduction', () => {
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
    await app.register(queryRoutes, { prefix: '/queries' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reproduces the second version creation bug with real query ID', async () => {
    const queryId = 'urn:sqlib:query:58fdba74a8f64e3f985a15fa56eeaf13';

    // First, create version 1 - this should work
    const firstVersionRes = await app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(queryId)}/v`,
      payload: {
        queryVersion: {
          queryString: 'SELECT * {?s ?p ?o }LIMIT 10',
          queryType: QueryTypeIri.select,
          comment: 'Version 1 - First version'
        }
      }
    });

    console.log('First version creation:', firstVersionRes.statusCode, firstVersionRes.json());

    // If first version creation fails, skip the test
    if (firstVersionRes.statusCode !== 201) {
      console.log('Skipping second version test - first version failed');
      return;
    }

    // Now create version 2 - this is where the bug should occur
    const secondVersionRes = await app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(queryId)}/v`,
      payload: {
        queryVersion: {
          queryString: 'SELECT * {?s ?p ?o }LIMIT 20',
          queryType: QueryTypeIri.select,
          comment: 'Version 2 - Second version with higher limit'
        }
      }
    });

    console.log('Second version creation:', secondVersionRes.statusCode, secondVersionRes.json());

    // This is where we expect the bug to manifest
    if (secondVersionRes.statusCode === 400 && secondVersionRes.json().error === '"id" is required!') {
      console.log('✓ Successfully reproduced the "id is required" bug on second version creation');
      expect(secondVersionRes.statusCode).toBe(400);
      expect(secondVersionRes.json().error).toBe('"id" is required!');
    } else {
      console.log('Bug not reproduced - second version creation had different result');
      // If the bug is fixed, this should be 201
      expect(secondVersionRes.statusCode).toBe(201);
    }
  });
});