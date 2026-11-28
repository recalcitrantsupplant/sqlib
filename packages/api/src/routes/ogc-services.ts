/**
 * `/ogc-services` — OGC API Features services, each served at `/ogc/{slug}`.
 *
 * The pointer + immutable version pattern every library entity uses: an
 * OgcService carries the name, the slug and the library, an
 * OgcServiceVersion the collections. A version is checked against the
 * queries it names when it is saved (`lib/OgcServiceVersionWriter.ts`), and
 * the OGC routes serve the new version at their next request
 * (`server/ogcRoutes.ts`). See `docs/proposals/ogc-services.md`.
 */
import type { FastifyInstance } from 'fastify';
import { registerVersionedEntityRoutes, type StoredEntity } from './versionedEntity.js';
import { createOgcServiceSchema, updateOgcServiceSchema } from '@sparql-query-lib/contracts/schema';
import { OGC_SERVICE_SLUG_PATTERN, type OgcServiceCollection } from '@sparql-query-lib/tools';
import { annotateOgcServiceVersion, createOgcServiceVersion } from '../lib/OgcServiceVersionWriter.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { RouteError } from './route-helpers.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { ogcServiceProblems } from '../lib/publishedTools.js';
import { OGC_SERVICE_COLLECTIONS } from '../persistence/jsonShapes.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { PersistedOgcService } from '../persistence/schemas/OgcServiceSchema.js';

export const ogcServiceResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    slug: { type: 'string' },
    currentVersion: { type: 'string', nullable: true },
    currentVersionNumber: { type: 'integer', nullable: true },
    isPartOf: { type: 'array', items: { type: 'string' } },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
    createdBy: { type: 'string', nullable: true },
    modifiedBy: { type: 'string', nullable: true },
    /** Why a collection of the served version is left out, one line each. Empty when all are served. */
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'name', 'slug', 'isPartOf'],
  additionalProperties: false,
} as const;

const ogcServiceVersionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    isPartOf: { type: 'string' },
    version: { type: 'integer' },
    immutable: { type: 'boolean', nullable: true },
    collections: OGC_SERVICE_COLLECTIONS.jsonSchema,
    comment: { type: 'string', nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
    createdBy: { type: 'string', nullable: true },
    modifiedBy: { type: 'string', nullable: true },
  },
  required: ['id', 'isPartOf', 'version', 'collections'],
  additionalProperties: false,
} as const;

const createOgcServiceVersionBodySchema = {
  type: 'object',
  properties: {
    collections: OGC_SERVICE_COLLECTIONS.jsonSchema,
    comment: { type: 'string', nullable: true },
  },
  required: ['collections'],
  additionalProperties: false,
} as const;

/** Collections are accepted by the wire schema so the handler can answer them with the 409 that says why. */
const annotateOgcServiceVersionBodySchema = {
  type: 'object',
  properties: {
    collections: { type: 'array', nullable: true },
    comment: { type: 'string', nullable: true },
  },
  additionalProperties: false,
} as const;

const SLUG = new RegExp(OGC_SERVICE_SLUG_PATTERN);

/** Refuse a slug that is not one lower-case path segment, or that another service has. */
function checkSlug(slug: unknown, exceptId: string | null): string {
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    throw new RouteError(400, { error: 'slug: use lower-case letters, digits and "-", starting with a letter or digit, at most 64.' });
  }
  const holder = (getCacheCoordinator().list('OgcService') as PersistedOgcService[])
    .find(service => service.slug === slug && service.$id !== exceptId);
  if (holder) throw new RouteError(409, { error: `The slug "${slug}" is already used by OGC service "${holder.name}".` });
  return slug;
}

export default async function (fastify: FastifyInstance) {
  // Nothing here executes and nothing is a stateless helper, so nothing is exempt.
  registerEntityAuthGuard(fastify, { executeSuffixes: [], exemptSuffixes: [] });

  /** The problem lines, collected once per request: a listing presents every service. */
  const problemsByRequest = new WeakMap<object, Map<string, string[]>>();
  const present = (entity: StoredEntity, request: object) => {
    let problems = problemsByRequest.get(request);
    if (!problems) {
      problems = ogcServiceProblems();
      problemsByRequest.set(request, problems);
    }
    return { ...toRestApi<Record<string, unknown>>(entity), problems: problems.get(entity.$id) ?? [] };
  };

  registerVersionedEntityRoutes(fastify, {
    noun: 'OGC service',
    type: 'OgcService',
    versionType: 'OgcServiceVersion',
    idKind: 'ogcService',
    // A seed or an import can keep a service's id, so a page or notebook can name it.
    acceptCallerId: true,
    present,
    schemas: {
      list: { tags: ['OgcService'], summary: 'List OGC services', response: { 200: { type: 'array', items: ogcServiceResponseSchema } } },
      create: { tags: ['OgcService'], summary: 'Create OGC service', body: createOgcServiceSchema.body, response: { 201: ogcServiceResponseSchema } },
      get: { tags: ['OgcService'], summary: 'Get OGC service', response: { 200: ogcServiceResponseSchema } },
      update: { tags: ['OgcService'], summary: 'Update OGC service', body: updateOgcServiceSchema.body, response: { 200: ogcServiceResponseSchema } },
      delete: { tags: ['OgcService'], summary: 'Delete OGC service and all its versions (cascading delete)', response: { 204: { type: 'null' } } },
      listVersions: { tags: ['OgcService'], summary: 'List OGC service versions', response: { 200: { type: 'array', items: ogcServiceVersionResponseSchema } } },
      createVersion: { tags: ['OgcService'], summary: 'Save an OGC service version', body: createOgcServiceVersionBodySchema, response: { 201: ogcServiceVersionResponseSchema } },
      getVersion: { tags: ['OgcService'], summary: 'Get OGC service version', response: { 200: ogcServiceVersionResponseSchema } },
      patchVersion: {
        tags: ['OgcService'],
        summary: 'Annotate an OGC service version (comment only; collections are immutable)',
        body: annotateOgcServiceVersionBodySchema,
        response: { 200: ogcServiceVersionResponseSchema },
      },
      deleteVersion: { tags: ['OgcService'], summary: 'Delete OGC service version', response: { 204: { type: 'null' } } },
    },
    beforeCreate: ({ body }) => ({ slug: checkSlug(body.slug, null) }),
    beforeUpdate: ({ current, updates }) => {
      if (updates.slug !== undefined) updates.slug = checkSlug(updates.slug, current.$id);
    },
    createVersion: async ({ parent, body }) => {
      const created = await createOgcServiceVersion(parent as unknown as PersistedOgcService, {
        collections: body.collections as OgcServiceCollection[],
        comment: (body.comment as string | null | undefined) ?? null,
      });
      return { created: created as unknown as StoredEntity };
    },
    annotateVersion: async (version, annotations) => await annotateOgcServiceVersion(version.$id, {
      comment: annotations.comment as string | null | undefined,
    }) as unknown as StoredEntity,
  });
}
