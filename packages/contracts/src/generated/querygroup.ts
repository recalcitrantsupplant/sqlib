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
const optionalIriArray = z.array(iriString).optional().nullable();
const nullableInteger = z.number().int().optional().nullable();
// Reusable field definitions for QueryGroup entity
const queryGroupShape = {
  id: iriString,
  name: z.string().min(1, 'Name is required'),
  description: nullableString,
  currentVersion: optionalIriString,
  currentVersionNumber: nullableInteger,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
  isPartOf: iriString,
  tags: optionalIriArray,
  argumentSets: optionalIriArray,
};
// Full QueryGroup schema for validation
export const queryGroupSchema = z.object(queryGroupShape).strict();
// Create schema - id optional, allows backend to mint it or temporary URNs, excludes read-only fields
export const queryGroupCreateSchema = z.object({
  ...queryGroupShape,
  id: iriString.or(z.string().regex(/^urn:temp:/, 'Temporary URN must start with urn:temp:')).optional().nullable(),
}).omit({ currentVersionNumber: true, dateCreated: true, dateModified: true }).strict();
// Update schema - all fields optional except id, excludes read-only fields
export const queryGroupUpdateSchema = z.object(queryGroupShape).partial().omit({ id: true, currentVersionNumber: true, dateCreated: true, dateModified: true }).strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Update must include at least one field',
    path: [],
  });
// QueryGroup entity type
export type QueryGroup = z.infer<typeof queryGroupSchema>;
// QueryGroup creation type
export type QueryGroupCreate = z.infer<typeof queryGroupCreateSchema>;
// QueryGroup update type
export type QueryGroupUpdate = z.infer<typeof queryGroupUpdateSchema>;

