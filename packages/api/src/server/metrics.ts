/**
 * `GET /metrics`: a runtime snapshot of the process, the entity cache and the
 * Oxigraph stores. Administrator-only — it exposes store contents and process
 * internals.
 *
 * `GET /telemetry`: whether OpenTelemetry is on and exporting, where to, and
 * the slow runs since start (lib/telemetryStatus.ts). Administrator-only — it
 * names the collector endpoint.
 */
import type { FastifyInstance } from 'fastify';
import { memoryCacheManager } from '../lib/MemoryCacheManager.js';
import { oxigraphStoreManager } from '../lib/OxigraphStoreManager.js';
import { requireAdmin } from '../auth/enforce.js';
import { telemetryStatus } from '../lib/telemetryStatus.js';

export function getMetricsPayload() {
  const cacheStats = memoryCacheManager.getStats();
  const storeStats = Object.fromEntries(
    Array.from(oxigraphStoreManager.getAllStoreStats().entries())
      .sort(([left], [right]) => left.localeCompare(right))
  );

  const oxigraphSummary = Object.values(storeStats).reduce(
    (summary, stats) => {
      summary.totalStores += 1;
      summary.totalTriples += stats.tripleCount;
      summary.totalMemoryBytes += stats.memoryUsage;
      return summary;
    },
    {
      totalStores: 0,
      totalTriples: 0,
      totalMemoryBytes: 0,
    }
  );

  return {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
    },
    cache: cacheStats,
    oxigraph: {
      stores: storeStats,
      summary: oxigraphSummary,
    },
  };
}

export function registerMetricsRoute(fastifyApp: FastifyInstance): void {
  fastifyApp.get(
    '/metrics',
    {
      schema: {
        tags: ['Utility'],
        summary: 'Runtime metrics snapshot',
        response: {
          200: {
            type: 'object',
            properties: {
              timestamp: { type: 'string' },
              uptimeSeconds: { type: 'integer' },
              process: {
                type: 'object',
                properties: {
                  pid: { type: 'integer' },
                  nodeVersion: { type: 'string' },
                  memoryUsage: {
                    type: 'object',
                    additionalProperties: { type: 'integer' },
                  },
                },
                required: ['pid', 'nodeVersion', 'memoryUsage'],
              },
              cache: {
                type: 'object',
                properties: {
                  totalEntities: { type: 'integer' },
                  isLoaded: { type: 'boolean' },
                  estimatedMemoryBytes: { type: 'integer' },
                  entityTypes: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        count: { type: 'integer' },
                        memoryBytes: { type: 'integer' },
                      },
                      required: ['count', 'memoryBytes'],
                    },
                  },
                },
                required: ['totalEntities', 'isLoaded', 'estimatedMemoryBytes', 'entityTypes'],
              },
              oxigraph: {
                type: 'object',
                properties: {
                  stores: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        tripleCount: { type: 'integer' },
                        memoryUsage: { type: 'integer' },
                      },
                      required: ['tripleCount', 'memoryUsage'],
                    },
                  },
                  summary: {
                    type: 'object',
                    properties: {
                      totalStores: { type: 'integer' },
                      totalTriples: { type: 'integer' },
                      totalMemoryBytes: { type: 'integer' },
                    },
                    required: ['totalStores', 'totalTriples', 'totalMemoryBytes'],
                  },
                },
                required: ['stores', 'summary'],
              },
            },
            required: ['timestamp', 'uptimeSeconds', 'process', 'cache', 'oxigraph'],
          },
        },
      },
    },
    async (request, reply) => {
      // Exposes store contents and process internals — admin-only.
      requireAdmin(request, 'reading runtime metrics');
      return reply.send(getMetricsPayload());
    }
  );
}

const nullableString = { type: ['string', 'null'] } as const;

export function registerTelemetryRoute(fastifyApp: FastifyInstance): void {
  fastifyApp.get(
    '/telemetry',
    {
      schema: {
        tags: ['Utility'],
        summary: 'OpenTelemetry status',
        response: {
          200: {
            type: 'object',
            properties: {
              state: { type: 'string', enum: ['off', 'exporting', 'failing'] },
              serviceName: nullableString,
              endpoint: nullableString,
              protocol: nullableString,
              lastExportError: {
                type: ['object', 'null'],
                properties: { at: { type: 'string' }, message: { type: 'string' } },
                required: ['at', 'message'],
              },
              slowRuns: {
                type: 'object',
                properties: {
                  count: { type: 'integer' },
                  lastAt: nullableString,
                  thresholdMs: { type: ['number', 'null'] },
                },
                required: ['count', 'lastAt', 'thresholdMs'],
              },
              detail: { type: 'string', enum: ['ids', 'text', 'text+args'] },
              dashboardUrl: nullableString,
              traceLinks: { type: 'boolean' },
            },
            required: [
              'state', 'serviceName', 'endpoint', 'protocol', 'lastExportError',
              'slowRuns', 'detail', 'dashboardUrl', 'traceLinks',
            ],
          },
        },
      },
    },
    async (request, reply) => {
      requireAdmin(request, 'reading telemetry status');
      return reply.send(telemetryStatus());
    }
  );
}
