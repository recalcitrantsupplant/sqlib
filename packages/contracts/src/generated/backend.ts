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
const backendTypeEnum = z.enum(['http', 'oxigraphEphemeral', 'oxigraphMemory']);
const queryMethodEnum = z.enum(['post', 'get']);
// Reusable field definitions for Backend entity
const backendShape = {
  id: iriString,
  name: z.string().min(1, 'Name is required'),
  description: nullableString,
  backendType: backendTypeEnum,
  endpoint: optionalIriString,
  authEnvKey: z.string().regex(/^[A-Z0-9_]+$/, 'Must match [A-Z0-9_]+').optional().nullable(),
  queryMethod: queryMethodEnum.optional().nullable(),
  dateCreated: isoDateTime,
  dateModified: isoDateTime,
  oxigraphConfig: nullableString,
};
// Full Backend schema for validation
export const backendSchema = z.object(backendShape).strict();
// Create schema - id optional, allows backend to mint it or temporary URNs, excludes read-only fields
export const backendCreateSchema = z.object({
  ...backendShape,
  id: iriString.or(z.string().regex(/^urn:temp:/, 'Temporary URN must start with urn:temp:')).optional().nullable(),
}).omit({ dateCreated: true, dateModified: true }).strict()
  .superRefine((value, ctx) => {
    if (value.backendType === 'http' && (!value.endpoint || value.endpoint.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endpoint'],
        message: 'HTTP backends require an endpoint',
      });
    }
  });
// Update schema - all fields optional except id, excludes read-only fields
export const backendUpdateSchema = z.object(backendShape).partial().omit({ id: true, dateCreated: true, dateModified: true }).strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Update must include at least one field',
    path: [],
  })
  .superRefine((value, ctx) => {
    if (value.backendType === 'http' && value.endpoint === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endpoint'],
        message: 'HTTP backends require an endpoint',
      });
    }
  });
// Backend entity type
export type Backend = z.infer<typeof backendSchema>;
// Backend creation type
export type BackendCreate = z.infer<typeof backendCreateSchema>;
// Backend update type
export type BackendUpdate = z.infer<typeof backendUpdateSchema>;

