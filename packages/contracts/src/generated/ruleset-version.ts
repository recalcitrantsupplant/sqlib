/**
 * RuleSet Version Contract Definitions
 *
 * The expanded read contract for rule set versions: the envelope the endpoint
 * returns, and the wire-only schemas beside it.
 *
 * The entity shapes it used to restate — Rule, RuleVersion, DataBlock,
 * DataBlockVersion, RuleSetVersion — are projected from the entity model now
 * (`version-shapes.ts` and the CRUD contracts, issue #65), for the reason the
 * hand-written copies proved: they parse responses under `.strict()`, so every
 * field they fell behind the model on was a thrown parse rather than a dropped
 * one. `tupleSeeds` and `tuplesEnabled` on the version, and `tags` and
 * `currentVersionNumber` on an expanded rule, were all missing here.
 *
 * Editing a field of an entity means editing `persistence/schemas/`, not here.
 */
import { isIri, IRI_ERROR_MESSAGE } from '../iri.js';
import { z } from 'zod';
import { ruleSchema } from './rule.js';
import { dataBlockSchema } from './datablock.js';
import {
  ruleVersionSchema,
  dataBlockVersionSchema,
  ruleSetVersionSchema,
} from './version-shapes.js';

export { ruleVersionSchema, dataBlockVersionSchema, ruleSetVersionSchema };
export type { RuleVersion, DataBlockVersion, RuleSetVersion } from './version-shapes.js';

const iriString = z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE);

const nullableString = z.string().optional().nullable();
const optionalIriArray = z.array(iriString).optional().nullable();


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

