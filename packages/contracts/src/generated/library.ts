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
// Reusable field definitions for Library entity
const libraryShape = {
  id: iriString,
  name: z.string().min(1, 'Name is required'),
  description: nullableString,
  defaultBackend: optionalIriString,
  allowedBackends: optionalIriArray,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// Full Library schema for validation
export const librarySchema = z.object(libraryShape).strict();
// Create schema - id optional, allows backend to mint it or temporary URNs, excludes read-only fields
export const libraryCreateSchema = z.object({
  ...libraryShape,
  id: iriString.or(z.string().regex(/^urn:temp:/, 'Temporary URN must start with urn:temp:')).optional().nullable(),
}).omit({ dateCreated: true, dateModified: true }).strict();
// Update schema - all fields optional except id, excludes read-only fields
export const libraryUpdateSchema = z.object(libraryShape).partial().omit({ id: true, dateCreated: true, dateModified: true }).strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Update must include at least one field',
    path: [],
  });
// Library entity type
export type Library = z.infer<typeof librarySchema>;
// Library creation type
export type LibraryCreate = z.infer<typeof libraryCreateSchema>;
// Library update type
export type LibraryUpdate = z.infer<typeof libraryUpdateSchema>;

