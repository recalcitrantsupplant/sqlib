/**
 * 🤖 This file is auto-generated from LDKit schemas.
 * Do not edit manually - run 'npm run generate-schemas' instead.
 */
import { z } from "zod";
import { isIri, IRI_ERROR_MESSAGE } from "../iri.js";
// IRI validation — the one definition, shared with the server (contracts/src/iri.ts)
const iriString = z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE);
const optionalIriString = iriString.optional().nullable();
const isoDateTime = z.string().datetime({ offset: true }).optional().nullable();
const nullableString = z.string().optional().nullable();
const nullableInteger = z.number().int().optional().nullable();
const nullableNumber = z.number().optional().nullable();
const nullableBoolean = z.boolean().optional().nullable();
const iriArray = z.array(iriString);
const optionalIriArray = z.array(iriString).optional().nullable();
// LimitParameter, projected from the entity model
export const limitParameterShape = {
  id: iriString,
  name: z.string().min(1, 'Name is required'),
  value: nullableInteger,
  defaultValue: nullableInteger,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// OffsetParameter, projected from the entity model
export const offsetParameterShape = {
  id: iriString,
  name: z.string().min(1, 'Name is required'),
  value: nullableInteger,
  defaultValue: nullableInteger,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// QueryInputVariable, projected from the entity model
export const queryInputVariableShape = {
  id: iriString,
  variableName: z.string().min(1, 'VariableName is required'),
  allowedTypes: optionalIriArray,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// QueryOutputVariable, projected from the entity model
export const queryOutputVariableShape = {
  id: iriString,
  variableName: z.string().min(1, 'VariableName is required'),
  description: nullableString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// TupleMember, projected from the entity model
export const tupleMemberShape = {
  id: iriString,
  position: z.number().int(),
  variable: iriString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// QueryInputTuple, projected from the entity model
export const queryInputTupleShape = {
  id: iriString,
  name: nullableString,
  memberEntries: iriArray,
  position: nullableInteger,
  variableMappings: nullableString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// QueryOutputTuple, projected from the entity model
export const queryOutputTupleShape = {
  id: iriString,
  name: z.string().min(1, 'Name is required'),
  outputType: nullableString,
  memberEntries: iriArray,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// QueryVersion, projected from the entity model
export const queryVersionShape = {
  id: iriString,
  isPartOf: iriString,
  version: z.number().int(),
  immutable: nullableBoolean,
  queryString: z.string().min(1, 'QueryString is required'),
  comment: nullableString,
  queryType: optionalIriString,
  srlImportable: nullableBoolean,
  srlImportRevision: nullableInteger,
  limitParameters: optionalIriArray,
  offsetParameters: optionalIriArray,
  inferredInputs: optionalIriArray,
  inferredOutputs: optionalIriArray,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
  defaultBackend: optionalIriString,
};
// StartNode, projected from the entity model
export const startNodeShape = {
  id: iriString,
  outputs: optionalIriArray,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
  nodeType: nullableString,
};
// EndNode, projected from the entity model
export const endNodeShape = {
  id: iriString,
  inputs: optionalIriArray,
  mediaType: nullableString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
  nodeType: nullableString,
};
// DynamicQueryNode, projected from the entity model
export const dynamicQueryNodeShape = {
  id: iriString,
  queryId: optionalIriString,
  backendId: optionalIriString,
  backendConfig: z
    .object({
      type: z.literal('ephemeral-oxigraph'),
      storeId: z.string().min(1, 'storeId must be a non-empty string'),
    })
    .strict()
    .optional()
    .nullable(),
  inputs: optionalIriArray,
  outputs: optionalIriArray,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
  nodeType: nullableString,
};
// RuleSetNode, projected from the entity model
export const ruleSetNodeShape = {
  id: iriString,
  ruleSetVersion: iriString,
  inputs: optionalIriArray,
  outputs: optionalIriArray,
  nodeType: nullableString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// PatchNode, projected from the entity model
export const patchNodeShape = {
  id: iriString,
  queryId: iriString,
  backendId: optionalIriString,
  inputs: optionalIriArray,
  outputs: optionalIriArray,
  deletionsOutput: optionalIriString,
  additionsOutput: optionalIriString,
  backendConfig: z
    .object({
      type: z.literal('ephemeral-oxigraph'),
      storeId: z.string().min(1, 'storeId must be a non-empty string'),
    })
    .strict()
    .optional()
    .nullable(),
  nodeType: nullableString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// QueryNode, projected from the entity model
export const queryNodeShape = {
  id: iriString,
  queryId: iriString,
  backendId: optionalIriString,
  inputs: optionalIriArray,
  outputs: optionalIriArray,
  backendConfig: z
    .object({
      type: z.literal('ephemeral-oxigraph'),
      storeId: z.string().min(1, 'storeId must be a non-empty string'),
    })
    .strict()
    .optional()
    .nullable(),
  nodeType: nullableString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// QueryEdge, projected from the entity model
export const queryEdgeShape = {
  id: iriString,
  sourceNodeId: optionalIriString,
  targetNodeId: optionalIriString,
  sourceLocalId: nullableString,
  targetLocalId: nullableString,
  dataFlowType: nullableString,
  sourceOutputId: optionalIriString,
  targetInputId: optionalIriString,
  variableMappings: nullableString,
  whenEmpty: nullableString,
};
// TriplesQuadsIO, projected from the entity model
export const triplesQuadsIOShape = {
  id: iriString,
  name: nullableString,
  description: nullableString,
  ioType: nullableString,
  outputType: nullableString,
  triplesOrQuads: nullableString,
  specifiedGraph: optionalIriString,
  position: nullableInteger,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// BooleanIO, projected from the entity model
export const booleanIOShape = {
  id: iriString,
  name: nullableString,
  description: nullableString,
  ioType: nullableString,
  outputType: nullableString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// QueryIdInput, projected from the entity model
export const queryIdInputShape = {
  id: iriString,
  name: nullableString,
  description: nullableString,
  isPartOf: iriString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// QueryGroupVersion, projected from the entity model
export const queryGroupVersionShape = {
  id: iriString,
  version: z.number().int(),
  immutable: nullableBoolean,
  startNode: optionalIriString,
  endNode: optionalIriString,
  executionNodes: optionalIriArray,
  edges: optionalIriArray,
  canvasData: nullableString,
  comment: nullableString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
  isPartOf: iriString,
};
export const limitParameterSchema = z.object(limitParameterShape).strict();
export const offsetParameterSchema = z.object(offsetParameterShape).strict();
export const queryInputVariableSchema = z.object(queryInputVariableShape).strict();
export const queryOutputVariableSchema = z.object(queryOutputVariableShape).strict();
export const tupleMemberSchema = z.object(tupleMemberShape).strict();
export const queryInputTupleSchema = z.object(queryInputTupleShape).strict();
export const queryOutputTupleSchema = z.object(queryOutputTupleShape).strict();
export const queryVersionSchema = z.object(queryVersionShape).strict();
export const startNodeSchema = z.object(startNodeShape).strict();
export const endNodeSchema = z.object(endNodeShape).strict();
export const dynamicQueryNodeSchema = z.object(dynamicQueryNodeShape).strict();
export const ruleSetNodeSchema = z.object(ruleSetNodeShape).strict();
export const patchNodeSchema = z.object(patchNodeShape).strict();
export const queryNodeSchema = z.object(queryNodeShape).strict();
export const queryEdgeSchema = z.object(queryEdgeShape).strict();
export const triplesQuadsIOSchema = z.object(triplesQuadsIOShape).strict();
export const booleanIOSchema = z.object(booleanIOShape).strict();
export const queryIdInputSchema = z.object(queryIdInputShape).strict();
export const queryGroupVersionSchema = z.object(queryGroupVersionShape).strict();
// LimitParameter entity type
export type LimitParameter = z.infer<typeof limitParameterSchema>;
// OffsetParameter entity type
export type OffsetParameter = z.infer<typeof offsetParameterSchema>;
// QueryInputVariable entity type
export type QueryInputVariable = z.infer<typeof queryInputVariableSchema>;
// QueryOutputVariable entity type
export type QueryOutputVariable = z.infer<typeof queryOutputVariableSchema>;
// TupleMember entity type
export type TupleMember = z.infer<typeof tupleMemberSchema>;
// QueryInputTuple entity type
export type QueryInputTuple = z.infer<typeof queryInputTupleSchema>;
// QueryOutputTuple entity type
export type QueryOutputTuple = z.infer<typeof queryOutputTupleSchema>;
// QueryVersion entity type
export type QueryVersion = z.infer<typeof queryVersionSchema>;
// StartNode entity type
export type StartNode = z.infer<typeof startNodeSchema>;
// EndNode entity type
export type EndNode = z.infer<typeof endNodeSchema>;
// DynamicQueryNode entity type
export type DynamicQueryNode = z.infer<typeof dynamicQueryNodeSchema>;
// RuleSetNode entity type
export type RuleSetNode = z.infer<typeof ruleSetNodeSchema>;
// PatchNode entity type
export type PatchNode = z.infer<typeof patchNodeSchema>;
// QueryNode entity type
export type QueryNode = z.infer<typeof queryNodeSchema>;
// QueryEdge entity type
export type QueryEdge = z.infer<typeof queryEdgeSchema>;
// TriplesQuadsIO entity type
export type TriplesQuadsIO = z.infer<typeof triplesQuadsIOSchema>;
// BooleanIO entity type
export type BooleanIO = z.infer<typeof booleanIOSchema>;
// QueryIdInput entity type
export type QueryIdInput = z.infer<typeof queryIdInputSchema>;
// QueryGroupVersion entity type
export type QueryGroupVersion = z.infer<typeof queryGroupVersionSchema>;

