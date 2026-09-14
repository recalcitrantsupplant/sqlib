/**
 * `/patches` — see a write before it happens, and keep what it did.
 *
 * Preview is the point of the whole surface: it is read-only by construction —
 * two CONSTRUCTs and an existence check, never an update — so a caller who may
 * *use* a backend can be shown exactly what a write would do to it without
 * being allowed to do it. That is the trust story for agent-driven writes: the
 * model proposes, a human approves a diff, and apply runs the patch that was
 * approved rather than re-interpreting the SPARQL that produced it.
 *
 * `apply` therefore needs `write` where `preview` needs `use`, and the split is
 * the feature rather than an oversight.
 *
 * See `docs/explanation/rdf-patch.md`.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { UnsupportedUpdateError } from '@sparql-query-lib/rdf-delta';
import { patchApplyJsonSchema, patchPreviewJsonSchema } from '@sparql-query-lib/contracts/schema/routes';
import { typedRoute } from './route-helpers.js';
import { requireBackendMode } from '../auth/enforce.js';
import { getEntityRepositories } from '../lib/CacheCoordinatorProvider.js';
import {
  applyExistingPatch,
  applyUpdate,
  PatchConflictError,
  PatchTargetError,
  previewUpdate,
  revertPatch,
  storedGraphOps,
  sweepPreviewedPatches,
  toRdfPatchDocument,
} from '../lib/patchService.js';
import type { LdkitPatch } from '../persistence/schemas/PatchSchema.js';

const RDF_PATCH_MEDIA_TYPE = 'text/rdf-patch';

/**
 * How long a preview nobody applied is kept, and how often they are swept.
 *
 * A preview is a proposal with a human in the loop, so the default is generous
 * enough to survive a coffee break and short enough that a busy day of
 * "what would this do?" does not become the log's bulk.
 */
const PREVIEW_TTL_MS = Number(process.env.PATCH_PREVIEW_TTL_MS ?? 60 * 60 * 1000);
const SWEEP_INTERVAL_MS = Number(process.env.PATCH_SWEEP_INTERVAL_MS ?? 10 * 60 * 1000);

const errorResponseSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
} as const;

const patchResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    backendId: { type: 'string' },
    additions: { type: 'string' },
    deletions: { type: 'string' },
    additionCount: { type: 'integer' },
    deletionCount: { type: 'integer' },
    rawInsertCount: { type: 'integer', nullable: true },
    rawDeleteCount: { type: 'integer', nullable: true },
    graphScope: { type: 'array', items: { type: 'string' } },
    graphOps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          form: { type: 'string', enum: ['clear', 'drop', 'create', 'load', 'copy', 'move', 'add'] },
          silent: { type: 'boolean' },
          destination: { type: 'object', additionalProperties: true },
          source: { type: 'object', additionalProperties: true },
          document: { type: 'string' },
          affectedCount: { type: 'integer', nullable: true },
          enumerated: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    status: { type: 'string', enum: ['previewed', 'applied', 'failed', 'reverted'] },
    applyMode: { type: 'string', enum: ['ground-sparql', 'store', 'graph-ops'] },
    revertible: { type: 'boolean' },
    containsBnodes: { type: 'boolean' },
    netEffectExact: { type: 'boolean' },
    contentHash: { type: 'string' },
    sourceKind: { type: 'string' },
    updateString: { type: 'string', nullable: true },
    inverseOf: { type: 'string', nullable: true },
    dateCreated: { type: 'string', nullable: true },
    dateApplied: { type: 'string', nullable: true },
  },
  required: [
    'id',
    'backendId',
    'additionCount',
    'deletionCount',
    'status',
    'applyMode',
    'revertible',
    'contentHash',
  ],
  additionalProperties: false,
} as const;

const conflictResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    current: patchResponseSchema,
  },
  required: ['error'],
  additionalProperties: false,
} as const;

const idParamSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

/** The stored entity as the API shows it. */
export function toPatchView(patch: LdkitPatch): Record<string, unknown> {
  return {
    id: patch.$id,
    backendId: patch.isPartOf,
    additions: patch.additions ?? '',
    deletions: patch.deletions ?? '',
    additionCount: patch.additionCount,
    deletionCount: patch.deletionCount,
    rawInsertCount: patch.rawInsertCount ?? null,
    rawDeleteCount: patch.rawDeleteCount ?? null,
    graphScope: patch.graphScope ?? [],
    graphOps: storedGraphOps(patch),
    status: patch.patchStatus,
    applyMode: patch.applyMode,
    revertible: patch.revertible,
    containsBnodes: patch.containsBnodes ?? false,
    netEffectExact: patch.netEffectExact ?? true,
    contentHash: patch.contentHash,
    sourceKind: patch.sourceKind,
    updateString: patch.updateString ?? null,
    inverseOf: patch.inverseOf ?? null,
    dateCreated: patch.dateCreated ?? null,
    dateApplied: patch.dateApplied ?? null,
  };
}

/**
 * Who is asking, as the change feed spells it.
 *
 * Exported because the raw proxy's `?record=patch` writes patches too, and a
 * patch recorded there must carry the same `origin` as one previewed here —
 * otherwise a client cannot recognise its own writes coming back on the feed.
 */
export function clientId(request: FastifyRequest): string | null {
  const header = request.headers['x-sqlib-client-id'];
  return typeof header === 'string' && header.length > 0 ? header : null;
}

/**
 * One place where the service's failures become HTTP.
 *
 * A conflict answers with the patch as it stands, mirroring the `412` the
 * entity routes send: the caller is told what it is now looking at rather than
 * only that it was wrong.
 */
async function handled<T>(reply: FastifyReply, run: () => Promise<T>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PatchConflictError) {
      return reply.status(409).send({ error: error.message, current: toPatchView(error.current) });
    }
    if (error instanceof PatchTargetError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    if (error instanceof UnsupportedUpdateError) {
      return reply.status(400).send({ error: error.message });
    }
    throw error;
  }
}

export default async function (fastify: FastifyInstance) {
  const sweep = setInterval(() => {
    void sweepPreviewedPatches(PREVIEW_TTL_MS).catch((error) => {
      fastify.log.warn({ err: error }, 'patch preview sweep failed');
    });
  }, SWEEP_INTERVAL_MS);
  // Housekeeping must never be the reason the process stays alive, and a timer
  // outliving the server is how a test suite hangs after its last assertion.
  sweep.unref?.();
  fastify.addHook('onClose', async () => clearInterval(sweep));

  fastify.post('/preview', ...typedRoute({
      tags: ['Patch'],
      summary: 'Derive the patch an update would produce, without running it',
      body: patchPreviewJsonSchema,
      response: { 200: patchResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema },
    }, async (request, reply) => {
    const { updateString, backendId, enumerateGraphOps, enumerationCap } = request.body;
    // Read-only by construction, so `use` is the right grant — and deliberately
    // not `write`: being shown what a write would do is the thing a reviewer
    // needs and a proposer should not have to be trusted with.
    requireBackendMode(request, backendId, 'use');

    return handled(reply, async () => {
      const patch = await previewUpdate({
        backendId,
        updateString,
        enumerateGraphOps,
        enumerationCap,
        origin: clientId(request),
      });
      // The same content negotiation `GET /:id` offers, because a caller that
      // wants the diff as a document should not have to preview it and then
      // fetch it again to get one.
      return sendPatch(request, reply, patch);
    });
  }));

  fastify.post('/apply', ...typedRoute({
      tags: ['Patch'],
      summary: 'Apply a previewed patch, or derive and apply an update',
      body: patchApplyJsonSchema,
      response: {
        200: patchResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        409: conflictResponseSchema,
        422: errorResponseSchema,
      },
    }, async (request, reply) => {
    const { patchId, updateString, backendId, expectedHash, force, enumerateGraphOps, enumerationCap } =
      request.body;

    if (patchId) {
      const stored = getEntityRepositories().Patch.get(patchId);
      if (!stored) {
        return reply.status(404).send({ error: `Patch not found: ${patchId}` });
      }
      requireBackendMode(request, stored.isPartOf, 'write');
      return handled(reply, async () => {
        const applied = await applyExistingPatch({
          patchId,
          expectedHash: expectedHash ?? null,
          force: force === true,
          enumerateGraphOps,
          enumerationCap,
          origin: clientId(request),
        });
        return reply.send(toPatchView(applied));
      });
    }

    if (!updateString || !backendId) {
      return reply.status(400).send({
        error: 'Provide either a patchId, or an updateString and backendId',
      });
    }

    requireBackendMode(request, backendId, 'write');
    return handled(reply, async () => {
      const applied = await applyUpdate({
        backendId,
        updateString,
        enumerateGraphOps,
        enumerationCap,
        origin: clientId(request),
      });
      return reply.send(toPatchView(applied));
    });
  }));

  fastify.post('/:id/revert', ...typedRoute({
      tags: ['Patch'],
      summary: 'Undo an applied patch by applying its inverse',
      params: idParamSchema,
      response: {
        200: patchResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
        422: errorResponseSchema,
      },
    }, async (request, reply) => {
    const { id } = request.params;
    const stored = getEntityRepositories().Patch.get(id);
    if (!stored) {
      return reply.status(404).send({ error: `Patch not found: ${id}` });
    }
    requireBackendMode(request, stored.isPartOf, 'write');

    return handled(reply, async () => {
      const inverse = await revertPatch(id, clientId(request));
      return reply.send(toPatchView(inverse));
    });
  }));

  fastify.get('/:id', ...typedRoute({
      tags: ['Patch'],
      summary: 'Get a patch, as JSON or RDF Patch',
      params: idParamSchema,
      response: { 200: {}, 404: errorResponseSchema },
    }, async (request, reply) => {
    const { id } = request.params;
    const patch = getEntityRepositories().Patch.get(id);
    if (!patch) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    requireBackendMode(request, patch.isPartOf, 'use');

    return sendPatch(request, reply, patch);
  }));
}

/**
 * Answer with a patch in the shape the caller asked for.
 *
 * JSON — the entity — by default; the RDF Patch document when the caller says
 * so, along with its id in a header so a document response is still traceable
 * back to the record it came from.
 */
function sendPatch(request: FastifyRequest, reply: FastifyReply, patch: LdkitPatch): unknown {
  const accept = String(request.headers.accept ?? '');
  if (accept.includes(RDF_PATCH_MEDIA_TYPE)) {
    // The RDF-Delta dialect, so a consumer that already speaks it needs no
    // sqlib-specific parser — and so the log can be shipped later without
    // inventing a private format first.
    reply.header('Content-Type', `${RDF_PATCH_MEDIA_TYPE}; charset=utf-8`);
    reply.header('X-Sqlib-Patch-Id', patch.$id);
    return reply.send(toRdfPatchDocument(patch));
  }
  return reply.send(toPatchView(patch));
}
