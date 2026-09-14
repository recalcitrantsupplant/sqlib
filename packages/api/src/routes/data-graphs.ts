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
import { mintId } from '../lib/id.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { LdkitDataGraph } from '../persistence/schemas/DataGraphSchema.js';
import type { LdkitDataGraphVersion } from '../persistence/schemas/DataGraphVersionSchema.js';
import { reposRoute, validateIfMatch, setEntityConcurrencyHeaders, findVersionByNumber } from './route-helpers.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { analyseReferences, describeWrongType } from '../lib/entityReferences.js';
import { analyseTags } from '../lib/tagMembership.js';
import { createDataGraphSchema, updateDataGraphSchema } from '@sparql-query-lib/contracts/schema';
import { createDataGraphVersion, annotateDataGraphVersion } from '../lib/DataGraphVersionWriter.js';
import { DATA_GRAPH_FORMATS, DEFAULT_DATA_GRAPH_FORMAT, DataGraphContentError } from '../lib/dataGraphContent.js';
import { materializeDataGraphVersionFromQuery, DataGraphQuerySourceError } from '../lib/dataGraphFromQuery.js';
import { classifyVersionPatch } from '../lib/versionPatch.js';
import { ImmutableEntityError } from '../lib/immutability.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { filterReadable, resolveOwningLibrary, AuthorizationError } from '../auth/enforce.js';

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

const contentPatchRejectedSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    fields: { type: 'array', items: { type: 'string' } },
  },
  required: ['error'],
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

const versionParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    version: { type: 'string' },
  },
  required: ['id', 'version'],
} as const;

export default async function (fastify: FastifyInstance) {
  registerEntityAuthGuard(fastify, { executeSuffixes: [], exemptSuffixes: [] });

  fastify.get('/', ...reposRoute({
      tags: ['DataGraph'],
      summary: 'List data graphs',
      response: {
        200: { type: 'array', items: dataGraphResponseSchema },
      },
    }, async ({ repos, reply, request }) => {
    // Filtered rather than refused, for the reason `/rules` gives. This one
    // listed every data graph in the deployment, each with its current version
    // pointer — which `POST /:id/versions/from-query` then takes as a target.
    const items = repos.DataGraph.list() as LdkitDataGraph[];
    return reply.send(filterReadable(request, items).map(dataGraph => toRestApi(dataGraph)));
  }));

  fastify.post('/', ...reposRoute({
      tags: ['DataGraph'],
      summary: 'Create data graph',
      body: createDataGraphSchema.body,
      response: {
        201: dataGraphResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const cacheCoordinator = getCacheCoordinator();
    const body = request.body;
    const name = String(body.name ?? '').trim();
    if (!name) {
      return reply.status(400).send({ error: 'Data graph name is required' });
    }

    const rawIsPartOf = body.isPartOf;
    const isPartOfArray: string[] = Array.isArray(rawIsPartOf)
      ? rawIsPartOf.map((val: unknown) => String(val))
      : rawIsPartOf
        ? [String(rawIsPartOf)]
        : [];
    if (isPartOfArray.length === 0) {
      return reply.status(400).send({ error: 'Data graph must be associated with a library' });
    }

    const parents = analyseReferences('DataGraph', 'isPartOf', isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );

    if (parents.exactlyOneCount !== 1) {
      return reply.status(400).send({ error: 'Data graph must belong to exactly one library' });
    }
    if (parents.missing.length > 0) {
      return reply.status(400).send({ error: `Referenced entity ${parents.missing[0]} does not exist` });
    }
    if (parents.wrongType.length > 0) {
      return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
    }

    const tagCheck = analyseTags('DataGraph', body.tags, isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    const created = await repos.DataGraph.create({
      $id: mintId('dataGraph'),
      name,
      description: body.description ?? null,
      isPartOf: isPartOfArray,
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
    } as Partial<LdkitDataGraph> & { $id: string });
    setEntityConcurrencyHeaders(reply, created);
    return reply.status(201).send(toRestApi(created));
  }));

  fastify.get('/:id', ...reposRoute({
      tags: ['DataGraph'],
      summary: 'Get data graph',
      params: idParamSchema,
      response: {
        200: dataGraphResponseSchema,
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const entity = repos.DataGraph.get(id) as LdkitDataGraph | null;
    if (!entity) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, entity);
    return reply.send(toRestApi(entity));
  }));

  fastify.put('/:id', ...reposRoute({
      tags: ['DataGraph'],
      summary: 'Update data graph',
      params: idParamSchema,
      body: updateDataGraphSchema.body,
      response: {
        200: dataGraphResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const updates = request.body;
    const cacheCoordinator = getCacheCoordinator();

    const current = repos.DataGraph.get(id) as LdkitDataGraph | null;
    if (!current) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    const { valid, currentTag } = validateIfMatch(request, current);
    if (!valid) {
      return reply.status(412).send({
        error: 'Precondition Failed',
        expected: currentTag,
        current: toRestApi(current),
      });
    }

    let ids: string[] | undefined;
    if (updates.isPartOf) {
      ids = Array.isArray(updates.isPartOf)
        ? updates.isPartOf.map(val => String(val))
        : [String(updates.isPartOf)];
      const parents = analyseReferences('DataGraph', 'isPartOf', ids, iri => cacheCoordinator.get(iri));
      if (parents.exactlyOneCount !== 1) {
        return reply.status(400).send({ error: 'Data graph must belong to exactly one library' });
      }
      if (parents.wrongType.length > 0) {
        return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
      }
    }

    const tagCheck = analyseTags('DataGraph', updates.tags, ids ?? current.isPartOf, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    const updated = await repos.DataGraph.update(id, {
      ...updates,
      ...(ids ? { isPartOf: ids } : {}),
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
    } as Partial<LdkitDataGraph>);
    if (!updated) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(toRestApi(updated));
  }));

  fastify.delete('/:id', ...reposRoute({
      tags: ['DataGraph'],
      summary: 'Delete data graph and all its versions (cascading delete)',
      params: idParamSchema,
      response: {
        204: { type: 'null' },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const current = repos.DataGraph.get(id);
    if (!current) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    const versions = (repos.DataGraphVersion.list() as LdkitDataGraphVersion[]).filter(v => v.isPartOf === id);
    for (const version of versions) {
      await repos.DataGraphVersion.delete(version.$id);
    }

    await repos.DataGraph.delete(id);
    return reply.status(204).send();
  }));

  fastify.get('/:id/versions', ...reposRoute({
      tags: ['DataGraph'],
      summary: 'List data graph versions',
      params: idParamSchema,
      response: {
        200: { type: 'array', items: dataGraphVersionResponseSchema },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.DataGraph.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Data graph not found' });
    }
    const versions = (repos.DataGraphVersion.list() as LdkitDataGraphVersion[])
      .filter(v => v.isPartOf === id)
      .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    return reply.send(versions.map(v => toRestApi(v)));
  }));

  fastify.post('/:id/versions', ...reposRoute({
      tags: ['DataGraph'],
      summary: 'Create data graph version',
      params: idParamSchema,
      body: createDataGraphVersionBodySchema,
      response: {
        201: dataGraphVersionResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.DataGraph.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Data graph not found' });
    }

    const body = request.body;
    try {
      const created = await createDataGraphVersion(id, {
        contentString: String(body.contentString ?? ''),
        contentFormat: body.contentFormat ?? DEFAULT_DATA_GRAPH_FORMAT,
        comment: body.comment ?? null,
        immutable: body.immutable ?? undefined,
      });
      setEntityConcurrencyHeaders(reply, created);
      return reply.status(201).send(toRestApi(created));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }));

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

  fastify.get('/:id/versions/:version', ...reposRoute({
      tags: ['DataGraph'],
      summary: 'Get data graph version',
      params: versionParamSchema,
      response: {
        200: dataGraphVersionResponseSchema,
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const parent = repos.DataGraph.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Data graph not found' });
    }

    const lookup = findVersionByNumber(
      repos.DataGraphVersion.list() as LdkitDataGraphVersion[],
      id,
      version,
      'data graph',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;
    setEntityConcurrencyHeaders(reply, match);
    return reply.send(toRestApi(match));
  }));

  // PATCH /data-graphs/:id/versions/:version — annotate a version
  //
  // A version is a snapshot (issue #192): the content it holds is what the
  // graph was when it was saved. Only the comment about it is writable.
  fastify.patch('/:id/versions/:version', ...reposRoute({
      tags: ['DataGraph'],
      summary: 'Annotate a data graph version (comment only; content is immutable)',
      params: versionParamSchema,
      body: annotateVersionBodySchema,
      response: {
        200: dataGraphVersionResponseSchema,
        404: errorResponseSchema,
        409: contentPatchRejectedSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const parent = repos.DataGraph.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Data graph not found' });
    }

    const lookup = findVersionByNumber(
      repos.DataGraphVersion.list() as LdkitDataGraphVersion[],
      id,
      version,
      'data graph',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;

    const { annotations, rejection } = classifyVersionPatch(request.body as Record<string, unknown>);
    if (rejection) return reply.status(rejection.status).send(rejection);

    try {
      const updated = await annotateDataGraphVersion(match.$id, {
        comment: annotations.comment as string | null | undefined,
        immutable: annotations.immutable as boolean | undefined,
      });
      setEntityConcurrencyHeaders(reply, updated);
      return reply.send(toRestApi(updated));
    } catch (error) {
      if (error instanceof ImmutableEntityError) {
        return reply.status(409).send({ error: error.message });
      }
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }));

  fastify.delete('/:id/versions/:version', ...reposRoute({
      tags: ['DataGraph'],
      summary: 'Delete data graph version',
      params: versionParamSchema,
      response: {
        204: { type: 'null', description: 'Data graph version deleted successfully' },
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const parent = repos.DataGraph.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Data graph not found' });
    }

    const lookup = findVersionByNumber(
      repos.DataGraphVersion.list() as LdkitDataGraphVersion[],
      id,
      version,
      'data graph',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;

    await repos.DataGraphVersion.delete(match.$id);
    return reply.status(204).send();
  }));
}
