/**
 * Benchmark Contract Definition Builder
 *
 * Builds a ContractDefinition for Benchmark entities from OpenAPI schemas.
 */

import type { ContractDefinition, ZodReusableType, ZodSchemaDefinition } from './contract-types.js';

export function buildBenchmarkContractDefinition(
  experimentSchema: any,
  versionSchema: any,
): ContractDefinition {
  const reusableTypes: ZodReusableType[] = [
    {
      name: 'iriString',
      definition: `z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE)`,
      comment: 'IRI validation — the one definition, shared with the server (contracts/src/iri.ts)',
    },
    { name: 'optionalIriString', definition: 'iriString.optional().nullable()' },
    { name: 'isoDateTime', definition: `z.string().datetime({ offset: true }).optional().nullable()` },
    { name: 'nullableString', definition: 'z.string().optional().nullable()' },
    { name: 'nullableInteger', definition: 'z.number().int().optional().nullable()' },
  ];

  reusableTypes.push({
    name: 'benchmarkExperimentShape',
    definition: `{
  id: iriString,
  name: z.string().min(1, 'Name is required'),
  description: nullableString,
  status: nullableString,
  currentVersion: optionalIriString,
  currentVersionNumber: nullableInteger,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
}`,
    /*
     * This shape is a string literal rather than a projection of the entity
     * schema — this builder predates the generic one and was never folded into
     * ENTITY_CONTRACT_MODELS. So `currentVersionNumber`, which the model now
     * declares as a projection and every read returns, has to be written out
     * here by hand; for the seven entities the generic builder covers it
     * appears on its own. Folding this leaf in would remove the need.
     */
    comment: 'Reusable field definitions for BenchmarkExperiment',
  });

  reusableTypes.push({
    name: 'benchmarkSubjectSpecShape',
    definition: `{
  subject: iriString,
  inputs: z.array(iriString).optional(),
  backends: z.array(iriString).optional(),
  dataGraphs: z.array(iriString).optional(),
}`,
    comment: 'Subject spec shape for BenchmarkExperimentVersion',
  });

  reusableTypes.push({
    name: 'benchmarkExperimentVersionShape',
    definition: `{
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
}`,
    comment: 'Reusable field definitions for BenchmarkExperimentVersion',
  });

  reusableTypes.push({
    name: 'benchmarkRunShape',
    definition: `{
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
}`,
    /*
     * `structure`, `name` and `description` are on the wire — the run route's
     * note records that a run response carries `structure` today — and this
     * shape is `.strict()` and parses those responses, so omitting them threw
     * `unrecognized_keys` on every real run. Written out by hand for the same
     * reason as the shape above: this builder is string literals, not a
     * projection.
     *
     * `structure` is optional here where the model has it required, because
     * this shape reads responses rather than writing them: a run record
     * stored without the predicate would otherwise throw on arrival and empty
     * the list it was filling, which is the failure this whole field set was
     * added to fix.
     */
    comment: 'Reusable field definitions for BenchmarkRun',
  });

  reusableTypes.push({
    name: 'benchmarkObservationShape',
    definition: `{
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
}`,
    comment: 'Reusable field definitions for BenchmarkObservation',
  });

  reusableTypes.push({
    name: 'benchmarkNodeObservationShape',
    definition: `{
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
}`,
    comment: 'Reusable field definitions for BenchmarkNodeObservation',
  });

  reusableTypes.push({
    name: 'benchmarkIterationObservationShape',
    definition: `{
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
}`,
    /*
     * No `node` and no `backend`, unlike the node observation above. An
     * iteration has no library object to name and a rule set has no store axis,
     * so the identity is ordinal — `iterationIndex` within the run, `stratum`
     * saying which layer it belongs to.
     */
    comment: 'Reusable field definitions for BenchmarkIterationObservation',
  });

  const schemas: ZodSchemaDefinition[] = [
    {
      name: 'benchmarkExperimentSchema',
      fields: [{ name: '', zodType: 'z.object(benchmarkExperimentShape)', required: true }],
      strict: true,
      comment: 'Full BenchmarkExperiment schema',
    },
    {
      name: 'benchmarkExperimentCreateSchema',
      fields: [
        {
          name: '',
          zodType: `z.object({
  name: benchmarkExperimentShape.name,
  description: benchmarkExperimentShape.description,
  status: benchmarkExperimentShape.status,
  id: iriString.optional(),
})`,
          required: true,
        },
      ],
      strict: true,
      comment: 'BenchmarkExperiment creation schema',
    },
    {
      name: 'benchmarkExperimentUpdateSchema',
      fields: [
        {
          name: '',
          zodType: `z.object(benchmarkExperimentShape).partial().omit({ id: true, currentVersionNumber: true, dateCreated: true, dateModified: true })`,
          required: true,
        },
      ],
      strict: true,
      comment: 'BenchmarkExperiment update schema',
      refinements: [
        {
          type: 'refine',
          code: `(data) => Object.keys(data).length > 0, {
    message: 'Update must include at least one field',
    path: [],
  }`,
        },
      ],
    },
    {
      name: 'benchmarkExperimentVersionSchema',
      fields: [{ name: '', zodType: 'z.object(benchmarkExperimentVersionShape)', required: true }],
      strict: true,
      comment: 'Full BenchmarkExperimentVersion schema',
    },
    {
      name: 'benchmarkExperimentVersionCreateSchema',
      fields: [
        {
          name: '',
          zodType: `z.object({
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
})`,
          required: true,
        },
      ],
      strict: true,
      comment: 'BenchmarkExperimentVersion creation schema',
    },
    {
      name: 'benchmarkExperimentVersionUpdateSchema',
      fields: [
        {
          name: '',
          zodType: `benchmarkExperimentVersionCreateSchema.partial()`,
          required: true,
        },
      ],
      strict: true,
      comment: 'BenchmarkExperimentVersion update schema',
      refinements: [
        {
          type: 'refine',
          code: `(data) => Object.keys(data).length > 0, {
    message: 'Update must include at least one field',
    path: [],
  }`,
        },
      ],
    },
    {
      name: 'benchmarkRunSchema',
      fields: [{ name: '', zodType: 'z.object(benchmarkRunShape)', required: true }],
      strict: true,
      comment: 'Full BenchmarkRun schema',
    },
    {
      name: 'benchmarkObservationSchema',
      fields: [{ name: '', zodType: 'z.object(benchmarkObservationShape)', required: true }],
      strict: true,
      comment: 'Full BenchmarkObservation schema',
    },
    {
      name: 'benchmarkNodeObservationSchema',
      fields: [{ name: '', zodType: 'z.object(benchmarkNodeObservationShape)', required: true }],
      strict: true,
      comment: 'Full BenchmarkNodeObservation schema',
    },
    {
      name: 'benchmarkIterationObservationSchema',
      fields: [{ name: '', zodType: 'z.object(benchmarkIterationObservationShape)', required: true }],
      strict: true,
      comment: 'Full BenchmarkIterationObservation schema',
    },
    {
      name: 'benchmarkRunResponseSchema',
      fields: [
        {
          name: '',
          zodType: `z.object({
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
})`,
          required: true,
        },
      ],
      strict: true,
      comment: 'Benchmark run execution response',
    },
  ];

  const typeExports = [
    { name: 'BenchmarkExperiment', zodSchemaName: 'benchmarkExperimentSchema' },
    { name: 'BenchmarkExperimentCreate', zodSchemaName: 'benchmarkExperimentCreateSchema' },
    { name: 'BenchmarkExperimentUpdate', zodSchemaName: 'benchmarkExperimentUpdateSchema' },
    { name: 'BenchmarkExperimentVersion', zodSchemaName: 'benchmarkExperimentVersionSchema' },
    { name: 'BenchmarkExperimentVersionCreate', zodSchemaName: 'benchmarkExperimentVersionCreateSchema' },
    { name: 'BenchmarkExperimentVersionUpdate', zodSchemaName: 'benchmarkExperimentVersionUpdateSchema' },
    { name: 'BenchmarkRun', zodSchemaName: 'benchmarkRunSchema' },
    { name: 'BenchmarkObservation', zodSchemaName: 'benchmarkObservationSchema' },
    { name: 'BenchmarkNodeObservation', zodSchemaName: 'benchmarkNodeObservationSchema' },
    { name: 'BenchmarkIterationObservation', zodSchemaName: 'benchmarkIterationObservationSchema' },
    { name: 'BenchmarkRunResponse', zodSchemaName: 'benchmarkRunResponseSchema' },
  ];

  const errorResponseSchema = { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false };
  const idParamsSchema = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false };
  const versionParamsSchema = { type: 'object', properties: { id: { type: 'string' }, version: { type: 'string' } }, required: ['id', 'version'], additionalProperties: false };

  return {
    entityName: 'Benchmark',
    imports: {
      external: [
        { from: 'zod', imports: ['z'] },
        // Relative, and not from the package root: the root barrel is this
        // module's own sibling. `isIri` is what the server registers as ajv's
        // `iri` format, so the leaf and the endpoint agree by construction.
        { from: '../iri.js', imports: ['isIri', 'IRI_ERROR_MESSAGE'] },
      ],
    },
    reusableTypes,
    schemas,
    typeExports,
    customBlocks: [
      {
        position: 'before-schemas',
        code: `
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

`,
      },
    ],
  };
}
