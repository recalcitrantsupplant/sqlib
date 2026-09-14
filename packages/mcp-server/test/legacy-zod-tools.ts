/**
 * The zod `inputSchema`s the tool registry carried before Phase C2, snapshotted.
 *
 * Kept verbatim from `src/index.ts` at commit 0a48a50 so the parity harness can
 * compare the JSON Schema now published against the validation that used to
 * happen. This is a frozen reference, not a live definition — it is imported by
 * `toolSchemaParity.test.ts` and by nothing else, and it should not be updated
 * to track changes to the tools. When it stops being worth running the
 * comparison, delete the file and the harness together.
 */
import { z } from 'zod';
import {
  backendCreateSchema,
  backendUpdateSchema,
  libraryCreateSchema,
  libraryUpdateSchema,
  queryCreateSchema,
  queryUpdateSchema,
  executionRequestSchema,
  sparqlRequestSchema,
  detectQueryRequestSchema,
  validateRuleDataRequestSchema,
  formatRequestSchema,
} from '@sparql-query-lib/contracts';

const anyBody = z.record(z.string(), z.any());

/** Tool name -> the zod schema that validated its arguments before C2. */
export const legacyZodInputSchemas: Record<string, z.ZodTypeAny> = {
  // Backends
  'backends.list': z.object({}),
  'backends.get': z.object({ id: z.string().trim().min(1, 'id is required') }),
  'backends.create': backendCreateSchema,
  'backends.update': z.object({ id: z.string(), body: backendUpdateSchema }),
  'backends.delete': z.object({ id: z.string() }),
  'backends.references': z.object({ id: z.string() }),
  'backends.stats': z.object({ id: z.string() }),
  'backends.clearData': z.object({ id: z.string() }),

  // Libraries
  'libraries.list': z.object({ accept: z.string().optional() }),
  'libraries.get': z.object({ id: z.string(), accept: z.string().optional() }),
  'libraries.create': libraryCreateSchema,
  'libraries.update': z.object({ id: z.string(), body: libraryUpdateSchema }),
  'libraries.delete': z.object({ id: z.string() }),
  'libraries.exportAll': z.object({ accept: z.string().optional() }),
  'libraries.exportOne': z.object({ id: z.string(), accept: z.string().optional() }),

  // Queries
  'queries.list': z.object({}),
  'queries.create': queryCreateSchema,
  'queries.get': z.object({ id: z.string() }),
  'queries.update': z.object({ id: z.string(), body: queryUpdateSchema }),
  'queries.delete': z.object({ id: z.string() }),
  'queries.listVersions': z.object({ id: z.string() }),
  'queries.createVersion': z.object({ id: z.string(), body: anyBody }),
  'queries.getVersion': z.object({ id: z.string(), version: z.string() }),
  'queries.patchVersion': z.object({ id: z.string(), version: z.string(), body: anyBody }),
  'queries.listArgumentSets': z.object({ id: z.string() }),
  'queries.attachArgumentSet': z.object({ id: z.string(), body: anyBody }),

  // Execution / SPARQL / detection
  'execute.run': executionRequestSchema,
  'sparql.proxyQuery': sparqlRequestSchema,
  'detection.detectInputs': detectQueryRequestSchema,
  'detection.detectOutputs': detectQueryRequestSchema,
  'detection.validateQuery': detectQueryRequestSchema,
  'detection.validateRuleData': validateRuleDataRequestSchema,
  'detection.format': formatRequestSchema,

  // Argument sets
  'argumentSets.get': z.object({ id: z.string() }),
  'argumentSets.delete': z.object({ id: z.string() }),
  'argumentSets.export': z.object({ id: z.string() }),

  // Data blocks
  'dataBlocks.list': z.object({}),
  'dataBlocks.create': z.object({ body: anyBody }),
  'dataBlocks.get': z.object({ id: z.string() }),
  'dataBlocks.update': z.object({ id: z.string(), body: anyBody }),
  'dataBlocks.delete': z.object({ id: z.string() }),
  'dataBlocks.listVersions': z.object({ id: z.string() }),
  'dataBlocks.createVersion': z.object({ id: z.string(), body: anyBody }),
  'dataBlocks.getVersion': z.object({ id: z.string(), version: z.string() }),
  'dataBlocks.updateVersion': z.object({ id: z.string(), version: z.string(), body: anyBody }),
  'dataBlocks.deleteVersion': z.object({ id: z.string(), version: z.string() }),

  // Rules
  'rules.list': z.object({}),
  'rules.create': z.object({ body: anyBody }),
  'rules.get': z.object({ id: z.string() }),
  'rules.update': z.object({ id: z.string(), body: anyBody }),
  'rules.delete': z.object({ id: z.string() }),
  'rules.listVersions': z.object({ id: z.string() }),
  'rules.createVersion': z.object({ id: z.string(), body: anyBody }),
  'rules.getVersion': z.object({ id: z.string(), version: z.string() }),
  'rules.updateVersion': z.object({ id: z.string(), version: z.string(), body: anyBody }),
  'rules.deleteVersion': z.object({ id: z.string(), version: z.string() }),
  'rules.execute': z.object({ id: z.string(), body: anyBody.optional() }),
  'rules.previewNormalize': z.object({ ruleString: z.string() }),

  // Rule sets
  'ruleSets.list': z.object({}),
  'ruleSets.create': z.object({ body: anyBody }),
  'ruleSets.get': z.object({ id: z.string() }),
  'ruleSets.update': z.object({ id: z.string(), body: anyBody }),
  'ruleSets.delete': z.object({ id: z.string() }),
  'ruleSets.listVersions': z.object({ id: z.string() }),
  'ruleSets.createVersion': z.object({ id: z.string(), body: anyBody }),
  'ruleSets.getVersion': z.object({ id: z.string(), version: z.string() }),
  'ruleSets.patchVersion': z.object({ id: z.string(), version: z.string(), body: anyBody }),
  'ruleSets.deleteVersion': z.object({ id: z.string(), version: z.string() }),
  'ruleSets.execute': z.object({ id: z.string(), body: anyBody.optional() }),

  // Query groups
  'queryGroups.list': z.object({}),
  'queryGroups.create': z.object({ body: anyBody }),
  'queryGroups.get': z.object({ id: z.string() }),
  'queryGroups.update': z.object({ id: z.string(), body: anyBody }),
  'queryGroups.delete': z.object({ id: z.string() }),
  'queryGroups.listVersions': z.object({ id: z.string() }),
  'queryGroups.createVersion': z.object({ id: z.string(), body: anyBody }),
  'queryGroups.getVersion': z.object({ id: z.string(), version: z.string() }),
  'queryGroups.patchVersion': z.object({ id: z.string(), version: z.string(), body: anyBody }),
  'queryGroups.validateVersion': z.object({ id: z.string(), version: z.string() }),
};
