/**
 * `/tags` — classification within a library.
 *
 * A tag is not a container and not a second level of the hierarchy. Entities
 * carry zero or more of them via `sqlib:hasTag`, keep belonging to exactly one
 * library via `sdo:isPartOf`, and an untagged entity is the normal state rather
 * than a member of some default group.
 *
 * Two consequences show up as code here rather than as prose:
 *
 * - **Delete unlabels, it does not cascade.** Removing a tag must not remove
 *   what was tagged, so `DELETE /tags/:id` sweeps the taggable types and strips
 *   the reference before deleting the tag itself.
 * - **A tag never leaves its library.** `isPartOf` is scalar and immutable
 *   after creation; moving a tag between libraries would silently unlabel
 *   everything carrying it, and "delete it and make another" says that plainly.
 */

import type { FastifyInstance } from 'fastify';
import { mintId } from '../lib/id.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { LdkitTag } from '../persistence/schemas/TagSchema.js';
import { reposRoute, validateIfMatch, setEntityConcurrencyHeaders } from './route-helpers.js';
import type { EntityRepositories } from '../lib/EntityRepositories.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { analyseReferences, describeWrongType } from '../lib/entityReferences.js';
import { TAGGABLE_TYPES } from '../lib/tagMembership.js';
import { createTagSchema, updateTagSchema } from '@sparql-query-lib/contracts/schema';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { filterReadable } from '../auth/enforce.js';

export const tagResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    color: { type: 'string', nullable: true },
    isPartOf: { type: 'string' },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'name', 'isPartOf'],
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

const listQuerystringSchema = {
  type: 'object',
  properties: {
    library: { type: 'string' },
  },
  additionalProperties: false,
} as const;

/**
 * Names are compared case- and space-insensitively.
 *
 * `Geo` and `geo` in one library are two rows that read as one thing in a chip
 * row, which is the only place a tag is ever seen. Storage keeps what was
 * typed; only the comparison folds.
 */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function findNameClash(
  repos: EntityRepositories,
  library: string,
  name: string,
  excludingId?: string,
): LdkitTag | null {
  const key = nameKey(name);
  const existing = repos.Tag.list() as LdkitTag[];
  return (
    existing.find(
      tag => tag.isPartOf === library && tag.$id !== excludingId && nameKey(tag.name) === key,
    ) ?? null
  );
}

export default async function (fastify: FastifyInstance) {
  registerEntityAuthGuard(fastify, { executeSuffixes: [], exemptSuffixes: [] });

  fastify.get('/', ...reposRoute({
      tags: ['Tag'],
      summary: 'List tags',
      querystring: listQuerystringSchema,
      response: {
        200: { type: 'array', items: tagResponseSchema },
      },
    }, async ({ repos, reply, request }) => {
    const { library } = request.query;
    const items = repos.Tag.list() as LdkitTag[];
    const scoped = library ? items.filter(tag => tag.isPartOf === library) : items;
    return reply.send(filterReadable(request, scoped).map(tag => toRestApi(tag)));
  }));

  fastify.post('/', ...reposRoute({
      tags: ['Tag'],
      summary: 'Create tag',
      body: createTagSchema.body,
      response: {
        201: tagResponseSchema,
        400: errorResponseSchema,
        409: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const cacheCoordinator = getCacheCoordinator();
    const body = request.body;

    const name = String(body.name ?? '').trim();
    if (!name) {
      return reply.status(400).send({ error: 'Tag name is required' });
    }

    const library = String(body.isPartOf ?? '');
    const parents = analyseReferences('Tag', 'isPartOf', [library], iri =>
      cacheCoordinator.get(iri)
    );
    if (parents.missing.length > 0) {
      return reply.status(400).send({ error: `Referenced entity ${parents.missing[0]} does not exist` });
    }
    if (parents.wrongType.length > 0) {
      return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
    }

    const clash = findNameClash(repos, library, name);
    if (clash) {
      return reply.status(409).send({ error: `A tag named "${clash.name}" already exists in this library` });
    }

    const created = await repos.Tag.create({
      $id: body.id || mintId('tag'),
      name,
      description: body.description ?? null,
      color: body.color ?? null,
      isPartOf: library,
    } as Partial<LdkitTag> & { $id: string });

    setEntityConcurrencyHeaders(reply, created);
    return reply.status(201).send(toRestApi(created));
  }));

  fastify.get('/:id', ...reposRoute({
      tags: ['Tag'],
      summary: 'Get tag',
      params: idParamSchema,
      response: {
        200: tagResponseSchema,
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const tag = repos.Tag.get(id) as LdkitTag | null;
    if (!tag) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, tag);
    return reply.send(toRestApi(tag));
  }));

  fastify.put('/:id', ...reposRoute({
      tags: ['Tag'],
      summary: 'Update tag',
      params: idParamSchema,
      body: updateTagSchema.body,
      response: {
        200: tagResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
        412: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const updates = request.body;

    const current = repos.Tag.get(id) as LdkitTag | null;
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

    // A tag that changed library would silently unlabel everything carrying it,
    // since every one of those entities lives in the library it is leaving.
    if (updates.isPartOf !== undefined && String(updates.isPartOf) !== current.isPartOf) {
      return reply.status(400).send({
        error: 'A tag cannot move between libraries; delete it and create one in the target library',
      });
    }

    let name: string | undefined;
    if (updates.name !== undefined) {
      name = String(updates.name).trim();
      if (!name) {
        return reply.status(400).send({ error: 'Tag name is required' });
      }
      const clash = findNameClash(repos, current.isPartOf, name, id);
      if (clash) {
        return reply.status(409).send({ error: `A tag named "${clash.name}" already exists in this library` });
      }
    }

    const updated = await repos.Tag.update(id, {
      ...updates,
      ...(name !== undefined ? { name } : {}),
      isPartOf: current.isPartOf,
    } as Partial<LdkitTag>);
    if (!updated) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(toRestApi(updated));
  }));

  fastify.delete('/:id', ...reposRoute({
      tags: ['Tag'],
      summary: 'Delete tag',
      params: idParamSchema,
      response: {
        204: { type: 'null' },
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const tag = repos.Tag.get(id) as LdkitTag | null;
    if (!tag) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    // Unlabel before deleting. Doing it in the other order would leave a window
    // where entities reference an id that resolves to nothing, and the sweep is
    // what makes "deleting a tag is safe" true rather than merely intended.
    for (const type of TAGGABLE_TYPES) {
      const repo = repos[type];
      const carriers = (repo.list() as Array<{ $id: string; tags?: string[] | null }>).filter(
        entity => entity.tags?.includes(id)
      );
      for (const carrier of carriers) {
        await repo.update(carrier.$id, {
          tags: (carrier.tags ?? []).filter(value => value !== id),
        } as never);
      }
    }

    await repos.Tag.delete(id);
    return reply.status(204).send();
  }));
}
