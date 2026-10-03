/**
 * Query group version validation: what `GET /query-groups/:id/v/:version/validate`
 * answers with.
 */
import { z } from 'zod';

export const queryGroupValidationIssueSchema = z.object({
  level: z.enum(['error', 'warning']),
  message: z.string(),
  entityType: z.string().optional(),
  entityId: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
});

export const queryGroupValidationResponseSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  issues: z.array(queryGroupValidationIssueSchema).optional(),
});

export type QueryGroupValidationResponse = z.infer<typeof queryGroupValidationResponseSchema>;
