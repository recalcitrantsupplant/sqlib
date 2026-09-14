/**
 * 🤖 This file is auto-generated from LDKit schemas.
 * Do not edit manually - run 'npm run generate-schemas' instead.
 */
import { isIri, IRI_ERROR_MESSAGE } from '../iri.js';
import { z } from 'zod';
import {
  executionArgumentSchema,
  executionParameterSchema,
} from './execution.js';


const iriString = z
  .string()
  .min(1, 'IRI must be a non-empty string')
  .refine(isIri, IRI_ERROR_MESSAGE);

export const sparqlRequestSchema = z
  .object({
    query: z.string().min(1, 'Query is required'),
    backendId: iriString.optional(),
    endpoint: z.string().url('Endpoint must be a valid URL').optional(),
    queryMethod: z.enum(['get', 'post']).optional(),
    // The execution payload, reused rather than restated: a raw query runs its
    // arguments through the same substitution a stored one does.
    arguments: z.array(executionArgumentSchema).optional(),
    limits: z.array(executionParameterSchema).optional(),
    offsets: z.array(executionParameterSchema).optional(),
    // Stored sets, so a raw run can name one instead of the client flattening
    // it into `arguments` first. Completed by inline values for whatever the
    // set leaves open, and an overlap is refused naming the parameter — the
    // same rule `/execute` applies.
    argumentSetIds: z.array(iriString).optional(),
  })
  .refine((data) => Boolean(data.backendId) || Boolean(data.endpoint), {
    message: 'backendId or endpoint is required',
    path: ['backendId'],
  })
  .refine((data) => !(data.queryMethod && !data.endpoint), {
    message: 'queryMethod is only supported with endpoint execution',
    path: ['queryMethod'],
  })
  .strict();

export type SparqlRequest = z.infer<typeof sparqlRequestSchema>;
export const sparqlResponseSchema = z.any();
export type SparqlResponse = z.infer<typeof sparqlResponseSchema>;

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
  required: ['error'],
  additionalProperties: false,
} as const;

const sparqlQuerystringSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    backendId: { type: 'string', format: 'iri' },
    endpoint: { type: 'string', format: 'uri' },
    queryMethod: { type: 'string', enum: ['get', 'post'] },
  },
  required: ['query'],
  additionalProperties: false,
  oneOf: [
    { required: ['backendId'] },
    { required: ['endpoint'] },
  ],
} as const;

