/**
 * `GET` and `PUT /:id/browser-defaults`, registered inside the query, query
 * group and rule set plugins so each plugin's entity guard covers them: Read
 * on the owner's library for `GET`, Write for `PUT`.
 *
 * The handlers also check the owner explicitly, as the `/:id/argument-sets`
 * routes beside them do, because the guard abstains on an id it cannot resolve.
 * See `lib/browserDefaults.ts` for what a browser default is and is not.
 */
import type { FastifyInstance } from 'fastify';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import {
  BrowserDefaultsError,
  readBrowserDefaults,
  validateBrowserDefaults,
  writeBrowserDefaults,
  type BrowserDefaultsOwnerType,
} from '../lib/browserDefaults.js';
import { requireEntityMode } from '../auth/enforce.js';
import { reposRoute, setEntityConcurrencyHeaders } from './route-helpers.js';

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

const paramsSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
  additionalProperties: false,
} as const;

export const browserDefaultsSchema = {
  type: 'object',
  properties: {
    /** An `ArgumentSet`. It floats: the web app picks the version per run. */
    argumentSet: { type: 'string', nullable: true },
    /** By data graph input. A `DataGraph` floats; a `DataGraphVersion` is pinned. */
    dataGraphs: { type: 'array', maxItems: 64, items: { type: 'string', nullable: true } },
  },
  additionalProperties: false,
} as const;

const responseSchema = {
  ...browserDefaultsSchema,
  required: ['argumentSet', 'dataGraphs'],
} as const;

export function registerBrowserDefaultsRoutes(fastify: FastifyInstance, ownerType: BrowserDefaultsOwnerType): void {
  const tags = [ownerType];

  const ownerOf = (id: string) => {
    const owner = getCacheCoordinator().get(id) as { $id: string; '@type'?: string } | null;
    return owner?.['@type'] === ownerType ? owner : null;
  };

  fastify.get('/:id/browser-defaults', ...reposRoute({
    tags,
    summary: `Read a ${ownerType}'s browser defaults`,
    description: 'What the web app selects when this opens. Execution never applies these.',
    params: paramsSchema,
    response: { 200: responseSchema, 404: errorSchema },
  }, async ({ reply, request }) => {
    const owner = ownerOf(request.params.id);
    if (!owner) return reply.status(404).send({ error: `${ownerType} ${request.params.id} not found` });
    requireEntityMode(request, owner, 'read');
    return reply.send(readBrowserDefaults(owner));
  }));

  fastify.put('/:id/browser-defaults', ...reposRoute({
    tags,
    summary: `Replace a ${ownerType}'s browser defaults`,
    description: 'Replaces the whole value; {} clears it. Execution never applies these.',
    params: paramsSchema,
    body: browserDefaultsSchema,
    response: { 200: responseSchema, 400: errorSchema, 404: errorSchema },
  }, async ({ reply, request }) => {
    const owner = ownerOf(request.params.id);
    if (!owner) return reply.status(404).send({ error: `${ownerType} ${request.params.id} not found` });
    requireEntityMode(request, owner, 'write');

    let body;
    try {
      body = validateBrowserDefaults(ownerType, owner, request.body);
    } catch (error) {
      if (error instanceof BrowserDefaultsError) return reply.status(400).send({ error: error.message });
      throw error;
    }
    const saved = await writeBrowserDefaults(ownerType, owner, body);
    const updated = getCacheCoordinator().get(owner.$id) as { dateModified?: string | null } | null;
    if (updated) setEntityConcurrencyHeaders(reply, updated);
    return reply.send(saved);
  }));
}
