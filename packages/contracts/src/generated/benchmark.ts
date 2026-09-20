/**
 * 🤖 This file is auto-generated from LDKit schemas.
 * Do not edit manually - run 'npm run generate-schemas' instead.
 */
import { z } from "zod";
import { isIri, IRI_ERROR_MESSAGE } from "../iri.js";

/**
 * Strip redundant propertyNames subschemas of the form { type: 'string' }.
 * See the note in generate-schemas.ts: JSON object keys are always strings, so
 * this constrains nothing, but fast-json-stringify annotates it with fjs_type /
 * object type when building a response serializer, which makes Fastify's strict
 * Ajv log a type-context warning on every such response. Value types remain
 * enforced by additionalProperties, so removing the redundant form is lossless.
 */
function stripRedundantPropertyNames(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) stripRedundantPropertyNames(item);
    return;
  }
  const obj = node as Record<string, any>;
  const pn = obj.propertyNames;
  if (pn && typeof pn === 'object' && !Array.isArray(pn)) {
    const keys = Object.keys(pn);
    if (keys.length === 1 && keys[0] === 'type' && pn.type === 'string') {
      delete obj.propertyNames;
    }
  }
  for (const value of Object.values(obj)) stripRedundantPropertyNames(value);
}
// IRI validation — the one definition, shared with the server (contracts/src/iri.ts)
const iriString = z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE);
const optionalIriString = iriString.optional().nullable();
const isoDateTime = z.string().datetime({ offset: true }).optional().nullable();
const nullableString = z.string().optional().nullable();
const nullableInteger = z.number().int().optional().nullable();
// Reusable field definitions for BenchmarkExperiment
const benchmarkExperimentShape = {
  id: iriString,
  name: z.string().min(1, 'Name is required'),
  description: nullableString,
  status: nullableString,
  currentVersion: optionalIriString,
  currentVersionNumber: nullableInteger,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// Subject spec shape for BenchmarkExperimentVersion
const benchmarkSubjectSpecShape = {
  subject: iriString,
  inputs: z.array(iriString).optional(),
  backends: z.array(iriString).optional(),
  dataGraphs: z.array(iriString).optional(),
};
// Reusable field definitions for BenchmarkExperimentVersion
const benchmarkExperimentVersionShape = {
  id: iriString,
  isPartOf: iriString,
  version: z.number().int(),
  immutable: z.boolean().optional().nullable(),
  subjectSpecs: z.array(z.object(benchmarkSubjectSpecShape)),
  repeats: z.number().int().optional().nullable(),
  executionStrategy: nullableString,
  timeWindow: nullableString,
  maxConcurrency: z.number().int().optional().nullable(),
  warmupRuns: z.number().int().optional().nullable(),
  cooldownMs: z.number().int().optional().nullable(),
  timeoutMs: z.number().int().optional().nullable(),
  retryCount: z.number().int().optional().nullable(),
  retryDelayMs: z.number().int().optional().nullable(),
  randomizeOrder: z.boolean().optional().nullable(),
  abortOnError: z.boolean().optional().nullable(),
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// Reusable field definitions for BenchmarkRun
const benchmarkRunShape = {
  id: iriString,
  definedBy: iriString,
  structure: optionalIriString,
  name: nullableString,
  description: nullableString,
  runStatus: z.string(),
  tasksTotal: z.number().int(),
  tasksCompleted: z.number().int(),
  keywords: z.array(z.string()).optional().nullable(),
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// Reusable field definitions for BenchmarkObservation
const benchmarkObservationShape = {
  id: iriString,
  dataSet: iriString,
  subject: iriString,
  backend: iriString,
  argumentSet: iriString,
  argumentSetVersion: iriString.optional().nullable(),
  dataGraph: iriString.optional().nullable(),
  dataGraphVersion: iriString.optional().nullable(),
  runIndex: z.number().int(),
  durationMs: z.number(),
  resultCount: z.number().int(),
  success: z.boolean(),
  errorMessage: nullableString,
  errorType: nullableString,
  backendDurationMs: z.number().optional().nullable(),
  queueDelayMs: z.number().optional().nullable(),
  timestamp: z.string().datetime({ offset: true }),
};
// Reusable field definitions for BenchmarkNodeObservation
const benchmarkNodeObservationShape = {
  id: iriString,
  dataSet: iriString,
  groupObservation: iriString,
  node: iriString,
  backend: iriString,
  runIndex: z.number().int(),
  nodeIndex: z.number().int().optional().nullable(),
  durationMs: z.number(),
  resultCount: z.number().int(),
  success: z.boolean(),
  errorMessage: nullableString,
  errorType: nullableString,
  timestamp: z.string().datetime({ offset: true }),
};
// Reusable field definitions for BenchmarkIterationObservation
const benchmarkIterationObservationShape = {
  id: iriString,
  dataSet: iriString,
  subjectObservation: iriString,
  runIndex: z.number().int(),
  iterationIndex: z.number().int(),
  stratum: nullableInteger,
  durationMs: z.number(),
  resultCount: z.number().int(),
  tripleCount: z.number().int(),
  tupleCount: nullableInteger,
  rulesEvaluated: z.number().int(),
  timestamp: z.string().datetime({ offset: true }),
};
// Full BenchmarkExperiment schema
export const benchmarkExperimentSchema = z.object(benchmarkExperimentShape).strict();
// BenchmarkExperiment creation schema
export const benchmarkExperimentCreateSchema = z.object({
  name: benchmarkExperimentShape.name,
  description: benchmarkExperimentShape.description,
  status: benchmarkExperimentShape.status,
  id: iriString.optional(),
}).strict();
// BenchmarkExperiment update schema
export const benchmarkExperimentUpdateSchema = z.object(benchmarkExperimentShape).partial().omit({ id: true, currentVersionNumber: true, dateCreated: true, dateModified: true }).strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Update must include at least one field',
    path: [],
  });
// Full BenchmarkExperimentVersion schema
export const benchmarkExperimentVersionSchema = z.object(benchmarkExperimentVersionShape).strict();
// BenchmarkExperimentVersion creation schema
export const benchmarkExperimentVersionCreateSchema = z.object({
  subjectSpecs: benchmarkExperimentVersionShape.subjectSpecs,
  repeats: benchmarkExperimentVersionShape.repeats,
  executionStrategy: benchmarkExperimentVersionShape.executionStrategy,
  timeWindow: benchmarkExperimentVersionShape.timeWindow,
  maxConcurrency: benchmarkExperimentVersionShape.maxConcurrency,
  warmupRuns: benchmarkExperimentVersionShape.warmupRuns,
  cooldownMs: benchmarkExperimentVersionShape.cooldownMs,
  timeoutMs: benchmarkExperimentVersionShape.timeoutMs,
  retryCount: benchmarkExperimentVersionShape.retryCount,
  retryDelayMs: benchmarkExperimentVersionShape.retryDelayMs,
  randomizeOrder: benchmarkExperimentVersionShape.randomizeOrder,
  abortOnError: benchmarkExperimentVersionShape.abortOnError,
}).strict();
// BenchmarkExperimentVersion update schema
export const benchmarkExperimentVersionUpdateSchema = benchmarkExperimentVersionCreateSchema.partial().strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Update must include at least one field',
    path: [],
  });
// Full BenchmarkRun schema
export const benchmarkRunSchema = z.object(benchmarkRunShape).strict();
// Full BenchmarkObservation schema
export const benchmarkObservationSchema = z.object(benchmarkObservationShape).strict();
// Full BenchmarkNodeObservation schema
export const benchmarkNodeObservationSchema = z.object(benchmarkNodeObservationShape).strict();
// Full BenchmarkIterationObservation schema
export const benchmarkIterationObservationSchema = z.object(benchmarkIterationObservationShape).strict();
// Benchmark run execution response
export const benchmarkRunResponseSchema = z.object({
  run: z.object({
    id: iriString,
    runStatus: z.string(),
    tasksTotal: z.number().int(),
    tasksCompleted: z.number().int(),
  }).passthrough(),
  nodeRun: z.record(z.string(), z.any()).nullable(),
  iterationRun: z.record(z.string(), z.any()).nullable(),
  observations: z.array(z.record(z.string(), z.any())),
  nodeObservations: z.array(z.record(z.string(), z.any())),
  iterationObservations: z.array(z.record(z.string(), z.any())),
}).strict();

export type BenchmarkExperiment = z.infer<typeof benchmarkExperimentSchema>;
export type BenchmarkExperimentCreate = z.infer<typeof benchmarkExperimentCreateSchema>;
export type BenchmarkExperimentUpdate = z.infer<typeof benchmarkExperimentUpdateSchema>;
export type BenchmarkExperimentVersion = z.infer<typeof benchmarkExperimentVersionSchema>;
export type BenchmarkExperimentVersionCreate = z.infer<typeof benchmarkExperimentVersionCreateSchema>;
export type BenchmarkExperimentVersionUpdate = z.infer<typeof benchmarkExperimentVersionUpdateSchema>;
export type BenchmarkRun = z.infer<typeof benchmarkRunSchema>;
export type BenchmarkObservation = z.infer<typeof benchmarkObservationSchema>;
export type BenchmarkNodeObservation = z.infer<typeof benchmarkNodeObservationSchema>;
export type BenchmarkIterationObservation = z.infer<typeof benchmarkIterationObservationSchema>;
export type BenchmarkRunResponse = z.infer<typeof benchmarkRunResponseSchema>;

