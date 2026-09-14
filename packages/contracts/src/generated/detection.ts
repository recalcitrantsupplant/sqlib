/**
 * 🤖 This file is auto-generated from LDKit schemas.
 * Do not edit manually - run 'npm run generate-schemas' instead.
 */
import { z } from 'zod';

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
export const detectQueryRequestSchema = z
  .object({
    query: z.string().min(1, 'Query is required'),
  })
  .strict();

export type DetectQueryRequest = z.infer<typeof detectQueryRequestSchema>;
export const detectInputsResponseSchema = z
  .object({
    valuesInputs: z.array(z.array(z.string()).min(1)).default([]),
    limitParameters: z.array(z.string()).default([]),
    offsetParameters: z.array(z.string()).default([]),
    // Advisory only: parameter groups whose VALUES clause sits inside FILTER EXISTS /
    // NOT EXISTS and reuses an enclosing variable, where SPARQL 1.1 leaves evaluation
    // undefined (SEP-0007). Empty for virtually every query.
    correlatedExistsInputs: z
      .array(
        z
          .object({
            parameters: z.array(z.string()).min(1),
            correlatedVariables: z.array(z.string()).min(1),
          })
          .strict()
      )
      .default([]),
  })
  .strict();

export type DetectInputsResponse = z.infer<typeof detectInputsResponseSchema>;
export const detectOutputsResponseSchema = z.array(z.string());
export type DetectOutputsResponse = z.infer<typeof detectOutputsResponseSchema>;
export const validateQueryResponseSchema = z
  .object({
    valid: z.literal(true),
  })
  .strict();

export type ValidateQueryResponse = z.infer<typeof validateQueryResponseSchema>;
export const validateQueryErrorResponseSchema = z
  .object({
    valid: z.literal(false),
    error: z.string(),
  })
  .strict();

export type ValidateQueryErrorResponse = z.infer<typeof validateQueryErrorResponseSchema>;
export const validateRuleDataRequestSchema = z
  .object({
    ruleOrData: z.string().min(1, 'Rule or data string is required'),
  })
  .strict();

export type ValidateRuleDataRequest = z.infer<typeof validateRuleDataRequestSchema>;
// One rules dialect: SRL (SHACL 1.2 Rules), plus raw SPARQL for callers that
// supply an already-normalized UPDATE. The previous tri-grammar split
// ('shacl-rules' / 'rules-with-aggregation' / 'rules-with-negation') was
// retired with the vendored sparqljs fork — negation is part of SRL and
// aggregation is unsupported.
export const grammarTypeSchema = z.enum([
  'srl',
  'sparql',
]);
export type GrammarType = z.infer<typeof grammarTypeSchema>;
export const grammarValidationResultSchema = z
  .object({
    grammar: grammarTypeSchema,
    valid: z.boolean(),
    normalized: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();

export type GrammarValidationResult = z.infer<typeof grammarValidationResultSchema>;
export const validateRuleDataResponseSchema = z
  .object({
    valid: z.literal(true),
    normalized: z.string(),
    primaryGrammar: grammarTypeSchema.optional(),
    validations: z.array(grammarValidationResultSchema).optional(),
  })
  .strict();

export type ValidateRuleDataResponse = z.infer<typeof validateRuleDataResponseSchema>;
export const validateRuleDataErrorResponseSchema = z
  .object({
    valid: z.literal(false),
    error: z.string(),
    validations: z.array(grammarValidationResultSchema).optional(),
  })
  .strict();

export type ValidateRuleDataErrorResponse = z.infer<typeof validateRuleDataErrorResponseSchema>;
export const formatRequestSchema = z
  .object({
    code: z.string().min(1, 'Code is required'),
  })
  .strict();

export type FormatRequest = z.infer<typeof formatRequestSchema>;
export const formatResponseSchema = z
  .object({
    formatted: z.string(),
  })
  .strict();

export type FormatResponse = z.infer<typeof formatResponseSchema>;
const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
  required: ['error'],
  additionalProperties: false,
} as const;

const detectQueryQuerystringSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
  },
  required: ['query'],
  additionalProperties: false,
} as const;


