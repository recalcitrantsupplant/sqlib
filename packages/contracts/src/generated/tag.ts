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
// Reusable field definitions for Tag entity
const tagShape = {
  id: iriString,
  name: z.string().min(1, 'Name is required'),
  description: nullableString,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must match #[0-9a-fA-F]{6}').optional().nullable(),
  isPartOf: iriString,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// Full Tag schema for validation
export const tagSchema = z.object(tagShape).strict();
// Create schema - id optional, allows backend to mint it or temporary URNs, excludes read-only fields
export const tagCreateSchema = z.object({
  ...tagShape,
  id: iriString.or(z.string().regex(/^urn:temp:/, 'Temporary URN must start with urn:temp:')).optional().nullable(),
}).omit({ dateCreated: true, dateModified: true }).strict();
// Update schema - all fields optional except id, excludes read-only fields
export const tagUpdateSchema = z.object(tagShape).partial().omit({ id: true, dateCreated: true, dateModified: true }).strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Update must include at least one field',
    path: [],
  });
// Tag entity type
export type Tag = z.infer<typeof tagSchema>;
// Tag creation type
export type TagCreate = z.infer<typeof tagCreateSchema>;
// Tag update type
export type TagUpdate = z.infer<typeof tagUpdateSchema>;

