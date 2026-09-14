/**
 * 🤖 This file is auto-generated from LDKit schemas.
 * Do not edit manually - run 'npm run generate-schemas' instead.
 */
import { z } from 'zod';
import { isIri, IRI_ERROR_MESSAGE } from '../iri.js';

const iriString = z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE);

/**
 * Strip redundant propertyNames subschemas of the form { type: 'string' }.
 *
 * z.record(z.string(), ...) emits this, but JSON object keys are always
 * strings, so it constrains nothing. Meanwhile fast-json-stringify annotates it
 * with fjs_type / object type when building a response serializer, which makes
 * Fastify's strict Ajv log, on every response containing such a record:
 *   type "object" not allowed by context "string" at .../propertyNames
 * Value types are still enforced by additionalProperties, so dropping the
 * redundant form is lossless. A propertyNames carrying real constraints (e.g.
 * pattern) is left untouched.
 */
const sparqlBindingValueSchema = z
  .object({
    type: z.enum(['uri', 'literal']),
    value: z.string(),
    'xml:lang': z.string().optional(),
    datatype: iriString.optional(),
  })
  .strict();

const sparqlBindingSchema = z.union([
  z.record(z.string(), sparqlBindingValueSchema.nullable()),
  z.null(),
]);

const executionArgumentHeadSchema = z
  .object({
    vars: z.array(z.string()),
  })
  .strict();

const executionArgumentPayloadSchema = z
  .object({
    bindings: z.array(sparqlBindingSchema),
  })
  .strict();

export const executionArgumentSchema = z
  .object({
    head: executionArgumentHeadSchema,
    arguments: executionArgumentPayloadSchema,
    whenEmpty: z.enum(['unconstrained', 'propagateEmpty', 'require']).optional(),
  })
  .strict();

export type ExecutionArgument = z.infer<typeof executionArgumentSchema>;

/** One LIMIT or OFFSET parameter. Exported: `POST /sparql` takes the same list. */
export const executionParameterSchema = z
  .object({
    name: z.string(),
    value: z.number().int().min(0),
  })
  .strict();

const executionLimitSchema = executionParameterSchema;
const executionOffsetSchema = executionParameterSchema;

/**
 * One data graph a run hands to a query group's start node.
 *
 * The RDF counterpart of `arguments`: a start node declares tuple inputs and
 * data graph inputs independently, so a run may carry both. `port` names which
 * declared input the graph fills, by IRI or by name; omit it when the group
 * declares a single one, or supply the graphs in declaration order.
 *
 * Exactly one of three ways in, the same three every input slot takes:
 * `dataGraphVersionId` pins an immutable version, so the run is reproducible;
 * `dataGraphId` names the graph and floats to whatever its current version is;
 * `dataGraphInline` is ephemeral RDF, never written to the library.
 */
export const executionDataGraphSchema = z
  .object({
    port: z.string().min(1).optional(),
    dataGraphVersionId: iriString.optional(),
    dataGraphId: iriString.optional(),
    dataGraphInline: z.string().optional(),
    dataGraphInlineFormat: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasInline = typeof data.dataGraphInline === 'string' && data.dataGraphInline.trim().length > 0;
    const supplied = [Boolean(data.dataGraphVersionId), Boolean(data.dataGraphId), hasInline].filter(Boolean).length;
    if (supplied !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataGraphVersionId'],
        message: 'Each data graph needs exactly one of dataGraphVersionId, dataGraphId or dataGraphInline',
      });
    }
  });

export type ExecutionDataGraph = z.infer<typeof executionDataGraphSchema>;

export const executionRequestSchema = z
  .object({
    targetId: iriString,
    backendId: iriString.optional(),
    arguments: z.array(executionArgumentSchema).optional(),
    limits: z.array(executionLimitSchema).optional(),
    offsets: z.array(executionOffsetSchema).optional(),
    argumentSetIds: z.array(iriString).optional(),
    dataGraphs: z.array(executionDataGraphSchema).optional(),
    nodeDetail: z.enum(['timings', 'results']).optional(),
  })
  .strict();
/*
 * A run may name argument sets *and* supply inline values, for the parameters
 * those sets leave open. This carried a superRefine refusing the combination
 * outright; that is no longer the rule, and it could not have been expressed
 * here anyway: whether a value overlaps depends on what the named sets actually
 * fill, which the route knows and a shape schema cannot. The execute route
 * refuses an overlap per parameter, naming it. See docs/concepts.md.
 */

export type ExecutionRequest = z.infer<typeof executionRequestSchema>;
export const executionQuerystringSchema = z
  .object({
    targetId: iriString,
    backendId: iriString.optional(),
    arguments: z.string().optional(),
    limits: z.string().optional(),
    offsets: z.string().optional(),
    argumentSetIds: z.string().optional(),
    /*
     * JSON, like the four above. Present for parity with the POST body: a group
     * run that needed a data graph could only be expressed one way round, and a
     * caller reaching for GET had no way to say so at all.
     */
    dataGraphs: z.string().optional(),
    nodeDetail: z.enum(['timings', 'results']).optional(),
  })
  .strict();

export type ExecutionQuerystring = z.infer<typeof executionQuerystringSchema>;
export const executionResponseSchema = z.any();
export type ExecutionResponse = z.infer<typeof executionResponseSchema>;

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    failedNodeId: { type: 'string' },
    failedNodeName: { type: 'string' },
    nodes: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
  required: ['error'],
  additionalProperties: false,
} as const;


