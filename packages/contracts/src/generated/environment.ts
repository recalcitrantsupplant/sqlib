/**
 * 🤖 This file is auto-generated from the entity schemas.
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
// Reusable field definitions for Environment entity
const environmentShape = {
  id: iriString,
  name: z.string().min(1, 'Name is required'),
  description: nullableString,
  position: nullableInteger,
  defaultBackend: optionalIriString,
  isPartOf: iriString,
  versions: optionalIriArray,
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
};
// Full Environment schema for validation
export const environmentSchema = z.object(environmentShape).strict();
// Create schema - id optional, allows backend to mint it or temporary URNs, excludes read-only fields
export const environmentCreateSchema = z.object({
  ...environmentShape,
  id: iriString.or(z.string().regex(/^urn:temp:/, 'Temporary URN must start with urn:temp:')).optional().nullable(),
}).omit({ versions: true, dateCreated: true, dateModified: true }).strict();
// Update schema - all fields optional except id, excludes read-only fields
export const environmentUpdateSchema = z.object(environmentShape).partial().omit({ id: true, versions: true, dateCreated: true, dateModified: true }).strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Update must include at least one field',
    path: [],
  });
// Environment entity type
export type Environment = z.infer<typeof environmentSchema>;
// Environment creation type
export type EnvironmentCreate = z.infer<typeof environmentCreateSchema>;
// Environment update type
export type EnvironmentUpdate = z.infer<typeof environmentUpdateSchema>;

