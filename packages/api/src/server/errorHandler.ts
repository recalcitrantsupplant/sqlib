/**
 * The global error handler: what an error no route answered becomes.
 *
 * A schema-validation failure is answered with every field it names; anything
 * else gets the same body a route wrapper gives (`errorResponseFor`), so a
 * refusal reads the same whether a handler caught it or it reached this hook.
 */
import type { FastifyError, FastifyInstance } from 'fastify';
import { errorResponseFor } from '../routes/route-helpers.js';

export function registerErrorHandler(fastifyApp: FastifyInstance): void {
  fastifyApp.setErrorHandler((error: FastifyError, request, reply) => {
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

    // Structured, on the request logger so the line carries the request id;
    // `err` is serialised with its message and stack.
    request.log.error({ err: error, ...errorContext }, 'Global error handler triggered');

    // Don't send response if already sent
    if (reply.sent) {
      return;
    }

    const statusCode = error.statusCode || 500;

    // Handle validation errors with enhanced details
    if (error.validation && Array.isArray(error.validation)) {
      const validationErrors = error.validation.map((err: { instancePath?: string; dataPath?: string; params?: { missingProperty?: string; type?: string; format?: string }; keyword?: string; message?: string }) => {
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

    const { body } = errorResponseFor(request, error);
    reply.status(statusCode).send(body);
  });
}
