import * as fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { etlService } from '../lib/EtlService.js';
import { toError } from '../lib/toError.js';
import { reposRoute, withReposHandler, setEntityConcurrencyHeaders } from './route-helpers.js';
import {
  etljobSchema,
  etljobversionSchema,
  etlcolumnmappingSchema,
  etlcolumnmappingversionSchema,
  etlexecutionSchema,
} from '@sparql-query-lib/contracts/schema';
import { setupValidator } from '../lib/validator-setup.js';
import {
  getEtlJobsSchema,
  getEtlJobSchema,
  createEtlJobSchema,
  updateEtlJobSchema,
  deleteEtlJobSchema,
  getEtlJobVersionsSchema,
  getEtlJobVersionSchema,
  createEtlJobVersionSchema,
} from '@sparql-query-lib/contracts/schema';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';

export default async function etlJobRoutes(fastify: FastifyInstance) {
  /*
   * `/preview` takes arbitrary DuckDB SQL. Exempting a stateless helper from
   * library resolution is right in general — there is no entity to resolve —
   * but "no entity" is not "no consequence": submitted SQL is a host filesystem
   * read primitive, and being exempt meant any authenticated principal reached
   * it, a read-only grant on one library included. It is administrator-only
   * instead, which matches the posture the feature flag already takes (ETL is
   * an operator flow, off unless deliberately enabled). See issue #132 §4d and
   * docs/guides/etl.md.
   */
  registerEntityAuthGuard(fastify, {
    executeSuffixes: ['/execute', '/execute/stream', '/run'],
    adminSuffixes: ['/preview'],
  });

  const etlJobDetailSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      currentVersionId: { type: 'string' },
      libraryIds: { type: 'array', items: { type: 'string' } },
      dateCreated: { type: 'string' },
      dateModified: { type: 'string' },
    },
    required: ['id', 'name', 'libraryIds'],
    additionalProperties: false,
  } as const;

  const etlJobListSchema = {
    type: 'array',
    items: etlJobDetailSchema,
  } as const;

  const etlJobVersionDetailSchema = {
    type: 'object',
    required: ['id', 'isPartOf', 'version', 'sql', 'sparqlTemplate', 'backendId'],
    properties: {
      id: { type: 'string' },
      isPartOf: { type: 'string' },
      version: { type: 'integer' },
      immutable: { type: 'boolean' },
      sql: { type: 'string' },
      sparqlTemplate: { type: 'string' },
      backendId: { type: 'string' },
      currentColumnMappingVersionId: { type: 'string' },
      chunkSize: { type: 'integer' },
      comment: { type: 'string' },
      dateCreated: { type: 'string' },
      dateModified: { type: 'string' },
    },
  } as const;

  /**
   * One run of an ETL job as the API reports it — the log's row shape, shared
   * by the single-execution route and the per-job listing so the two cannot
   * drift. `outputTupleSetVersionId`/`outputReused` are the tabular sink's
   * outcome (issue #211); `outputFormat`/`outputLocation` are the file sink's.
   */
  const etlExecutionDetailSchema = {
    type: 'object',
    required: ['id', 'etlJobVersionId', 'columnMappingVersionId', 'status', 'startedAt'],
    properties: {
      id: { type: 'string' },
      etlJobVersionId: { type: 'string' },
      columnMappingVersionId: { type: 'string' },
      status: { type: 'string' },
      startedAt: { type: 'string' },
      completedAt: { type: 'string' },
      totalChunks: { type: 'integer' },
      completedChunks: { type: 'integer' },
      totalRows: { type: 'integer' },
      errorMessage: { type: 'string' },
      errorChunk: { type: 'integer' },
      outputFormat: { type: 'string' },
      outputLocation: { type: 'string' },
      outputTupleSetVersionId: { type: 'string' },
      outputReused: { type: 'boolean' },
      executionConfig: { type: 'string' },
    },
  } as const;

  setupValidator(fastify);
  const schemas = [
    etljobSchema,
    etljobversionSchema,
    etlcolumnmappingSchema,
    etlcolumnmappingversionSchema,
    etlexecutionSchema,
  ] as const;
  const registered = fastify.getSchemas();
  for (const schema of schemas) {
    const schemaId = (schema as { $id?: string }).$id;
    if (schemaId && !(schemaId in registered)) {
      const { $schema, ...rest } = schema as Record<string, unknown>;
      fastify.addSchema(rest);
    }
  }

  // List all ETL jobs
  fastify.get('/', ...reposRoute({
      response: {
        200: etlJobListSchema,
      },
    }, async ({ reply }) => {
    const result = await etlService.listEtlJobs();
    return reply.send(result);
  }));

  // Get ETL job by ID
  fastify.get('/:id', ...reposRoute({
      response: {
        200: etlJobDetailSchema,
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    }, async ({ request, reply }) => {
    const { id } = request.params as { id: string }; // this route's schema declares no params
    const result = await etlService.getEtlJob(id);
    if (!result) {
      return reply.code(404).send({ error: `ETL job ${id} not found` });
    }
    setEntityConcurrencyHeaders(reply, { dateModified: result.dateModified ?? null });
    return reply.send(result);
  }));

  // Create ETL job
  fastify.post('/', ...reposRoute({
      body: {
        type: 'object',
        required: ['name', 'libraryId'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          libraryId: { type: 'string' },
        },
        additionalProperties: false,
      },
      response: {
        201: etlJobDetailSchema,
        400: { type: 'object', properties: { error: { type: 'string' } } },
      },
    }, async ({ request, reply }) => {
    const body = request.body;
    const result = await etlService.createEtlJob(body as Parameters<typeof etlService.createEtlJob>[0]);
    return reply.code(201).send(result);
  }));

  // Update an ETL job's name/description
  fastify.patch('/:id', ...reposRoute({
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
        },
        additionalProperties: false,
      },
      response: {
        200: etlJobDetailSchema,
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    }, async ({ request, reply }) => {
    const { id } = request.params;
    const body = request.body as { name?: string; description?: string | null };
    const result = await etlService.updateEtlJob(id, body);
    if (!result) {
      return reply.code(404).send({ error: `ETL job ${id} not found` });
    }
    setEntityConcurrencyHeaders(reply, { dateModified: result.dateModified ?? null });
    return reply.send(result);
  }));

  // Create ETL job version
  fastify.post('/:id/versions', ...reposRoute({
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['sql', 'sparqlTemplate', 'backendId'],
        properties: {
          sql: { type: 'string' },
          sparqlTemplate: { type: 'string' },
          backendId: { type: 'string' },
          chunkSize: { type: 'integer' },
          comment: { type: 'string' },
          immutable: { type: 'boolean' },
        },
      },
      response: {
        201: {
          type: 'object',
          required: ['id', 'isPartOf', 'version', 'sql', 'sparqlTemplate', 'backendId'],
          properties: {
            id: { type: 'string' },
            isPartOf: { type: 'string' },
            version: { type: 'integer' },
            immutable: { type: 'boolean' },
            sql: { type: 'string' },
            sparqlTemplate: { type: 'string' },
            backendId: { type: 'string' },
            currentColumnMappingVersionId: { type: 'string' },
            chunkSize: { type: 'integer' },
            comment: { type: 'string' },
            dateCreated: { type: 'string' },
            dateModified: { type: 'string' },
          },
        },
      },
    }, async ({ request, reply }) => {
    const { id } = request.params;
    const body = request.body;
    const result = await etlService.createEtlJobVersion(id, body as Parameters<typeof etlService.createEtlJobVersion>[1]);
    return reply.code(201).send(result);
  }));

  // List an ETL job's versions
  fastify.get('/:id/versions', ...reposRoute({
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: etlJobVersionDetailSchema,
        },
      },
    }, async ({ request, reply }) => {
    const { id } = request.params;
    const result = await etlService.listEtlJobVersions(id);
    return reply.send(result);
  }));

  // Get ETL job version by ID
  fastify.get('/versions/:versionId', ...reposRoute({
      params: {
        type: 'object',
        required: ['versionId'],
        properties: {
          versionId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['id', 'isPartOf', 'version', 'sql', 'sparqlTemplate', 'backendId'],
          properties: {
            id: { type: 'string' },
            isPartOf: { type: 'string' },
            version: { type: 'integer' },
            immutable: { type: 'boolean' },
            sql: { type: 'string' },
            sparqlTemplate: { type: 'string' },
            backendId: { type: 'string' },
            currentColumnMappingVersionId: { type: 'string' },
            chunkSize: { type: 'integer' },
            comment: { type: 'string' },
            dateCreated: { type: 'string' },
            dateModified: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
    }, async ({ request, reply }) => {
    const { versionId } = request.params;
    const result = await etlService.getEtlJobVersion(versionId);
    if (!result) {
      return reply.code(404).send({ error: `ETL job version ${versionId} not found` });
    }
    setEntityConcurrencyHeaders(reply, { dateModified: result.dateModified ?? null });
    return reply.send(result);
  }));

  // PATCH /etl-jobs/versions/:versionId — annotate a version
  //
  // A version is a snapshot: its SQL, template and backend are what the
  // pipeline was when it was saved, so the comment is the only field this
  // writes. It is how a version gets a note now that saving asks for nothing.
  fastify.patch('/versions/:versionId', ...reposRoute({
      params: {
        type: 'object',
        required: ['versionId'],
        properties: {
          versionId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          comment: { type: 'string', nullable: true },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          required: ['id', 'isPartOf', 'version', 'sql', 'sparqlTemplate', 'backendId'],
          properties: {
            id: { type: 'string' },
            isPartOf: { type: 'string' },
            version: { type: 'integer' },
            immutable: { type: 'boolean' },
            sql: { type: 'string' },
            sparqlTemplate: { type: 'string' },
            backendId: { type: 'string' },
            currentColumnMappingVersionId: { type: 'string' },
            chunkSize: { type: 'integer' },
            comment: { type: 'string' },
            dateCreated: { type: 'string' },
            dateModified: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
    }, async ({ request, reply }) => {
    const { versionId } = request.params;
    const { comment } = (request.body ?? {}) as { comment?: string | null };
    const result = await etlService.annotateEtlJobVersion(versionId, comment ?? null);
    if (!result) {
      return reply.code(404).send({ error: `ETL job version ${versionId} not found` });
    }
    setEntityConcurrencyHeaders(reply, { dateModified: result.dateModified ?? null });
    return reply.send(result);
  }));

  // Create column mapping for ETL job version
  fastify.post('/versions/:versionId/column-mappings', ...reposRoute({
      params: {
        type: 'object',
        required: ['versionId'],
        properties: {
          versionId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['name', 'columns'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          columns: {
            type: 'array',
            items: {
              type: 'object',
              required: ['columnName', 'targetVariable', 'termType', 'nullPolicy'],
              properties: {
                columnName: { type: 'string' },
                targetVariable: { type: 'string' },
                termType: { type: 'string', enum: ['uri', 'literal'] },
                datatypeIri: { type: 'string' },
                lang: { type: 'string' },
                iriTemplate: { type: 'string' },
                nullPolicy: { type: 'string', enum: ['undef', 'skipRow'] },
              },
            },
          },
        },
      },
      response: {
        201: {
          type: 'object',
          required: ['id', 'name', 'etlJobVersionId'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            currentVersionId: { type: 'string' },
            etlJobVersionId: { type: 'string' },
            dateCreated: { type: 'string' },
            dateModified: { type: 'string' },
          },
        },
      },
    }, async ({ request, reply }) => {
    const { versionId } = request.params;
    const body = request.body;
    const result = await etlService.createColumnMapping(versionId, body as Parameters<typeof etlService.createColumnMapping>[1]);
    return reply.code(201).send(result);
  }));

  // Preview SQL
  fastify.post('/preview', ...reposRoute({
      body: {
        type: 'object',
        required: ['sql'],
        properties: {
          sql: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['schema', 'rows', 'inferredMapping'],
          properties: {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                required: ['columnName', 'duckdbType', 'nullable'],
                properties: {
                  columnName: { type: 'string' },
                  duckdbType: { type: 'string' },
                  nullable: { type: 'boolean' },
                },
              },
            },
            rows: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
            inferredMapping: {
              type: 'object',
              required: ['columns'],
              properties: {
                columns: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['columnName', 'targetVariable', 'termType', 'nullPolicy'],
                    properties: {
                      columnName: { type: 'string' },
                      targetVariable: { type: 'string' },
                      termType: { type: 'string' },
                      datatypeIri: { type: 'string' },
                      lang: { type: 'string' },
                      iriTemplate: { type: 'string' },
                      nullPolicy: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
    }, async ({ request, reply }) => {
    try {
      const body = request.body;
      const result = await etlService.preview(body as Parameters<typeof etlService.preview>[0]);
      return reply.send(result);
    } catch (error__u: unknown) {
      const error = toError(error__u);
      return reply.code(400).send({ error: error.message });
    }
  }));

  // Execute ETL job
  fastify.post('/:id/execute', ...reposRoute({
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          etlJobVersionId: { type: 'string' },
          columnMappingVersionId: { type: 'string' },
          chunkSize: { type: 'integer' },
          maxRows: { type: 'integer' },
          dryRun: { type: 'boolean' },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['executionId', 'status'],
          properties: {
            executionId: { type: 'string' },
            status: { type: 'string' },
            outputFormat: { type: 'string' },
            outputLocation: { type: 'string' },
            errorMessage: { type: 'string' },
            totalChunks: { type: 'integer' },
            completedChunks: { type: 'integer' },
            totalRows: { type: 'integer' },
          },
        },
        400: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
        404: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
    }, async ({ request, reply }) => {
    try {
      const { id } = request.params;
      const config = request.body;
      const result = await etlService.executeEtlJob(id, config as Parameters<typeof etlService.executeEtlJob>[1]);
      return reply.send(result);
    } catch (error__u: unknown) {
      const error = toError(error__u);
      if (error.message.includes('not found')) {
        return reply.code(404).send({ error: error.message });
      }
      return reply.code(400).send({ error: error.message });
    }
  }));

  // The runs of one job, newest first — the job's history, which the version
  // chain is not: a sink run that produced nothing new cuts no version by
  // design (issue #211), so without this the only record of it is here.
  fastify.get('/:id/executions', ...reposRoute({
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      },
      response: {
        200: {
          type: 'array',
          items: etlExecutionDetailSchema,
        },
        404: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
    }, async ({ request, reply }) => {
    const { id } = request.params;
    // 404 on the job rather than an empty list: "this job has never run" and
    // "there is no such job" are different answers, and an empty array says
    // the first.
    if (!(await etlService.getEtlJob(id))) {
      return reply.code(404).send({ error: `ETL job ${id} not found` });
    }
    return reply.send(await etlService.listExecutions(id, request.query.limit));
  }));

  // Get execution by ID
  fastify.get('/executions/:executionId', ...reposRoute({
      params: {
        type: 'object',
        required: ['executionId'],
        properties: {
          executionId: { type: 'string' },
        },
      },
      response: {
        200: etlExecutionDetailSchema,
        404: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
    }, async ({ request, reply }) => {
    const { executionId } = request.params;
    const result = await etlService.getExecution(executionId);
    if (!result) {
      return reply.code(404).send({ error: `Execution ${executionId} not found` });
    }
    return reply.send(result);
  }));

  // The RDF an execution wrote, streamed from disk. It is not in the execute
  // response because it can be as large as the source query's result; see
  // `EtlPipelineRun.onOutput`.
  fastify.get('/executions/:executionId/output', ...reposRoute({
      params: {
        type: 'object',
        required: ['executionId'],
        properties: {
          executionId: { type: 'string' },
        },
      },
      response: {
        404: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
    }, async ({ request, reply }) => {
    const { executionId } = request.params;
    const output = await etlService.getExecutionOutput(executionId);
    if (!output) {
      return reply.code(404).send({ error: `Execution ${executionId} has no output` });
    }
    let handle: fs.FileHandle;
    try {
      handle = await fs.open(output.location, 'r');
    } catch {
      return reply.code(404).send({ error: `Output of execution ${executionId} is no longer on disk` });
    }
    return reply.type(output.contentType).send(handle.createReadStream());
  }));

  // Get column mapping version
  fastify.get('/column-mappings/versions/:versionId', ...reposRoute({
      params: {
        type: 'object',
        required: ['versionId'],
        properties: {
          versionId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['id', 'isPartOf', 'version', 'columns'],
          properties: {
            id: { type: 'string' },
            isPartOf: { type: 'string' },
            version: { type: 'integer' },
            immutable: { type: 'boolean' },
            columns: {
              type: 'array',
              items: {
                type: 'object',
                required: ['columnName', 'targetVariable', 'termType', 'nullPolicy'],
                properties: {
                  columnName: { type: 'string' },
                  targetVariable: { type: 'string' },
                  termType: { type: 'string' },
                  datatypeIri: { type: 'string' },
                  lang: { type: 'string' },
                  iriTemplate: { type: 'string' },
                  nullPolicy: { type: 'string' },
                },
              },
            },
            comment: { type: 'string' },
            dateCreated: { type: 'string' },
            dateModified: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
    }, async ({ request, reply }) => {
    const { versionId } = request.params;
    const result = await etlService.getColumnMappingVersion(versionId);
    if (!result) {
      return reply.code(404).send({ error: `Column mapping version ${versionId} not found` });
    }
    setEntityConcurrencyHeaders(reply, { dateModified: result.dateModified ?? null });
    return reply.send(result);
  }));
}
