import type { FastifyInstance } from 'fastify';
import { ArgumentSetService } from '../lib/ArgumentSetService.js';
import {
  argumentSetCreateBodySchema,
  argumentSetIdParamSchema,
  argumentSetListResponseSchema,
  argumentSetResponseSchema,
  argumentSetVersionBodySchema,
  argumentSetVersionListResponseSchema,
  argumentSetVersionParamSchema,
  argumentSetVersionPatchSchema,
  argumentSetVersionResponseSchema,
} from './argument-set-schemas.js';
import { reposRoute, setEntityConcurrencyHeaders, validateIfMatch } from './route-helpers.js';
import { classifyVersionPatch } from '../lib/versionPatch.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { AuthorizationError, requireEntityMode, requireLibraryMode } from '../auth/enforce.js';

const SPARQL_ARGUMENTS_MEDIA_TYPE = 'application/sparql-arguments+json';

/**
 * A version PATCH answers a content field with a 409 that says why, so the
 * shape carries the offending fields alongside the message — the same response
 * every other version route gives (`lib/versionPatch.ts`).
 */
const contentPatchRejectedSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    fields: { type: 'array', items: { type: 'string' } },
  },
  required: ['error'],
} as const;

const service = new ArgumentSetService();

/**
 * What an export answers with.
 *
 * `items` used to be a bare `{ type: 'object' }`. fast-json-stringify treats an
 * object schema that declares neither `properties` nor `additionalProperties`
 * as "no properties to emit", so every element serialised as `{}` — the whole
 * array came back the right length and completely empty. The run never noticed
 * (it resolves arguments in-process and never crosses this route), so what
 * looked like a display quirk in the tests screen was also handing "Copy
 * execution payload" a silently unparameterised payload.
 *
 * `limits` and `offsets` have a shape worth declaring; a runtime argument is an
 * SRJ head plus bindings, which is nested and better passed through whole.
 */
const namedNumberItem = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    value: { type: 'number' },
  },
  required: ['name', 'value'],
  additionalProperties: false,
} as const;

const executionPayloadResponseSchema = {
  type: 'object',
  properties: {
    arguments: { type: 'array', items: { type: 'object', additionalProperties: true } },
    limits: { type: 'array', items: namedNumberItem },
    offsets: { type: 'array', items: namedNumberItem },
  },
  required: ['arguments', 'limits', 'offsets'],
  additionalProperties: true,
} as const;

export default async function argumentSetRoutes(fastify: FastifyInstance) {
  /*
   * No suffix lists: this plugin mounts `/`, `/:id`, `/:id/export`, `/:id/v`,
   * `/:id/v/:version` and `/:id/v/:version/export`, and nothing else. It
   * carried `executeSuffixes: ['/execute', '/execute/stream', '/run']` and
   * `exemptSuffixes: ['/preview']`, four paths it has never had a route for —
   * dead entries that match by *suffix*, so each was a standing offer to
   * exempt or re-mode whatever route someone mounted under one of those names
   * next. Trimmed for the reason `/rule-sets` was: an exemption should be a
   * claim about a handler that exists.
   */
  registerEntityAuthGuard(fastify);

  /**
   * `GET /argument-sets?libraryId=…` — the listing the switcher's "elsewhere in
   * the library" needs (`2026-08-14-query-arguments.md` §7). It could not exist
   * before `ArgumentSet.isPartOf`, because the only path to a library ran
   * through each set's target, making enumeration one request per query.
   */
  fastify.get('/', ...reposRoute({
      querystring: {
        type: 'object',
        properties: { libraryId: { type: 'string' } },
        required: ['libraryId'],
        additionalProperties: false,
      },
      response: {
        200: argumentSetListResponseSchema,
      },
    }, async ({ request, reply }) => {
    const { libraryId } = request.query;
    requireLibraryMode(request, libraryId, 'read');
    return reply.send(await service.listForLibrary(libraryId));
  }));

  /**
   * `POST /argument-sets` — a set composed on the rail.
   *
   * Creation used to live only under a callable (`POST /queries/:id/argument-sets`),
   * which derived the library from the target. A set composed from the rail has
   * no target, so it names its library instead. `entityGuard` reads `libraryId`
   * off the body (`CONTAINER_BODY_KEYS`) to scope the write, so no guard change
   * is needed here.
   *
   * `scope` and `targetId` remain accepted as provenance, and the service
   * refuses a target whose library disagrees rather than letting `isPartOf` and
   * `targetEntity` point at different places.
   */
  fastify.post('/', ...reposRoute({
      body: argumentSetCreateBodySchema,
      response: {
        201: argumentSetResponseSchema,
        400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ request, reply }) => {
    const body = request.body;
    requireLibraryMode(request, body.libraryId, 'write');
    try {
      const detail = await service.create({
        name: body.name,
        description: body.description,
        libraryId: body.libraryId,
        scope: body.scope ?? null,
        targetId: body.targetId ?? null,
        tupleBindings: body.tupleBindings,
        scalarBindings: body.scalarBindings,
        graphBindings: body.graphBindings,
      }, { request });
      return reply.code(201).send(detail);
    } catch (error) {
      /*
       * A refused pin is not the caller's to fix by editing the body, and it
       * carries its own status: without this, the 403 the service now raises
       * for a `tupleSetVersions` or `dataGraphVersionId` in a library the
       * caller cannot read would be flattened into a 400 here, which reads as
       * "malformed" and tells a client to retry differently.
       */
      if (error instanceof AuthorizationError) throw error;
      // Everything else the service throws here is the caller's to fix: an
      // unknown library, a target in another library, a graph binding naming
      // both sources or neither.
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to create argument set' });
    }
  }));

  fastify.get('/:id', ...reposRoute({
      params: argumentSetIdParamSchema,
      response: {
        200: argumentSetResponseSchema,
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ request, reply }) => {
    const { id } = request.params;
    const detail = await service.getById(id);
    if (!detail) {
      return reply.code(404).send({ error: `Argument set ${id} not found` });
    }
    setEntityConcurrencyHeaders(reply, { dateModified: detail.dateModified ?? null });
    return reply.send(detail);
  }));

  fastify.delete('/:id', ...reposRoute({
      params: argumentSetIdParamSchema,
      response: {
        204: { type: 'null' },
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ request, reply }) => {
    const { id } = request.params;
    const detail = await service.getById(id);
    if (!detail) {
      return reply.code(404).send({ error: `Argument set ${id} not found` });
    }
    const { valid, currentTag } = validateIfMatch(request, { dateModified: detail.dateModified });
    if (!valid) {
      return reply.code(412).send({ error: 'If-Match header does not match current entity tag' });
    }
    await service.delete(id);
    if (currentTag) {
      reply.header('ETag', `"${currentTag.replace(/"/g, '')}"`);
    }
    return reply.code(204).send();
  }));

  fastify.get('/:id/export', ...reposRoute({
      params: argumentSetIdParamSchema,
      response: {
        200: executionPayloadResponseSchema,
      },
    }, async ({ request, reply }) => {
    const { id } = request.params;
    /*
     * Either spelling. A set means "whatever it says now"; a version means
     * "this, frozen" — and a caller that pinned one had nowhere else to send
     * it, since the version route is keyed by set id plus version *number*.
     */
    const resolved = service.resolveExportVersionId(id);
    if ('problem' in resolved) {
      return resolved.problem === 'no-current-version'
        ? reply.code(409).send({ error: `Argument set ${id} has no current version` })
        : reply.code(404).send({ error: `Argument set ${id} not found` });
    }
    try {
      const payload = await service.exportAsExecutionPayload(resolved.versionId);
      reply.header('Content-Type', SPARQL_ARGUMENTS_MEDIA_TYPE);
      return reply.send(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(409).send({ error: message });
    }
  }));

  fastify.get('/:id/v', ...reposRoute({
      params: argumentSetIdParamSchema,
      response: {
        200: argumentSetVersionListResponseSchema,
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ request, reply }) => {
    const { id } = request.params;
    const detail = await service.getById(id);
    if (!detail) {
      return reply.code(404).send({ error: `Argument set ${id} not found` });
    }
    const versions = await service.listVersions(id);
    return reply.send(versions);
  }));

  fastify.post('/:id/v', ...reposRoute({
      params: argumentSetIdParamSchema,
      body: argumentSetVersionBodySchema,
      response: {
        201: argumentSetVersionResponseSchema,
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ request, reply }) => {
    const { id } = request.params;
    const detail = await service.getById(id);
    if (!detail) {
      return reply.code(404).send({ error: `Argument set ${id} not found` });
    }
    const body = request.body;
    const created = await service.createVersion(
      id,
      body as Parameters<typeof service.createVersion>[1],
      { authScope: { request } },
    );
    reply.code(201);
    setEntityConcurrencyHeaders(reply, { dateModified: created.dateModified ?? null });
    return reply.send(created);
  }));

  fastify.get('/:id/v/:version', ...reposRoute({
      params: argumentSetVersionParamSchema,
      response: {
        200: argumentSetVersionResponseSchema,
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ request, reply }) => {
    const { id, version } = request.params;
    const parsedVersion = Number.parseInt(String(version), 10);
    const detail = await service.getVersion(id, parsedVersion);
    if (!detail) {
      return reply.code(404).send({ error: `Argument set version ${id} v${version} not found` });
    }
    /*
     * The three `/:id/v/:version` routes match versions on `isPartOf` and never
     * read the set the path names, so the plugin guard's premise — "a miss is a
     * 404 the handler will produce" — does not hold for them, and each checks
     * the version it is about to serve.
     *
     * Unlike `queries.ts` and `tuple-sets.ts`, where the same shape was a live
     * hole, no single API call is known to reach the state here:
     * `ArgumentSetService.delete` cascades to the versions, and a set whose
     * *library* was deleted is refused by the guard's dangling-container branch
     * before a handler runs. This is the shape checked rather than argued out
     * of — a cascade that ever misses one, or a new route that deletes a set
     * without one, must not silently be a way to read its bindings.
     */
    requireEntityMode(request, { isPartOf: detail.isPartOf }, 'read');
    setEntityConcurrencyHeaders(reply, { dateModified: detail.dateModified ?? null });
    return reply.send(detail);
  }));

  fastify.patch('/:id/v/:version', ...reposRoute({
      params: argumentSetVersionParamSchema,
      body: argumentSetVersionPatchSchema,
      response: {
        200: argumentSetVersionResponseSchema,
        400: contentPatchRejectedSchema,
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        409: contentPatchRejectedSchema,
      },
    }, async ({ request, reply }) => {
    const { id, version } = request.params;
    const parsedVersion = Number.parseInt(String(version), 10);
    const existing = await service.getVersion(id, parsedVersion);
    if (!existing) {
      return reply.code(404).send({ error: `Argument set version ${id} v${version} not found` });
    }
    // As on the GET above, one mode along: this annotates the version it found.
    requireEntityMode(request, { isPartOf: existing.isPartOf }, 'write');
    const { valid, currentTag } = validateIfMatch(request, { dateModified: existing.dateModified });
    if (!valid) {
      return reply.code(412).send({ error: 'If-Match header does not match current entity tag' });
    }
    /*
     * A version is a snapshot, so a PATCH annotates rather than edits (issue
     * #192). `ArgumentSetVersion` has no annotation field — no comment, and no
     * freeze transition now that every version is immutable by construction
     * (#210) — so the only body this ever accepts is empty; anything else
     * answers 409 naming the fields refused.
     */
    const { rejection } = classifyVersionPatch(request.body as Record<string, unknown>);
    if (rejection) return reply.code(rejection.status).send(rejection);

    if (currentTag) {
      reply.header('ETag', `"${currentTag.replace(/\"/g, '')}"`);
    }
    setEntityConcurrencyHeaders(reply, { dateModified: existing.dateModified ?? null });
    return reply.send(existing);
  }));

  fastify.get('/:id/v/:version/export', ...reposRoute({
      params: argumentSetVersionParamSchema,
      response: {
        200: executionPayloadResponseSchema,
      },
    }, async ({ request, reply }) => {
    const { id, version } = request.params;
    const parsedVersion = Number.parseInt(String(version), 10);
    const detail = await service.getVersion(id, parsedVersion);
    if (!detail) {
      return reply.code(404).send({ error: `Argument set version ${id} v${version} not found` });
    }
    // The same check as the version GET, and the one that matters most of the
    // three: this answers with the bindings resolved to content, not metadata.
    requireEntityMode(request, { isPartOf: detail.isPartOf }, 'read');
    try {
      const payload = await service.exportRuntimePayload([detail.id]);
      reply.header('Content-Type', SPARQL_ARGUMENTS_MEDIA_TYPE);
      return reply.send({
        arguments: payload.tupleList,
        limits: payload.limits,
        offsets: payload.offsets,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(409).send({ error: message });
    }
  }));
}
