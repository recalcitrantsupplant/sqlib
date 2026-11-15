/**
 * `/environments` — named version pointers inside one library.
 *
 * An environment ("dev", "test", "prod") points to at most one version of each
 * query, query group and rule set in its library. `lib/environments.ts`
 * resolves a float through it; this plugin defines environments and moves
 * their pointers.
 *
 * Two rules show up as code here:
 *
 * - **Defining environments is library administration.** Creating, renaming,
 *   reordering and deleting one needs `control` on the library, because every
 *   caller who resolves by name is affected.
 * - **A pointer moves only through `PUT /:id/pointers`.** That route checks the
 *   version belongs to an entity of this library, keeps one version per
 *   entity, can compare-and-set against the pointer the caller saw, and
 *   records who moved it as a `PointerMove`. The generic `PUT /:id` cannot
 *   touch `versions`.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { mintId } from '../lib/id.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { PersistedEnvironment } from '../persistence/schemas/EnvironmentSchema.js';
import type { PersistedPointerMove } from '../persistence/schemas/PointerMoveSchema.js';
import { reposRoute, validateIfMatch, setEntityConcurrencyHeaders } from './route-helpers.js';
import type { EntityRepositories } from '../lib/EntityRepositories.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { analyseReferences, describeWrongType } from '../lib/entityReferences.js';
import { createEnvironmentSchema, updateEnvironmentSchema } from '@sparql-query-lib/contracts/schema';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { authOf, filterReadable, requireEnvironmentMode, requireLibraryMode, resolveOwningLibrary } from '../auth/enforce.js';
import { getAuthStore } from '../auth/AuthStore.js';
import { isPromotableType, LATEST_ENVIRONMENT, partsBehind, PROMOTABLE_TYPES, startingVersions, versionIn } from '../lib/environments.js';

export const environmentResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    position: { type: 'integer', nullable: true },
    defaultBackend: { type: 'string', nullable: true },
    isPartOf: { type: 'string' },
    versions: { type: 'array', items: { type: 'string' }, nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'name', 'isPartOf'],
  additionalProperties: false,
} as const;

const pointerSchema = {
  type: 'object',
  properties: {
    entity: { type: 'string' },
    entityType: { type: 'string', enum: Object.keys(PROMOTABLE_TYPES) },
    entityName: { type: 'string', nullable: true },
    version: { type: 'string' },
    versionNumber: { type: 'integer', nullable: true },
    /** Who moved the pointer to this version. Null when no move is recorded. */
    movedBy: { type: 'string', nullable: true },
    movedAt: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['entity', 'entityType', 'version'],
  additionalProperties: false,
} as const;

const moveSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    entity: { type: 'string' },
    entityType: { type: 'string', nullable: true },
    entityName: { type: 'string', nullable: true },
    fromVersion: { type: 'string', nullable: true },
    fromVersionNumber: { type: 'integer', nullable: true },
    toVersion: { type: 'string', nullable: true },
    toVersionNumber: { type: 'integer', nullable: true },
    movedBy: { type: 'string', nullable: true },
    movedAt: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'entity'],
  additionalProperties: false,
} as const;

const MOVES_DEFAULT_LIMIT = 20;
const MOVES_MAX_LIMIT = 200;

const movesQuerystringSchema = {
  type: 'object',
  properties: {
    /** Only the moves of this query, query group or rule set. */
    entity: { type: 'string', minLength: 1 },
    limit: { type: 'integer', minimum: 1, maximum: MOVES_MAX_LIMIT, default: MOVES_DEFAULT_LIMIT },
  },
  additionalProperties: false,
} as const;

const errorResponseSchema = {
  type: 'object',
  properties: { error: { type: 'string' }, current: { type: 'string', nullable: true } },
  required: ['error'],
} as const;

const idParamSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

const listQuerystringSchema = {
  type: 'object',
  properties: { library: { type: 'string' } },
  additionalProperties: false,
} as const;

const movePointerBodySchema = {
  type: 'object',
  properties: {
    /** The query, query group or rule set whose pointer moves. */
    entity: { type: 'string', minLength: 1 },
    /** The version to point to, or null to clear the pointer. */
    version: { type: 'string', minLength: 1, nullable: true },
    /**
     * Compare-and-set: the version the caller believes the pointer holds now
     * (null for none). When present and different, the move is refused with
     * 409 and the current value, so two reviewers cannot both promote.
     */
    from: { type: 'string', nullable: true },
  },
  required: ['entity', 'version'],
  additionalProperties: false,
} as const;

type Entity = Record<string, unknown> & { $id: string; '@type'?: string; name?: string };

/**
 * The create body, plus `startFrom`: "latest" or an environment of the same
 * library whose pointers the new one copies. It is a create option, not a
 * field, so it is added here rather than to the entity schema.
 *
 * Seeding at create needs only `control`, the same as creating. The new
 * environment has no grants yet, so nobody can run or promote through it, and
 * a person with `control` can already read every version it copies. Moving a
 * pointer afterwards still needs `promote`.
 */
const createEnvironmentBody = {
  ...createEnvironmentSchema.body,
  properties: {
    ...createEnvironmentSchema.body.properties,
    startFrom: { type: 'string', minLength: 1, nullable: true },
  },
} as const;

/** Names are unique per library, compared exactly: "Prod" and "prod" are two. */
function findNameClash(
  repos: EntityRepositories,
  library: string,
  name: string,
  excludingId?: string,
): PersistedEnvironment | null {
  const existing = repos.Environment.list() as PersistedEnvironment[];
  return existing.find(env => env.isPartOf === library && env.$id !== excludingId && env.name === name) ?? null;
}

function checkName(name: string): string | null {
  if (!name) return 'Environment name is required';
  if (name === LATEST_ENVIRONMENT) {
    return `"${LATEST_ENVIRONMENT}" is every entity's current version and cannot be defined as an environment`;
  }
  return null;
}

function checkBackend(backend: unknown): string | null {
  if (backend === undefined || backend === null) return null;
  const found = getCacheCoordinator().get(String(backend)) as Entity | null;
  if (!found) return `Referenced entity ${String(backend)} does not exist`;
  if (found['@type'] !== 'Backend') return `${String(backend)} is not a backend`;
  return null;
}

/**
 * The recorded moves of an environment, newest first. Two moves in the same
 * millisecond keep the cache's order reversed, which is newest first for
 * moves this process wrote (the sort is stable).
 */
function movesOf(repos: EntityRepositories, envId: string): PersistedPointerMove[] {
  const moves = (repos.PointerMove.list() as PersistedPointerMove[]).filter(move => move.isPartOf === envId).reverse();
  return moves.sort((a, b) => String(b.dateCreated ?? '').localeCompare(String(a.dateCreated ?? '')));
}

function versionNumberOf(versionId: string | null | undefined): number | null {
  if (!versionId) return null;
  const version = getCacheCoordinator().get(versionId) as Entity | null;
  return typeof version?.version === 'number' ? version.version : null;
}

/** The pointers of an environment, one row per entity, for clients to display. */
function pointersOf(repos: EntityRepositories, env: PersistedEnvironment) {
  const cache = getCacheCoordinator();
  // The newest move to each version. A pointer set before moves were recorded,
  // or copied in when the environment was created, has none.
  const lastMoveTo = new Map<string, PersistedPointerMove>();
  for (const move of movesOf(repos, env.$id)) {
    if (move.toVersion && !lastMoveTo.has(move.toVersion)) lastMoveTo.set(move.toVersion, move);
  }
  const rows = [];
  for (const versionId of env.versions ?? []) {
    const version = cache.get(versionId) as Entity | null;
    const entity = version ? (cache.get(String(version.isPartOf ?? '')) as Entity | null) : null;
    if (!version || !entity || !isPromotableType(entity['@type'])) continue;
    rows.push({
      entity: entity.$id,
      entityType: entity['@type'],
      entityName: typeof entity.name === 'string' ? entity.name : null,
      version: versionId,
      versionNumber: typeof version.version === 'number' ? version.version : null,
      movedBy: lastMoveTo.get(versionId)?.createdBy ?? null,
      movedAt: lastMoveTo.get(versionId)?.dateCreated ?? null,
    });
  }
  return rows;
}

function logPointerMove(
  request: FastifyRequest,
  env: PersistedEnvironment,
  entity: string,
  from: string | null,
  to: string | null,
): void {
  request.log.warn(
    {
      audit: true,
      ts: new Date().toISOString(),
      requestId: request.id,
      subject: authOf(request).subject,
      pointerMove: { environment: env.$id, environmentName: env.name, library: env.isPartOf, entity, from, to },
    },
    'environment pointer moved',
  );
}

export default async function (fastify: FastifyInstance) {
  // The pointer routes check their own mode: Read on the library to list
  // pointers, `promote` on the environment to move one. Exempt from the guard
  // so a reviewer with `promote` does not also need Write on the library.
  registerEntityAuthGuard(fastify, { executeSuffixes: [], exemptSuffixes: ['/pointers', '/moves'] });

  fastify.get('/', ...reposRoute({
      tags: ['Environment'],
      summary: 'List environments',
      querystring: listQuerystringSchema,
      response: { 200: { type: 'array', items: environmentResponseSchema } },
    }, async ({ repos, reply, request }) => {
    const { library } = request.query;
    const items = repos.Environment.list() as PersistedEnvironment[];
    const scoped = library ? items.filter(env => env.isPartOf === library) : items;
    const ordered = [...scoped].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name),
    );
    return reply.send(filterReadable(request, ordered).map(env => toRestApi(env)));
  }));

  fastify.post('/', ...reposRoute({
      tags: ['Environment'],
      summary: 'Create environment',
      description: 'With `startFrom` ("latest" or an environment id of the same library), the new environment starts with those pointers.',
      body: createEnvironmentBody,
      response: { 201: environmentResponseSchema, 400: errorResponseSchema, 409: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const cacheCoordinator = getCacheCoordinator();
    const body = request.body;

    const name = String(body.name ?? '').trim();
    const nameError = checkName(name);
    if (nameError) return reply.status(400).send({ error: nameError });

    const library = String(body.isPartOf ?? '');
    const parents = analyseReferences('Environment', 'isPartOf', [library], iri => cacheCoordinator.get(iri));
    if (parents.missing.length > 0) {
      return reply.status(400).send({ error: `Referenced entity ${parents.missing[0]} does not exist` });
    }
    if (parents.wrongType.length > 0) {
      return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
    }
    requireLibraryMode(request, library, 'control');

    const backendError = checkBackend(body.defaultBackend);
    if (backendError) return reply.status(400).send({ error: backendError });

    if (findNameClash(repos, library, name)) {
      return reply.status(409).send({ error: `An environment named "${name}" already exists in this library` });
    }

    const seed = startingVersions(library, (body as { startFrom?: string | null }).startFrom);
    if (!seed.ok) return reply.status(400).send({ error: seed.error });

    const id = body.id || mintId('environment');
    if (cacheCoordinator.get(id)) {
      return reply.status(409).send({ error: `An entity with id ${id} already exists` });
    }

    const created = await repos.Environment.create({
      $id: id,
      name,
      description: body.description ?? null,
      position: body.position ?? null,
      defaultBackend: body.defaultBackend ?? null,
      isPartOf: library,
      versions: seed.versions,
    } as Partial<PersistedEnvironment> & { $id: string });

    setEntityConcurrencyHeaders(reply, created);
    return reply.status(201).send(toRestApi(created));
  }));

  fastify.get('/:id', ...reposRoute({
      tags: ['Environment'],
      summary: 'Get environment',
      params: idParamSchema,
      response: { 200: environmentResponseSchema, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const env = repos.Environment.get(request.params.id) as PersistedEnvironment | null;
    if (!env) return reply.status(404).send({ error: 'Not Found' });
    setEntityConcurrencyHeaders(reply, env);
    return reply.send(toRestApi(env));
  }));

  fastify.get('/:id/pointers', ...reposRoute({
      tags: ['Environment'],
      summary: 'List what an environment points to',
      description: 'One row per query, query group or rule set this environment has a version of.',
      params: idParamSchema,
      response: { 200: { type: 'array', items: pointerSchema }, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const env = repos.Environment.get(request.params.id) as PersistedEnvironment | null;
    if (!env) return reply.status(404).send({ error: 'Not Found' });
    requireLibraryMode(request, env.isPartOf, 'read');
    return reply.send(pointersOf(repos, env));
  }));

  fastify.get('/:id/moves', ...reposRoute({
      tags: ['Environment'],
      summary: 'List the pointer moves of an environment',
      description: 'Newest first. With `entity`, only the moves of that query, query group or rule set.',
      params: idParamSchema,
      querystring: movesQuerystringSchema,
      response: { 200: { type: 'array', items: moveSchema }, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const env = repos.Environment.get(request.params.id) as PersistedEnvironment | null;
    if (!env) return reply.status(404).send({ error: 'Not Found' });
    requireLibraryMode(request, env.isPartOf, 'read');
    const { entity, limit = MOVES_DEFAULT_LIMIT } = request.query;
    const cache = getCacheCoordinator();
    const moves = movesOf(repos, env.$id)
      .filter(move => !entity || move.movedEntity === entity)
      .slice(0, limit);
    return reply.send(moves.map(move => {
      const moved = cache.get(move.movedEntity) as Entity | null;
      return {
        id: move.$id,
        entity: move.movedEntity,
        entityType: typeof moved?.['@type'] === 'string' ? moved['@type'] : null,
        entityName: typeof moved?.name === 'string' ? moved.name : null,
        fromVersion: move.fromVersion ?? null,
        fromVersionNumber: versionNumberOf(move.fromVersion),
        toVersion: move.toVersion ?? null,
        toVersionNumber: versionNumberOf(move.toVersion),
        movedBy: move.createdBy ?? null,
        movedAt: move.dateCreated ?? null,
      };
    }));
  }));

  fastify.put('/:id', ...reposRoute({
      tags: ['Environment'],
      summary: 'Update environment',
      params: idParamSchema,
      body: updateEnvironmentSchema.body,
      response: {
        200: environmentResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
        412: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const updates = request.body;

    const current = repos.Environment.get(id) as PersistedEnvironment | null;
    if (!current) return reply.status(404).send({ error: 'Not Found' });
    requireLibraryMode(request, current.isPartOf, 'control');

    const { valid, currentTag } = validateIfMatch(request, current);
    if (!valid) {
      return reply.status(412).send({ error: 'Precondition Failed', expected: currentTag, current: toRestApi(current) });
    }

    if (updates.isPartOf !== undefined && String(updates.isPartOf) !== current.isPartOf) {
      return reply.status(400).send({ error: 'An environment cannot move between libraries' });
    }

    let name: string | undefined;
    if (updates.name !== undefined) {
      name = String(updates.name).trim();
      const nameError = checkName(name);
      if (nameError) return reply.status(400).send({ error: nameError });
      if (findNameClash(repos, current.isPartOf, name, id)) {
        return reply.status(409).send({ error: `An environment named "${name}" already exists in this library` });
      }
    }

    const backendError = checkBackend(updates.defaultBackend);
    if (backendError) return reply.status(400).send({ error: backendError });

    const updated = await repos.Environment.update(id, {
      ...updates,
      ...(name !== undefined ? { name } : {}),
      isPartOf: current.isPartOf,
      versions: current.versions ?? [],
    } as Partial<PersistedEnvironment>);
    if (!updated) return reply.status(404).send({ error: 'Not Found' });
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(toRestApi(updated));
  }));

  fastify.put('/:id/pointers', ...reposRoute({
      tags: ['Environment'],
      summary: 'Move an environment pointer',
      description:
        'Point this environment at one version of a query, query group or rule set, or clear its pointer ' +
        'with `version: null`. Needs `promote` on the environment. `from` makes the move compare-and-set.',
      params: idParamSchema,
      body: movePointerBodySchema,
      response: {
        200: environmentResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const { entity: entityId, version: versionId, from } = request.body;
    const cache = getCacheCoordinator();

    const env = repos.Environment.get(id) as PersistedEnvironment | null;
    if (!env) return reply.status(404).send({ error: 'Not Found' });
    requireEnvironmentMode(request, env, 'promote');

    const entity = cache.get(entityId) as Entity | null;
    if (!entity) return reply.status(400).send({ error: `Referenced entity ${entityId} does not exist` });
    if (!isPromotableType(entity['@type'])) {
      return reply.status(400).send({ error: `${entityId} is not a query, query group or rule set` });
    }
    if (entity['@type'] === 'Query' && entity.groupOnly === true && versionId !== null) {
      return reply.status(400).send({
        error: `${entityId} is used only inside query groups. Promote the group: its version pins this query's version.`,
      });
    }
    if (resolveOwningLibrary(entity) !== env.isPartOf) {
      return reply.status(400).send({ error: `${entityId} is not in this environment's library` });
    }

    if (versionId !== null) {
      const version = cache.get(versionId) as Entity | null;
      if (!version) return reply.status(400).send({ error: `Referenced entity ${versionId} does not exist` });
      if (version['@type'] !== PROMOTABLE_TYPES[entity['@type']] || version.isPartOf !== entityId) {
        return reply.status(400).send({ error: `${versionId} is not a version of ${entityId}` });
      }
    }

    const current = versionIn(env, entityId);
    if (from !== undefined && (from ?? null) !== current) {
      return reply.status(409).send({
        error: `The pointer moved: "${env.name}" now holds ${current ?? 'no version'} of ${entityId}`,
        current,
      });
    }

    const kept = (env.versions ?? []).filter(existing => existing !== current);
    const versions = versionId === null ? kept : [...kept, versionId];
    const updated = await repos.Environment.update(id, { versions } as Partial<PersistedEnvironment>);
    if (!updated) return reply.status(404).send({ error: 'Not Found' });

    if (current !== versionId) {
      logPointerMove(request, env, entityId, current, versionId);
      await repos.PointerMove.create({
        $id: mintId('pointerMove'),
        isPartOf: env.$id,
        movedEntity: entityId,
        fromVersion: current,
        toVersion: versionId,
      } as Partial<PersistedPointerMove> & { $id: string });
    }
    // A group promoted ahead of its parts is allowed; say how many parts the
    // environment holds at another version than the group pins.
    if (versionId !== null && entity['@type'] === 'QueryGroup') {
      reply.header('X-Parts-Behind', String(partsBehind(versionId, updated as PersistedEnvironment).length));
    }
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(toRestApi(updated));
  }));

  fastify.delete('/:id', ...reposRoute({
      tags: ['Environment'],
      summary: 'Delete environment',
      description: 'Its pointers and their recorded moves go with it, and so do the grants that name it.',
      params: idParamSchema,
      response: { 204: { type: 'null' }, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const env = repos.Environment.get(id) as PersistedEnvironment | null;
    if (!env) return reply.status(404).send({ error: 'Not Found' });
    requireLibraryMode(request, env.isPartOf, 'control');
    for (const move of movesOf(repos, id)) await repos.PointerMove.delete(move.$id);
    await repos.Environment.delete(id);
    await getAuthStore().deleteGrantsForEnvironment(id);
    return reply.status(204).send();
  }));
}
