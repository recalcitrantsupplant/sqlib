/**
 * The flat write and expanded read contracts for query versions.
 *
 * The eighteen entity shapes these two version modules used to hand-write are
 * now projected from the entity model into `version-shapes.ts` and imported
 * here (issue #65). What is left is what the model has no way to say: the draft
 * schemas that accept `urn:ui-temp:` ids for resources the payload is minting,
 * the expanded response envelopes, and the fastify param schemas. Those stay
 * hand-written, deliberately — they describe a wire protocol, not an entity.
 *
 * Editing a field of an entity means editing `persistence/schemas/`, not here.
 */
import { z } from 'zod';
import { isIri, IRI_ERROR_MESSAGE } from '../iri.js';
import {
  limitParameterShape,
  offsetParameterShape,
  queryInputVariableShape,
  queryOutputVariableShape,
  tupleMemberShape,
  queryOutputTupleShape,
  queryVersionShape,
  limitParameterSchema,
  offsetParameterSchema,
  queryInputVariableSchema,
  queryOutputVariableSchema,
  tupleMemberSchema,
  queryInputTupleSchema,
  queryOutputTupleSchema,
  queryVersionSchema,
} from './version-shapes.js';

export {
  limitParameterSchema,
  offsetParameterSchema,
  queryInputVariableSchema,
  queryOutputVariableSchema,
  tupleMemberSchema,
  queryInputTupleSchema,
  queryOutputTupleSchema,
  queryVersionSchema,
};
export type {
  LimitParameter,
  OffsetParameter,
  QueryInputVariable,
  QueryOutputVariable,
  TupleMember,
  QueryInputTuple,
  QueryOutputTuple,
  QueryVersion,
} from './version-shapes.js';

const iriString = z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE);

const urnString = z.string().regex(/^urn:/, 'Must be a URN');
const optionalUrn = urnString.optional().nullable();
const optionalIriString = iriString.optional().nullable();
const isoDateTime = z.string().datetime({ offset: true }).optional().nullable();
const nullableString = z.string().optional().nullable();
const nullableInteger = z.number().int().optional().nullable();
const nullableIriArray = z.array(iriString).optional().nullable();

const limitParameterInputSchema = z
  .object({
    id: optionalUrn,
    name: limitParameterShape.name,
    value: nullableInteger,
    defaultValue: nullableInteger,
  })
  .strict();

const offsetParameterInputSchema = z
  .object({
    id: optionalUrn,
    name: offsetParameterShape.name,
    value: nullableInteger,
    defaultValue: nullableInteger,
  })
  .strict();

const queryInputVariableInputSchema = z
  .object({
    id: optionalUrn,
    variableName: queryInputVariableShape.variableName,
    allowedTypes: nullableIriArray,
  })
  .strict();

const queryOutputVariableInputSchema = z
  .object({
    id: optionalUrn,
    variableName: queryOutputVariableShape.variableName,
    description: nullableString,
  })
  .strict();

const tupleMemberInputSchema = z
  .object({
    id: optionalUrn,
    position: tupleMemberShape.position,
    variable: iriString,
  })
  .strict();

const queryInputTupleInputSchema = z
  .object({
    id: optionalUrn,
    name: nullableString,
    memberEntries: z.array(iriString),
  })
  .strict();

const queryOutputTupleInputSchema = z
  .object({
    id: optionalUrn,
    name: queryOutputTupleShape.name,
    outputType: nullableString,
    memberEntries: z.array(iriString),
  })
  .strict();

const queryVersionDraftSchema = z
  .object({
    queryString: queryVersionShape.queryString,
    comment: nullableString,
    queryType: nullableString,
    defaultBackend: optionalIriString,
    immutable: z.boolean().optional().nullable(),
    inferredInputs: nullableIriArray,
    inferredOutputs: nullableIriArray,
    dateModified: isoDateTime,
  })
  .strict();

export const queryVersionForQueryCreateSchema = z
  .object({
    queryVersion: queryVersionDraftSchema,
    limitParameters: z.array(limitParameterInputSchema).optional(),
    offsetParameters: z.array(offsetParameterInputSchema).optional(),
    inputs: z.array(queryInputVariableInputSchema).optional(),
    outputs: z.array(queryOutputVariableInputSchema).optional(),
    tupleMembers: z.array(tupleMemberInputSchema).optional(),
    inputTuples: z.array(queryInputTupleInputSchema).optional(),
    inferredInputs: z.array(queryInputTupleInputSchema).optional(),
    outputTuples: z.array(queryOutputTupleInputSchema).optional(),
    inferredOutputs: z.array(z.record(z.string(), z.any())).optional(),
  })
  .strict();

export type QueryVersionForQueryCreateInput = z.infer<typeof queryVersionForQueryCreateSchema>;
/**
 * What a version PATCH may carry: the annotation, and the freeze transition.
 *
 * A version is a snapshot (issue #192) — `POST .../v` mints the next one, and
 * that is the only way to write content. `immutable` is accepted in one
 * direction only, to freeze a version stored before freeze-on-create; the API
 * refuses `false`.
 */
export const queryVersionPatchSchema = z
  .object({
    comment: nullableString,
    immutable: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one property must be provided when annotating a query version',
  });

export type QueryVersionPatchInput = z.infer<typeof queryVersionPatchSchema>;
export const queryVersionExpandedSchema = z
  .object({
    queryVersion: queryVersionSchema,
    limitParameters: z.array(limitParameterSchema),
    offsetParameters: z.array(offsetParameterSchema),
    inputs: z.array(queryInputVariableSchema),
    outputs: z.array(queryOutputVariableSchema),
    inputTuples: z.array(queryInputTupleSchema),
    outputTuples: z.array(queryOutputTupleSchema),
    tupleMembers: z.array(tupleMemberSchema),
    inferredOutputs: z.array(z.record(z.string(), z.any())).optional(),
  })
  .strict();

export type QueryVersionExpanded = z.infer<typeof queryVersionExpandedSchema>;
export const queryVersionExpandedWithIriMapSchema = queryVersionExpandedSchema.extend({
  iriMap: z.record(z.string(), z.string()),
});

export type QueryVersionExpandedWithIriMap = z.infer<typeof queryVersionExpandedWithIriMapSchema>;
const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
  required: ['error'],
  additionalProperties: false,
} as const;

const queryVersionParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    version: { type: 'string' },
  },
  required: ['id', 'version'],
  additionalProperties: false,
} as const;

const queryIdParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
} as const;

