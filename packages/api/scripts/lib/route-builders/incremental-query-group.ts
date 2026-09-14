/**
 * Query group version validation route.
 *
 * This file also carried eight incremental write schemas — add/update for I/O
 * entities, execution nodes and edges, plus start/end node updates. They were
 * removed: they formed a second write path into a version that skipped the
 * immutability guard and the If-Match concurrency check `PATCH /:id/v/:version`
 * enforces, and no client called them. Whole-graph writes go through
 * `POST /:id/v`. See git history if they need to come back.
 */

export const incrementalQueryGroupSchemas = {
  validateQueryGroupVersionSchema: {
    tags: ['QueryGroup', 'Validation'],
    summary: 'Validate a query group version',
    description: 'Performs validation checks on the query group graph structure, including edge connectivity, I/O entity references, and node configuration.',
    params: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Query group IRI' },
        version: { type: 'string', description: 'Version number' },
      },
      required: ['id', 'version'],
      additionalProperties: false,
    },
    response: {
      200: {
        type: 'object',
        properties: {
          valid: {
            type: 'boolean',
            description: 'Whether the graph is valid (true if no errors)'
          },
          errors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of error messages (blocking issues)'
          },
          warnings: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of warning messages (non-blocking issues)'
          },
          issues: {
            type: 'array',
            description: 'Detailed validation issues including structured metadata for each finding',
            items: {
              type: 'object',
              properties: {
                level: { type: 'string', enum: ['error', 'warning'] },
                message: { type: 'string' },
                entityType: { type: 'string', nullable: true },
                entityId: { type: 'string', nullable: true },
                code: { type: 'string', nullable: true },
              },
              required: ['level', 'message'],
              additionalProperties: false,
            },
          },
        },
        required: ['valid', 'errors', 'warnings'],
        additionalProperties: false,
      },
      404: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
      },
      500: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
      },
    },
  },
};
