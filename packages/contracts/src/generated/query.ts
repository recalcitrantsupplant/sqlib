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
const iriArray = z.array(iriString);
const optionalIriArray = z.array(iriString).optional().nullable();
const nullableInteger = z.number().int().optional().nullable();
// Reusable field definitions for Query entity
const queryShape = {
  id: iriString,
  name: z.string().min(1, 'Name is required'),
  description: nullableString,
  currentVersion: optionalIriString,
  currentVersionNumber: nullableInteger,
  defaultBackend: optionalIriString,
  isPartOf: iriArray.min(1, 'isPartOf must contain at least one library'),
  tags: optionalIriArray,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
  argumentSets: optionalIriArray,
};
// Full Query schema for validation
export const querySchema = z.object(queryShape).strict();
// Create schema - id optional, allows backend to mint it or temporary URNs, normalizes isPartOf, excludes read-only fields
export const queryCreateSchema = z.object({
  ...queryShape,
  id: iriString.or(z.string().regex(/^urn:temp:/, 'Temporary URN must start with urn:temp:')).optional().nullable(),
  isPartOf: z.preprocess(
    (val) => (typeof val === 'string' ? [val] : val),
    iriArray.min(1, 'isPartOf must contain at least one library')
  ),
}).omit({ currentVersionNumber: true, dateCreated: true, dateModified: true }).strict();
// Update schema - all fields optional except id, excludes read-only fields, normalizes isPartOf
export const queryUpdateSchema = z.preprocess(
  (data: unknown) => {
    if (data && typeof data === 'object' && 'isPartOf' in data) {
      const record = data as Record<string, unknown>;
      if (typeof record.isPartOf === 'string') {
        return { ...record, isPartOf: [record.isPartOf] };
      }
    }
    return data;
  },
  z.object(queryShape).partial().omit({ id: true, currentVersionNumber: true, dateCreated: true, dateModified: true }).strict()
)
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Update must include at least one field',
    path: [],
  });
// Query entity type
export type Query = z.infer<typeof querySchema>;
// Query creation type
export type QueryCreate = z.infer<typeof queryCreateSchema>;
// Query update type
export type QueryUpdate = z.infer<typeof queryUpdateSchema>;

