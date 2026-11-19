/**
 * Argument set responses, as the argument-set routes return them: the set
 * with its current version inlined.
 *
 * The bindings are left loosely typed here, as they were in the web copy this
 * replaces: their element shapes are the runtime's argument model, and the
 * web narrows them through `types/argument-sets.ts` where it reads them.
 */
import { z } from 'zod';

export const argumentSetVersionDetailSchema = z.object({
  id: z.string(),
  isPartOf: z.string(),
  version: z.number(),
  tupleBindings: z.array(z.any()),
  scalarBindings: z.array(z.any()),
  dateCreated: z.string(),
  dateModified: z.string(),
  createdBy: z.string().nullable().optional(),
  modifiedBy: z.string().nullable().optional(),
});

export const argumentSetDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  // Provenance, and null on a set composed from the rail rather than made on
  // a callable's screen. Nullable here as well as on the server, or the rail
  // listing would fail to parse exactly the rows it exists to show.
  scope: z.enum(['query', 'queryGroup']).nullable().optional(),
  targetId: z.string().nullable().optional(),
  libraryId: z.string().optional(),
  currentVersionId: z.string().nullable().optional(),
  currentVersion: argumentSetVersionDetailSchema.nullable().optional(),
  tupleBindings: z.array(z.any()),
  scalarBindings: z.array(z.any()),
  dateCreated: z.string(),
  dateModified: z.string(),
  createdBy: z.string().nullable().optional(),
  modifiedBy: z.string().nullable().optional(),
});

/** A tuple binding in a list: its clause, without the rows. */
export const argumentTupleBindingSummarySchema = z.object({
  id: z.string(),
  // The API always sends it; optional so an older server's list still parses.
  position: z.number().optional(),
  tupleSignature: z.string(),
  variables: z.array(z.string()),
  tupleSetVersions: z.array(z.string()).optional(),
});

/**
 * An argument set as the list routes return it: what a list or a picker
 * shows, and what the fit verdict needs. The rows come from the detail route.
 */
export const argumentSetSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  scope: z.enum(['query', 'queryGroup']).nullable().optional(),
  targetId: z.string().nullable().optional(),
  libraryId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  currentVersionId: z.string().nullable().optional(),
  currentVersionNumber: z.number().optional(),
  tupleBindings: z.array(argumentTupleBindingSummarySchema),
  scalarBindings: z.array(z.any()),
  dateCreated: z.string().optional(),
  dateModified: z.string().optional(),
  createdBy: z.string().nullable().optional(),
  modifiedBy: z.string().nullable().optional(),
});

export type ArgumentSetSummary = z.infer<typeof argumentSetSummarySchema>;

/**
 * A set as a run payload: what `/argument-sets/:id/export` (and the per-version
 * export) answer with — the arguments, limits and offsets a run would send.
 */
export const argumentSetExportSchema = z.object({
  arguments: z.array(z.any()),
  limits: z.array(z.object({ name: z.string(), value: z.number() })),
  offsets: z.array(z.object({ name: z.string(), value: z.number() })),
});

export type ArgumentSetExport = z.infer<typeof argumentSetExportSchema>;
