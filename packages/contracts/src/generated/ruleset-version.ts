/**
 * RuleSet Version Contract Definitions
 *
 * Defines schemas for RuleSetVersion entity and its expanded representations.
 * Includes inline definitions for Rule, RuleVersion, DataBlock, DataBlockVersion
 * to avoid circular dependencies.
 */
import { isIri, IRI_ERROR_MESSAGE } from '../iri.js';
import { z } from 'zod';


const iriString = z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE);

const optionalIriString = iriString.optional().nullable();
const isoDateTime = z.string().datetime({ offset: true }).optional().nullable();
const nullableString = z.string().optional().nullable();
const iriArray = z.array(iriString);
const optionalIriArray = z.array(iriString).optional().nullable();

// Rule schema (inline definition to avoid imports)
const ruleShape = {
  id: iriString,
  name: z.string().min(1),
  description: nullableString,
  comment: nullableString,
  currentVersion: optionalIriString,
  isPartOf: iriArray,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};

const ruleSchema = z.object(ruleShape).strict();

// RuleVersion schema (inline definition)
const ruleVersionShape = {
  id: iriString,
  isPartOf: iriString,
  version: z.number().int(),
  immutable: z.boolean().optional().nullable(),
  comment: nullableString,
  ruleString: z.string(),
  normalizedInsert: nullableString,
  ruleFormat: nullableString,
  grammarType: nullableString,
  grammarValid: z.boolean().optional().nullable(),
  validationError: nullableString,
  grammarValidations: nullableString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};

const ruleVersionSchema = z.object(ruleVersionShape).strict();

// DataBlock schema (inline definition)
const dataBlockShape = {
  id: iriString,
  name: z.string().min(1),
  description: nullableString,
  comment: nullableString,
  currentVersion: optionalIriString,
  isPartOf: iriArray,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};

const dataBlockSchema = z.object(dataBlockShape).strict();

// DataBlockVersion schema (inline definition)
const dataBlockVersionShape = {
  id: iriString,
  isPartOf: iriString,
  version: z.number().int(),
  immutable: z.boolean().optional().nullable(),
  comment: nullableString,
  dataString: z.string(),
  normalizedInsertData: nullableString,
  dataFormat: nullableString,
  grammarType: nullableString,
  grammarValid: z.boolean().optional().nullable(),
  validationError: nullableString,
  grammarValidations: nullableString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};

const dataBlockVersionSchema = z.object(dataBlockVersionShape).strict();

// RuleSetVersion base schema
const ruleSetVersionShape = {
  id: iriString,
  isPartOf: iriString,
  version: z.number().int(),
  immutable: z.boolean().optional().nullable(),
  comment: nullableString,
  hasRule: optionalIriArray,
  hasDataBlock: optionalIriArray,
  stratificationReport: nullableString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};

export const ruleSetVersionSchema = z.object(ruleSetVersionShape).strict();

export type RuleSetVersion = z.infer<typeof ruleSetVersionSchema>;

// RuleVersion item schema (for expanded response)
const ruleVersionItemSchema = z
  .object({
    ruleVersion: ruleVersionSchema,
    rule: ruleSchema.nullable().optional(),
  })
  .strict();

export type RuleVersionItem = z.infer<typeof ruleVersionItemSchema>;

// DataBlockVersion item schema (for expanded response)
const dataBlockVersionItemSchema = z
  .object({
    dataBlockVersion: dataBlockVersionSchema,
    dataBlock: dataBlockSchema.nullable().optional(),
  })
  .strict();

export type DataBlockVersionItem = z.infer<typeof dataBlockVersionItemSchema>;

// Expanded RuleSetVersion schema
export const ruleSetVersionExpandedSchema = z
  .object({
    ruleSetVersion: ruleSetVersionSchema,
    rules: z.array(ruleVersionItemSchema),
    dataBlocks: z.array(dataBlockVersionItemSchema),
  })
  .strict();

export type RuleSetVersionExpanded = z.infer<typeof ruleSetVersionExpandedSchema>;

// Create input schema for RuleSetVersion
export const ruleSetVersionForRuleSetCreateSchema = z.object({
  comment: nullableString,
  hasRule: optionalIriArray,
  hasDataBlock: optionalIriArray,
  immutable: z.boolean().optional().nullable(),
}).strict();

export type RuleSetVersionForRuleSetCreateInput = z.infer<typeof ruleSetVersionForRuleSetCreateSchema>;

/**
 * What a version PATCH may carry: the annotation, and the freeze transition.
 *
 * A version is a snapshot (issue #192) — `POST .../v` mints the next one, and
 * that is the only way to write content. `immutable` is accepted in one
 * direction only, to freeze a version stored before freeze-on-create; the API
 * refuses `false`.
 */
export const ruleSetVersionPatchSchema = z
  .object({
    comment: nullableString,
    immutable: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one property must be provided when annotating a rule set version',
  });

export type RuleSetVersionPatchInput = z.infer<typeof ruleSetVersionPatchSchema>;

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
  required: ['error'],
  additionalProperties: false,
} as const;

const ruleSetVersionParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    version: { type: 'string' },
  },
  required: ['id', 'version'],
  additionalProperties: false,
} as const;

const ruleSetIdParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
} as const;

