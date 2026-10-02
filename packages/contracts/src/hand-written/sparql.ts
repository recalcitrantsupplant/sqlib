/**
 * The zod leaf for `POST /sparql`: the raw-query request the web app validates
 * before sending.
 *
 * Hand-written. It used to sit in `generated/` under an "auto-generated" banner
 * that no generator honoured — nothing writes this file, and there is no entity
 * behind it to generate it from. The JSON Schema fastify validates the same
 * request with is `sparqlRequestJsonSchema` in `contract-routes.ts`, beside it.
 */
import { isIri, IRI_ERROR_MESSAGE } from '../iri.js';
import { z } from 'zod';
import {
  executionArgumentSchema,
  executionParameterSchema,
} from '../generated/execution.js';


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
