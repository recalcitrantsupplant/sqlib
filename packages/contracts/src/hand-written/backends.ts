/**
 * Backend wire contracts beyond the entity itself: what the server observed
 * when it probed a store, the store's own prefix map, the environment a
 * backend's credentials come from, and what references a backend.
 *
 * None of these is stored, so there is no entity model to project them from.
 */
import { z } from 'zod';

/*
 * Backend observations — what the server saw when it last asked the store for
 * its service description. Never persisted, so a fresh server legitimately has
 * nothing to say about a backend that has existed for months.
 */
export const backendProbeSchema = z.object({
  backendId: z.string(),
  health: z.enum(['healthy', 'slow', 'unreachable']),
  latencyMs: z.number().nullable(),
  product: z.string().nullable(),
  probedAt: z.string(),
  error: z.string().nullable(),
  /** What the endpoint answered with, when it answered. Null when nothing did. */
  httpStatus: z.number().nullable().optional().default(null),
  /**
   * Whether the store exposes its own prefix map, and whether we may write it.
   * Null when the probe could not establish it — an unreachable store, an
   * in-process one, or detection switched off server-side — which is not the
   * same as `read: null`, which means we asked and found nothing.
   */
  prefixes: z
    .object({
      read: z.enum(['jena-prefixes', 'turtle-scrape']).nullable(),
      write: z.literal('jena-prefixes').nullable(),
      readEndpoint: z.string().nullable(),
      writeEndpoint: z.string().nullable(),
      count: z.number().nullable(),
    })
    .nullable()
    .optional()
    .default(null),
});

export const backendProbeListSchema = z.object({ probes: z.array(backendProbeSchema) });

export const remotePrefixesSchema = z.object({
  mappings: z.array(z.object({ prefix: z.string(), namespace: z.string() })),
  source: z.enum(['jena-prefixes', 'turtle-scrape']),
  readOnly: z.boolean(),
  endpoint: z.string().nullable(),
});

export const prefixPushSchema = z.object({
  results: z.array(z.object({
    prefix: z.string(),
    action: z.enum(['upsert', 'delete']),
    status: z.enum(['ok', 'failed']),
    error: z.string().optional(),
  })),
  applied: z.number(),
  failed: z.number(),
});

export const backendEnvSchema = z.object({
  authEnvKey: z.string().nullable(),
  variables: z.array(z.object({
    name: z.string(),
    role: z.string(),
    // Presence only. A value never crosses this boundary.
    set: z.boolean(),
  })),
});

const backendUsageGroupSchema = z.object({
  count: z.number(),
  sample: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const backendUsageSchema = z.object({
  queries: backendUsageGroupSchema,
  queryGroups: backendUsageGroupSchema,
  benchmarks: backendUsageGroupSchema,
  libraries: backendUsageGroupSchema,
  // Older servers do not count ETL jobs; read their absence as none.
  etlJobs: backendUsageGroupSchema.default({ count: 0, sample: [] }),
});

export type BackendProbe = z.infer<typeof backendProbeSchema>;
export type BackendPrefixCapability = NonNullable<BackendProbe['prefixes']>;
export type RemotePrefixes = z.infer<typeof remotePrefixesSchema>;
export type PrefixPushResult = z.infer<typeof prefixPushSchema>;
export type BackendEnv = z.infer<typeof backendEnvSchema>;
export type BackendUsage = z.infer<typeof backendUsageSchema>;

const namedRefSchema = z.object({ id: z.string(), name: z.string() });

/** What refers to a backend: `GET /backends/:id/references`. */
export const backendReferencesSchema = z.object({
  libraries: z.array(namedRefSchema),
  queries: z.array(namedRefSchema),
  // Older servers do not list ETL jobs; read their absence as none.
  etlJobs: z.array(namedRefSchema).default([]),
});

export type BackendReferences = z.infer<typeof backendReferencesSchema>;
