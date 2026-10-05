/**
 * `/data-graphs` — reference and example RDF, registered in the library.
 *
 * The same move backends made for remote capabilities: if you can register the
 * endpoint you query, you should be able to register the data you develop
 * against. A DataGraph is the stable identity; a DataGraphVersion is immutable
 * content, so a run that names a version id is reproducible forever.
 *
 * What this is *not* is a DATA block. DATA blocks are part of a rule set and
 * appear in its inference graph; a data graph is the input the rules run
 * against and never appears in the output. That distinction is the whole reason
 * this entity exists — see `docs/concepts.md`.
 */

import type { FastifyInstance } from 'fastify';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import { reposRoute, setEntityConcurrencyHeaders } from './route-helpers.js';
import { registerVersionedEntityRoutes, type StoredEntity } from './versionedEntity.js';
import { createDataGraphSchema, updateDataGraphSchema } from '@sparql-query-lib/contracts/schema';
import { createDataGraphVersion, annotateDataGraphVersion } from '../lib/DataGraphVersionWriter.js';
import { DATA_GRAPH_FORMATS, DEFAULT_DATA_GRAPH_FORMAT, DataGraphContentError, type DataGraphFormat } from '../lib/dataGraphContent.js';
import { materializeDataGraphVersionFromQuery, DataGraphQuerySourceError } from '../lib/dataGraphFromQuery.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { clearBrowserDefaultsNaming } from '../lib/browserDefaults.js';
import { getEntityRepositories } from '../lib/CacheCoordinatorProvider.js';
import { AuthorizationError, resolveOwningLibrary } from '../auth/enforce.js';

export const dataGraphResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    currentVersion: { type: 'string', nullable: true },
    isPartOf: {
      type: 'array',
      items: { type: 'string' },
    },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
    tags: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
    },
  },
  required: ['id', 'name', 'isPartOf'],
  additionalProperties: false,
} as const;

const dataGraphVersionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    isPartOf: { type: 'string' },
    version: { type: 'integer' },
    immutable: { type: 'boolean', nullable: true },
    contentString: { type: 'string' },
    contentFormat: { type: 'string' },
    tripleCount: { type: 'integer', nullable: true },
    byteSize: { type: 'integer', nullable: true },
    grammarValid: { type: 'boolean', nullable: true },
    validationError: { type: 'string', nullable: true },
    sourceQueryVersion: { type: 'string', nullable: true },
    sourceArgumentSetVersion: { type: 'string', nullable: true },
    sourceBackend: { type: 'string', nullable: true },
    sourceExecutedAt: { type: 'string', format: 'date-time', nullable: true },
    sourceResultHash: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'isPartOf', 'version', 'contentString', 'contentFormat'],
  additionalProperties: false,
} as const;

const createDataGraphVersionBodySchema = {
  type: 'object',
  properties: {
    contentString: { type: 'string' },
    contentFormat: { type: 'string', enum: [...DATA_GRAPH_FORMATS], nullable: true },
    comment: { type: 'string', nullable: true },
    immutable: { type: 'boolean', nullable: true },
  },
  required: ['contentString'],
  additionalProperties: false,
} as const;

const createDataGraphVersionFromQueryBodySchema = {
  type: 'object',
  properties: {
    queryVersionId: { type: 'string' },
    argumentSetVersionId: { type: 'string', nullable: true },
    backendId: { type: 'string' },
    comment: { type: 'string', nullable: true },
  },
  required: ['queryVersionId', 'backendId'],
  additionalProperties: false,
} as const;

/**
 * What a version PATCH may carry. Content fields are still *accepted* by the
 * wire schema so the handler can answer them with the 409 that says why, rather
 * than a bare "must NOT have additional properties".
 */
const annotateVersionBodySchema = {
  type: 'object',
  properties: {
    contentString: { type: 'string', nullable: true },
    contentFormat: { type: 'string', enum: [...DATA_GRAPH_FORMATS], nullable: true },
    comment: { type: 'string', nullable: true },
    immutable: { type: 'boolean', nullable: true },
  },
  additionalProperties: false,
} as const;

const errorResponseSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

const idParamSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

export default async function (fastify: FastifyInstance) {
  registerEntityAuthGuard(fastify, { executeSuffixes: [], exemptSuffixes: [] });

  registerVersionedEntityRoutes(fastify, {
    noun: 'data graph',
    type: 'DataGraph',
    versionType: 'DataGraphVersion',
    idKind: 'dataGraph',
    schemas: {
      list: { tags: ['DataGraph'], summary: 'List data graphs', response: { 200: { type: 'array', items: dataGraphResponseSchema } } },
      create: { tags: ['DataGraph'], summary: 'Create data graph', body: createDataGraphSchema.body, response: { 201: dataGraphResponseSchema } },
      get: { tags: ['DataGraph'], summary: 'Get data graph', response: { 200: dataGraphResponseSchema } },
      update: { tags: ['DataGraph'], summary: 'Update data graph', body: updateDataGraphSchema.body, response: { 200: dataGraphResponseSchema } },
      // Refused, not cascaded, while a saved test version pins
      // one of its versions: those would name content that is gone.
      delete: { tags: ['DataGraph'], summary: 'Delete data graph and all its versions (cascading delete)', response: { 204: { type: 'null' } } },
      listVersions: { tags: ['DataGraph'], summary: 'List data graph versions', response: { 200: { type: 'array', items: dataGraphVersionResponseSchema } } },
      createVersion: { tags: ['DataGraph'], summary: 'Create data graph version', body: createDataGraphVersionBodySchema, response: { 201: dataGraphVersionResponseSchema } },
      getVersion: { tags: ['DataGraph'], summary: 'Get data graph version', response: { 200: dataGraphVersionResponseSchema } },
      patchVersion: {
        tags: ['DataGraph'],
        summary: 'Annotate a data graph version (comment only; content is immutable)',
        body: annotateVersionBodySchema,
        response: { 200: dataGraphVersionResponseSchema },
      },
      deleteVersion: { tags: ['DataGraph'], summary: 'Delete data graph version', response: { 204: { type: 'null', description: 'Data graph version deleted successfully' } } },
    },
    createVersion: async ({ parent, body }) => {
      const created = await createDataGraphVersion(parent.$id, {
        contentString: String(body.contentString ?? ''),
        contentFormat: (body.contentFormat as DataGraphFormat | null | undefined) ?? DEFAULT_DATA_GRAPH_FORMAT,
        comment: (body.comment as string | null | undefined) ?? null,
        immutable: (body.immutable as boolean | null | undefined) ?? undefined,
      });
      return { created: created as unknown as StoredEntity };
    },
    // A version is a snapshot (issue #192): the content it holds is what the
    // graph was when it was saved. Only the comment about it is writable.
    annotateVersion: async (version, annotations) => await annotateDataGraphVersion(version.$id, {
      comment: annotations.comment as string | null | undefined,
      immutable: annotations.immutable as boolean | undefined,
    }) as unknown as StoredEntity,
    /*
     * A browser default naming the graph or one of its versions is a starting
     * selection, not a pin, so it is cleared rather than refusing the delete.
     */
    deleteVersion: async (version) => {
      await clearBrowserDefaultsNaming(new Set([version.$id]));
      await getEntityRepositories().DataGraphVersion.delete(version.$id);
    },
    beforeDelete: entity => clearBrowserDefaultsNaming(new Set([entity.$id])),
  });

  // POST /:id/versions/from-query — materialize a version by running a
  // CONSTRUCT/DESCRIBE query against a backend, rather than uploading content
  // by hand. See `materializeDataGraphVersionFromQuery` (issue #153).
  fastify.post('/:id/versions/from-query', ...reposRoute({
      tags: ['DataGraph'],
      summary: 'Create a data graph version by running a CONSTRUCT/DESCRIBE query against a backend',
      params: idParamSchema,
      body: createDataGraphVersionFromQueryBodySchema,
      response: {
        // 200 is the unchanged re-run: the query was executed, it produced what
        // the current version already holds from the same query, argument set
        // and backend, and no version was cut.
        200: dataGraphVersionResponseSchema,
        201: dataGraphVersionResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
        502: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.DataGraph.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Data graph not found' });
    }

    const body = request.body;
    try {
      const { version, reused } = await materializeDataGraphVersionFromQuery(
        id,
        {
          queryVersionId: body.queryVersionId,
          argumentSetVersionId: body.argumentSetVersionId ?? null,
          backendId: body.backendId,
          comment: body.comment ?? null,
        },
        { request, viaLibrary: resolveOwningLibrary(parent) },
      );
      setEntityConcurrencyHeaders(reply, version);
      return reply.status(reused ? 200 : 201).send(toRestApi(version));
    } catch (error) {
      if (error instanceof DataGraphContentError) {
        return reply.status(400).send({ error: error.message });
      }
      if (error instanceof DataGraphQuerySourceError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      if (error instanceof AuthorizationError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(502).send({ error: `Failed to execute the source query against the backend: ${message}` });
    }
  }));

}
