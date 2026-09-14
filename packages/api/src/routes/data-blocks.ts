import type { FastifyInstance } from 'fastify';
import { classifyVersionPatch } from '../lib/versionPatch.js';
import { mintId } from '../lib/id.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { LdkitDataBlock } from '../persistence/schemas/DataBlockSchema.js';
import type { LdkitDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import { reposRoute, validateIfMatch, setEntityConcurrencyHeaders, findVersionByNumber } from './route-helpers.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { analyseReferences, describeWrongType } from '../lib/entityReferences.js';
import { analyseTags } from '../lib/tagMembership.js';
import { createDataBlockSchema, updateDataBlockSchema } from '@sparql-query-lib/contracts/schema';
import { createDataBlockVersion, annotateDataBlockVersion } from '../lib/DataBlockVersionWriter.js';
import { ImmutableEntityError } from '../lib/immutability.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { filterReadable } from '../auth/enforce.js';

export const dataBlockResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
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

const dataBlockVersionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    isPartOf: { type: 'string' },
    version: { type: 'integer' },
    immutable: { type: 'boolean', nullable: true },
    dataString: { type: 'string' },
    normalizedInsertData: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
    defaultBackend: { type: 'string', nullable: true },
    grammarValid: { type: 'boolean', nullable: true },
    validationError: { type: 'string', nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'isPartOf', 'version', 'dataString'],
  additionalProperties: false,
} as const;

const createDataBlockVersionBodySchema = {
  type: 'object',
  properties: {
    dataString: { type: 'string' },
    comment: { type: 'string', nullable: true },
    defaultBackend: { type: 'string', nullable: true },
    immutable: { type: 'boolean', nullable: true },
    allowInvalidSave: { type: 'boolean', nullable: true },
  },
  required: ['dataString'],
  additionalProperties: false,
} as const;


/**
 * A version PATCH answers a content field with a 409 that says why, so the
 * shape carries the offending fields alongside the message.
 */
const contentPatchRejectedSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    fields: { type: 'array', items: { type: 'string' } },
  },
  required: ['error'],
} as const;

const annotateDataBlockVersionBodySchema = {
  type: 'object',
  properties: {
    dataString: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
    defaultBackend: { type: 'string', nullable: true },
    immutable: { type: 'boolean', nullable: true },
    allowInvalidSave: { type: 'boolean', nullable: true },
  },
  additionalProperties: false,
} as const;

export default async function (fastify: FastifyInstance) {
  /*
   * Both lists are empty because this plugin mounts nothing they would reach:
   * no route here executes, and none is a stateless helper. They carried
   * `/execute`, `/execute/stream`, `/run`, `/preview` and `/preview/normalize`,
   * copied from a plugin that has them — an exemption with no route behind it
   * is not inert, it is one waiting for the first route whose path ends that
   * way (`/rule-sets` left `POST /:id/srl/preview` unguarded exactly so).
   */
  registerEntityAuthGuard(fastify, { executeSuffixes: [], exemptSuffixes: [] });

  fastify.get('/', ...reposRoute({
      tags: ['DataBlock'],
      summary: 'List data blocks',
      response: {
        200: {
          type: 'array',
          items: dataBlockResponseSchema,
        },
      },
    }, async ({ repos, reply, request }) => {
    // Filtered rather than refused, for the reason `/rules` gives: an empty
    // array is the answer to "which of these may I see" when the answer is
    // none. This listing made no decision at all and answered with every data
    // block in the deployment.
    const items = repos.DataBlock.list() as LdkitDataBlock[];
    return reply.send(filterReadable(request, items).map(dataBlock => toRestApi(dataBlock)));
  }));

  fastify.post('/', ...reposRoute({
      tags: ['DataBlock'],
      summary: 'Create data block',
      body: createDataBlockSchema.body,
      response: {
        201: dataBlockResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const cacheCoordinator = getCacheCoordinator();
    const body = request.body;
    const name = String(body.name).trim();
    if (!name) {
      return reply.status(400).send({ error: 'Data block name is required' });
    }

    const rawIsPartOf = body.isPartOf;
    const isPartOfArray: string[] = Array.isArray(rawIsPartOf)
      ? rawIsPartOf.map((val: unknown) => String(val))
      : rawIsPartOf
        ? [String(rawIsPartOf)]
        : [];
    if (isPartOfArray.length === 0) {
      return reply.status(400).send({ error: 'Data block must be associated with at least one parent' });
    }

    const parents = analyseReferences('DataBlock', 'isPartOf', isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );

    if (parents.exactlyOneCount !== 1) {
      return reply.status(400).send({ error: 'Data block must belong to exactly one library' });
    }

    if (parents.missing.length > 0) {
      return reply.status(400).send({ error: `Referenced entity ${parents.missing[0]} does not exist` });
    }

    if (parents.wrongType.length > 0) {
      return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
    }

    const tagCheck = analyseTags('DataBlock', body.tags, isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    const id = mintId('dataBlock');
    const toCreate: Partial<LdkitDataBlock> & { $id: string } = {
      $id: id,
      name,
      description: body.description ?? null,
      isPartOf: isPartOfArray,
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
    };

    const created = await repos.DataBlock.create(toCreate);
    setEntityConcurrencyHeaders(reply, created);
    return reply.status(201).send(toRestApi(created));
  }));

  fastify.get('/:id', ...reposRoute({
      tags: ['DataBlock'],
      summary: 'Get data block',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: dataBlockResponseSchema,
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const entity = repos.DataBlock.get(id) as LdkitDataBlock | null;
    if (!entity) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, entity);
    return reply.send(toRestApi(entity));
  }));

  fastify.put('/:id', ...reposRoute({
      tags: ['DataBlock'],
      summary: 'Update data block',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: updateDataBlockSchema.body,
      response: {
        200: dataBlockResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const updates = request.body;
    const cacheCoordinator = getCacheCoordinator();

    const current = repos.DataBlock.get(id) as LdkitDataBlock | null;
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

    // The body schema admits `isPartOf` as a string or an array; ajv's
    // `coerceTypes: 'array'` has already wrapped the string form by the time we
    // get here, but normalising explicitly keeps the handler correct if that
    // option ever changes, and it is what gets persisted (queries.ts does the
    // same). `LdkitDataBlock.isPartOf` is `string[]`.
    let ids: string[] | undefined;
    if (updates.isPartOf) {
      ids = Array.isArray(updates.isPartOf)
        ? updates.isPartOf.map(val => String(val))
        : [String(updates.isPartOf)];
      const parents = analyseReferences('DataBlock', 'isPartOf', ids, iri => cacheCoordinator.get(iri));
      if (parents.exactlyOneCount !== 1) {
        return reply.status(400).send({ error: 'Data block must belong to exactly one library' });
      }
      if (parents.wrongType.length > 0) {
        return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
      }
    }

    // The update schema marks `name`, `description`, `comment` and
    // `currentVersion` `nullable: true`, so the inferred body is wider than
    // `LdkitDataBlock` — whose `name` is required and non-null. The schema
    // therefore lets a client null out a required field. Reconciling the two is
    // the entity-model consolidation (issue #65 Phase B); until then this is the
    // single point where the wire shape crosses into the domain, and it passes
    // values through exactly as before.
    const tagCheck = analyseTags('DataBlock', updates.tags, ids ?? current.isPartOf, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    const updated = await repos.DataBlock.update(id, {
      ...updates,
      ...(ids ? { isPartOf: ids } : {}),
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
    } as Partial<LdkitDataBlock>);
    if (!updated) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(toRestApi(updated));
  }));

  fastify.delete('/:id', ...reposRoute({
      tags: ['DataBlock'],
      summary: 'Delete data block and all its versions (cascading delete)',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        204: { type: 'null' },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const current = repos.DataBlock.get(id);
    if (!current) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    // Cascading delete: delete all versions first
    const versions = (repos.DataBlockVersion.list() as LdkitDataBlockVersion[]).filter(v => v.isPartOf === id);
    for (const version of versions) {
      await repos.DataBlockVersion.delete(version.$id);
    }

    // Then delete the parent data block
    await repos.DataBlock.delete(id);
    return reply.status(204).send();
  }));

  fastify.get('/:id/versions', ...reposRoute({
      tags: ['DataBlock'],
      summary: 'List data block versions',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'array',
          items: dataBlockVersionResponseSchema,
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.DataBlock.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Data block not found' });
    }
    const versions = (repos.DataBlockVersion.list() as LdkitDataBlockVersion[])
      .filter(v => v.isPartOf === id)
      .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    return reply.send(versions.map(v => toRestApi(v)));
  }));

  fastify.post('/:id/versions', ...reposRoute({
      tags: ['DataBlock'],
      summary: 'Create data block version',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: createDataBlockVersionBodySchema,
      response: {
        201: dataBlockVersionResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.DataBlock.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Data block not found' });
    }

    const body = request.body;
    const dataString = String(body.dataString || '');
    if (!dataString.trim()) {
      return reply.status(400).send({ error: 'dataString must be provided' });
    }

    try {
      const created = await createDataBlockVersion(id, {
        dataString,
        comment: body.comment ?? null,
        defaultBackend: body.defaultBackend ?? null,
        immutable: body.immutable ?? undefined,
        allowInvalidSave: body.allowInvalidSave ?? undefined,
      });
      setEntityConcurrencyHeaders(reply, created);
      return reply.status(201).send(toRestApi(created));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }));

  fastify.get('/:id/versions/:version', ...reposRoute({
      tags: ['DataBlock'],
      summary: 'Get data block version',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['id', 'version'],
      },
      response: {
        200: dataBlockVersionResponseSchema,
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const parent = repos.DataBlock.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Data block not found' });
    }

    const lookup = findVersionByNumber(
      repos.DataBlockVersion.list() as LdkitDataBlockVersion[],
      id,
      version,
      'data block',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;
    /*
     * No immutability check here, deliberately: this is the GET. It carried
     * `if (match.immutable) return 409 'Version is immutable; create a new
     * version instead.'` — a write guard in a read handler, so a version
     * frozen on purpose became the one version that could not be read back.
     * The route's own response schema never declared the 409, which is the
     * clearest sign it was not meant to be reachable from here.
     */
    setEntityConcurrencyHeaders(reply, match);
    return reply.send(toRestApi(match));
  }));

  fastify.delete('/:id/versions/:version', ...reposRoute({
      tags: ['DataBlock'],
      summary: 'Delete data block version',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['id', 'version'],
      },
      response: {
        204: {
          type: 'null',
          description: 'Data block version deleted successfully',
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const parent = repos.DataBlock.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Data block not found' });
    }

    const lookup = findVersionByNumber(
      repos.DataBlockVersion.list() as LdkitDataBlockVersion[],
      id,
      version,
      'data block',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;

    await repos.DataBlockVersion.delete(match.$id);
    return reply.status(204).send();
  }));

  // PATCH /data-blocks/:id/versions/:version — annotate a version
  //
  // A version is a snapshot (issue #192): `dataString` is what the block was
  // when it was saved, and a rule set version that names this version was
  // validated against exactly those triples. Only the comment is writable.
  fastify.patch('/:id/versions/:version', ...reposRoute({
      tags: ['DataBlock'],
      summary: 'Annotate a data block version (comment only; content is immutable)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['id', 'version'],
      },
      body: annotateDataBlockVersionBodySchema,
      response: {
        200: dataBlockVersionResponseSchema,
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
        409: contentPatchRejectedSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const parent = repos.DataBlock.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Data block not found' });
    }

    const lookup = findVersionByNumber(
      repos.DataBlockVersion.list() as LdkitDataBlockVersion[],
      id,
      version,
      'data block',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;

    const { annotations, rejection } = classifyVersionPatch(request.body as Record<string, unknown>);
    if (rejection) return reply.status(rejection.status).send(rejection);

    try {
      const updated = await annotateDataBlockVersion(match.$id, {
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
}
