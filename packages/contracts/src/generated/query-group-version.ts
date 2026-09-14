/**
 * The flat write and expanded read contracts for query group versions.
 *
 * The entity shapes this module used to hand-write are now projected from the
 * entity model into `version-shapes.ts` and imported here (issue #65). What is
 * left is what the model has no way to say: the draft schemas that accept
 * `urn:ui-temp:` ids for resources the payload is minting, the expanded
 * response envelope, and the fastify param schemas. Those stay hand-written,
 * deliberately — they describe a wire protocol, not an entity.
 *
 * Editing a field of an entity means editing `persistence/schemas/`, not here.
 */
import { isIri, IRI_ERROR_MESSAGE } from '../iri.js';
import { z } from 'zod';
import {
  queryInputVariableSchema,
  queryOutputVariableSchema,
  queryInputTupleSchema,
  queryOutputTupleSchema,
  tupleMemberSchema,
  queryVersionSchema,
} from './query-version.js';
import {
  queryGroupVersionShape,
  queryNodeShape,
  startNodeSchema,
  endNodeSchema,
  dynamicQueryNodeSchema,
  ruleSetNodeSchema,
  patchNodeSchema,
  queryNodeSchema,
  queryEdgeSchema,
  triplesQuadsIOSchema,
  booleanIOSchema,
  queryIdInputSchema,
  queryGroupVersionSchema,
} from './version-shapes.js';

export {
  startNodeSchema,
  endNodeSchema,
  dynamicQueryNodeSchema,
  ruleSetNodeSchema,
  patchNodeSchema,
  queryNodeSchema,
  queryEdgeSchema,
  triplesQuadsIOSchema,
  booleanIOSchema,
  queryIdInputSchema,
  queryGroupVersionSchema,
};
export type { QueryGroupVersion } from './version-shapes.js';
/*
 * Exported so a client can name the node's shape rather than restating it.
 * The web editor's own `backendConfig` declaration was a hand-copy of the old
 * `string` typing, which is how a save could drop the field while still
 * type-checking (issue #301).
 */
export type { QueryNode } from './version-shapes.js';

const iriString = z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE);

const urnString = z.string().regex(/^urn:/, 'Must be a URN');
const optionalUrn = urnString.optional().nullable();
const optionalIriString = iriString.optional().nullable();
const isoDateTime = z.string().datetime({ offset: true }).optional().nullable();
const nullableString = z.string().optional().nullable();
const nullableIriArray = z.array(iriString).optional().nullable();

const queryGroupVersionDraftSchema = z
  .object({
    startNode: optionalIriString,
    endNode: optionalIriString,
    canvasData: nullableString,
    comment: nullableString,
    immutable: z.boolean().optional().nullable(),
    dateCreated: isoDateTime,
    dateModified: isoDateTime,
  })
  .strict();

const startNodeDraftSchema = z
  .object({
    id: optionalUrn,
    outputs: z.array(iriString).optional(),
  })
  .strict();

const endNodeDraftSchema = z
  .object({
    id: optionalUrn,
    inputs: z.array(iriString).optional(),
    mediaType: nullableString,
  })
  .strict();

const executionNodeDraftSchema = z
  .object({
    id: optionalUrn,
    queryId: optionalIriString,
    backendId: optionalIriString,
    ruleSetVersion: optionalIriString,
    // Deprecated alias for `ruleSetVersion`, kept because it was the only
    // spelling this schema accepted before the two names were reconciled. The
    // server prefers `ruleSetVersion` when both are present.
    ruleSetVersionId: optionalIriString,
    inputs: z.array(iriString).optional(),
    outputs: z.array(iriString).optional(),
    // Taken from the entity shape rather than restated. Restating it is what
    // made this schema type a structured value as a string while the writer and
    // the executor both read it as an object, so an HTTP client could not
    // create an ephemeral-backend node at all: the object failed `.strict()`,
    // and a string passed validation but persisted something unusable
    // (issue #294).
    backendConfig: queryNodeShape.backendConfig,
    // A PatchNode's two output ports. Which half of the patch a port carries is
    // part of the node rather than of `outputs`, because an array index is not
    // a contract: reordering `outputs` in a client would otherwise swap
    // deletions for additions with nothing to notice it. Optional here and
    // required by the writer, so a payload missing one fails as a named field
    // rather than as a shape mismatch on every other node type.
    deletionsOutput: optionalIriString,
    additionsOutput: optionalIriString,
    nodeType: nullableString,
  })
  .strict();

const queryEdgeDraftSchema = z
  .object({
    id: optionalUrn,
    sourceNodeId: z.string().optional(),
    targetNodeId: z.string().optional(),
    sourceLocalId: nullableString,
    targetLocalId: nullableString,
    dataFlowType: nullableString,
    sourceOutputId: z.string().optional(),
    targetInputId: z.string().optional(),
    // Kept in step with WHEN_EMPTY_MODES in the API's QueryEdgeSchema. Missing
    // here until now, which made this schema reject any edge carrying the
    // policy — and since the client validates before sending, the whole save
    // failed rather than the field being dropped.
    whenEmpty: z.enum(['unconstrained', 'propagateEmpty', 'require']).nullable().optional(),
    variableMappings: nullableString,
  })
  .strict();

const tupleMemberDraftSchema = z
  .object({
    id: optionalUrn,
    position: z.number().int(),
    variable: z.string().min(1),
  })
  .strict();

const queryInputVariableDraftSchema = z
  .object({
    id: optionalUrn,
    variableName: z.string().min(1, 'Variable name is required'),
    allowedTypes: z.array(iriString).optional(),
  })
  .strict();

const queryOutputVariableDraftSchema = z
  .object({
    id: optionalUrn,
    variableName: z.string().min(1, 'Variable name is required'),
    description: nullableString,
  })
  .strict();

const queryInputTupleDraftSchema = z
  .object({
    id: optionalUrn,
    name: nullableString,
    memberEntries: z.array(z.string().min(1)),
  })
  .strict();

const queryOutputTupleDraftSchema = z
  .object({
    id: optionalUrn,
    name: z.string().min(1, 'Name is required'),
    outputType: nullableString,
    memberEntries: z.array(z.string().min(1)),
  })
  .strict();

const triplesQuadsIODraftSchema = z
  .object({
    id: optionalUrn,
    name: nullableString,
    description: nullableString,
    ioType: nullableString,
    outputType: nullableString,
    triplesOrQuads: nullableString,
    specifiedGraph: optionalIriString,
  })
  .strict();

const booleanIODraftSchema = z
  .object({
    id: optionalUrn,
    name: nullableString,
    description: nullableString,
    ioType: nullableString,
    outputType: nullableString,
  })
  .strict();

const queryIdInputDraftSchema = z
  .object({
    id: optionalUrn,
    name: nullableString,
    description: nullableString,
    isPartOf: optionalIriString,
  })
  .strict();

export const queryGroupVersionForGroupCreateSchema = z
  .object({
    queryGroupVersion: queryGroupVersionDraftSchema,
    startNode: startNodeDraftSchema.optional(),
    endNode: endNodeDraftSchema.optional(),
    executionNodes: z.array(executionNodeDraftSchema).optional(),
    edges: z.array(queryEdgeDraftSchema).optional(),
    tupleMembers: z.array(tupleMemberDraftSchema).optional(),
    inputTuples: z.array(queryInputTupleDraftSchema).optional(),
    outputTuples: z.array(queryOutputTupleDraftSchema).optional(),
    inputs: z.array(queryInputVariableDraftSchema).optional(),
    outputs: z.array(queryOutputVariableDraftSchema).optional(),
    rdfOutputs: z.array(triplesQuadsIODraftSchema).optional(),
    booleanOutputs: z.array(booleanIODraftSchema).optional(),
    queryIdInputs: z.array(queryIdInputDraftSchema).optional(),
  })
  .strict();

export type QueryGroupVersionForGroupCreateInput = z.infer<typeof queryGroupVersionForGroupCreateSchema>;
/**
 * What a version PATCH may carry: the annotation, and the freeze transition.
 *
 * A version is a snapshot (issue #192) — `POST .../v` mints the next one, and
 * that is the only way to write content. `immutable` is accepted in one
 * direction only, to freeze a version stored before freeze-on-create; the API
 * refuses `false`.
 */
export const queryGroupVersionPatchSchema = z
  .object({
    queryGroupVersion: z
      .object({
        comment: nullableString,
        immutable: z.literal(true).optional(),
      })
      .strict()
      .optional(),
    comment: nullableString,
    immutable: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one property must be provided when annotating a query group version',
  });

export type QueryGroupVersionPatchInput = z.infer<typeof queryGroupVersionPatchSchema>;
const executionNodesUnionSchema = z
  .array(z.union([dynamicQueryNodeSchema, queryNodeSchema, ruleSetNodeSchema, patchNodeSchema]))
  .optional()
  .default([]);

const edgesArraySchema = z.array(queryEdgeSchema).optional().default([]);
const tupleMembersArraySchema = z.array(tupleMemberSchema).optional().default([]);
const inputTuplesArraySchema = z.array(queryInputTupleSchema).optional().default([]);
const outputTuplesArraySchema = z.array(queryOutputTupleSchema).optional().default([]);
const inputsArraySchema = z.array(queryInputVariableSchema).optional().default([]);
const outputsArraySchema = z.array(queryOutputVariableSchema).optional().default([]);
const rdfOutputsArraySchema = z.array(triplesQuadsIOSchema).optional().default([]);
const booleanOutputsArraySchema = z.array(booleanIOSchema).optional().default([]);
const queryIdInputsArraySchema = z.array(queryIdInputSchema).optional().default([]);

// Additional arrays returned by expandGroupVersionDetailed for UI convenience
// These contain subsets of the same nodes that appear in executionNodes/startNode/endNode
const queryNodesArraySchema = z.array(queryNodeSchema).optional().default([]);
const dynamicQueryNodesArraySchema = z.array(dynamicQueryNodeSchema).optional().default([]);
const startNodesArraySchema = z.array(startNodeSchema).optional().default([]);
const endNodesArraySchema = z.array(endNodeSchema).optional().default([]);
const ruleSetNodesArraySchema = z.array(ruleSetNodeSchema).optional().default([]);
const patchNodesArraySchema = z.array(patchNodeSchema).optional().default([]);
const queryVersionsArraySchema = z.array(queryVersionSchema).optional().default([]);

export const queryGroupVersionExpandedSchema = z
  .object({
    queryGroupVersion: queryGroupVersionSchema,
    executionNodes: executionNodesUnionSchema,
    startNode: startNodeSchema.optional().nullable(),
    endNode: endNodeSchema.optional().nullable(),
    edges: edgesArraySchema,
    queryNodes: queryNodesArraySchema,
    dynamicQueryNodes: dynamicQueryNodesArraySchema,
    ruleSetNodes: ruleSetNodesArraySchema,
    patchNodes: patchNodesArraySchema,
    startNodes: startNodesArraySchema,
    endNodes: endNodesArraySchema,
    tupleMembers: tupleMembersArraySchema,
    inputTuples: inputTuplesArraySchema,
    outputTuples: outputTuplesArraySchema,
    inputs: inputsArraySchema,
    outputs: outputsArraySchema,
    rdfOutputs: rdfOutputsArraySchema,
    booleanOutputs: booleanOutputsArraySchema,
    queryIdInputs: queryIdInputsArraySchema,
    queryVersions: queryVersionsArraySchema,
    /*
     * The LIMIT / OFFSET names this group accepts: the union of what its member
     * queries declare, computed server-side so the fields the screen offers and
     * the names `/execute` accepts cannot disagree. Optional because a response
     * from a server that predates them is still a valid one.
     */
    limitParameters: z.array(z.string()).optional(),
    offsetParameters: z.array(z.string()).optional(),
    // GET may enrich the expanded graph with display names. It is optional
    // because the API deliberately falls back to the un-enriched graph if
    // detailed expansion fails.
    iriMap: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type QueryGroupVersionExpanded = z.infer<typeof queryGroupVersionExpandedSchema>;
export const queryGroupVersionExpandedWithIriMapSchema = queryGroupVersionExpandedSchema.extend({
  iriMap: z.record(z.string(), z.string()),
});

export type QueryGroupVersionExpandedWithIriMap = z.infer<typeof queryGroupVersionExpandedWithIriMapSchema>;
const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
  required: ['error'],
  additionalProperties: false,
} as const;

const queryGroupParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
} as const;

const queryGroupVersionParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    version: { type: 'string' },
  },
  required: ['id', 'version'],
  additionalProperties: false,
} as const;
