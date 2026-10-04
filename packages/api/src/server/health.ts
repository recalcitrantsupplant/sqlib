/**
 * `GET /health`: readiness plus what a client feature-detects from (auth mode,
 * read-only, upload caps). 200 when the entity cache is loaded, 503 before.
 */
import type { FastifyInstance } from 'fastify';
import { memoryCacheManager } from '../lib/MemoryCacheManager.js';
import { getAuthConfig } from '../auth/config.js';
import { isReadOnlyDeployment } from '../config/readOnly.js';
import {
  MAX_DATA_GRAPH_LIBRARY_BYTES,
  MAX_DATA_GRAPH_VERSION_BYTES,
} from '../lib/dataGraphContent.js';
import {
  MAX_TUPLE_SET_LIBRARY_BYTES,
  MAX_TUPLE_SET_VERSION_BYTES,
} from '../lib/TupleSetVersionWriter.js';

export function getHealthPayload() {
  const cacheStats = memoryCacheManager.getStats();
  const ready = memoryCacheManager.isReady();

  return {
    status: ready ? 'ok' : 'not_ready',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    // Clients feature-detect from here: the SPA skips its login flow entirely
    // when auth is disabled, so it works unchanged on both sides of the flip.
    auth: {
      mode: getAuthConfig().mode,
    },
    /*
     * Feature-detected the same way, and for the same reason: the SPA turns
     * Save into "keep in this browser" when this is true, so a build pointed at
     * a read-only deployment must not offer a button the server will refuse.
     */
    readOnly: isReadOnlyDeployment(),
    cache: {
      ready,
      totalEntities: cacheStats.totalEntities,
      estimatedMemoryBytes: cacheStats.estimatedMemoryBytes,
    },
    /*
     * What the server will accept, so a client can say so before it asks. Both
     * caps are environment-tunable, which is exactly why they are reported: the
     * SPA used to state a figure of its own, and a deployment that raised the
     * server's had a UI still refusing uploads at the old one.
     */
    limits: {
      dataGraphVersionBytes: MAX_DATA_GRAPH_VERSION_BYTES,
      dataGraphLibraryBytes: MAX_DATA_GRAPH_LIBRARY_BYTES,
      tupleSetVersionBytes: MAX_TUPLE_SET_VERSION_BYTES,
      tupleSetLibraryBytes: MAX_TUPLE_SET_LIBRARY_BYTES,
    },
  };
}

/**
 * The one shape both statuses answer with. It was written out twice, once per
 * status, and a field added to one copy and not the other is a field the
 * serializer silently drops from that status.
 */
const healthResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    timestamp: { type: 'string' },
    uptimeSeconds: { type: 'integer' },
    auth: {
      type: 'object',
      properties: {
        mode: { type: 'string' },
      },
      required: ['mode'],
    },
    // Declared, or Fastify's serialiser drops it and the SPA reads a
    // read-only deployment as writable — see `useDeploymentMode`.
    readOnly: { type: 'boolean' },
    cache: {
      type: 'object',
      properties: {
        ready: { type: 'boolean' },
        totalEntities: { type: 'integer' },
        estimatedMemoryBytes: { type: 'integer' },
      },
      required: ['ready', 'totalEntities', 'estimatedMemoryBytes'],
    },
    limits: {
      type: 'object',
      properties: {
        dataGraphVersionBytes: { type: 'integer' },
        dataGraphLibraryBytes: { type: 'integer' },
        tupleSetVersionBytes: { type: 'integer' },
        tupleSetLibraryBytes: { type: 'integer' },
      },
      required: [
        'dataGraphVersionBytes',
        'dataGraphLibraryBytes',
        'tupleSetVersionBytes',
        'tupleSetLibraryBytes',
      ],
    },
  },
  required: ['status', 'timestamp', 'uptimeSeconds', 'auth', 'readOnly', 'cache', 'limits'],
} as const;

export function registerHealthRoute(fastifyApp: FastifyInstance): void {
  fastifyApp.get(
    '/health',
    {
      schema: {
        tags: ['Utility'],
        summary: 'Health check',
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const payload = getHealthPayload();
      const statusCode = payload.cache.ready ? 200 : 503;
      return reply.status(statusCode).send(payload);
    }
  );
}
