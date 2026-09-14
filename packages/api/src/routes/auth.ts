/**
 * `/auth` — identity introspection and grant administration (design §6).
 *
 * Grant writes are the only mutation path into the auth graph. Everything here
 * is audited, including the reads that reveal who holds what.
 */
import type { FastifyInstance } from 'fastify';
import { getAuthStore, type Grant, type GrantResourceKind } from '../auth/AuthStore.js';
import { auditGrantMutation } from '../auth/audit.js';
import { getAuthConfig } from '../auth/config.js';
import { authOf, canLibrary, isAdmin, requireAdmin, AuthorizationError } from '../auth/enforce.js';
import { RESOURCE_EVERYTHING } from '../auth/types.js';
import { typedRoute } from './route-helpers.js';

const errorResponseSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
} as const;

const grantSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    principal: { type: 'string' },
    resourceKind: { type: 'string', enum: ['library', 'backend', 'everything'] },
    resource: { type: 'string' },
    modes: { type: 'array', items: { type: 'string' } },
    grantedBy: { type: 'string' },
    grantedAt: { type: 'string' },
  },
  required: ['id', 'principal', 'resourceKind', 'resource', 'modes'],
  additionalProperties: false,
} as const;

const meSchema = {
  tags: ['Auth'],
  summary: 'Current caller identity and effective grants',
  response: {
    200: {
      type: 'object',
      properties: {
        authMode: { type: 'string' },
        authenticated: { type: 'boolean' },
        subject: { type: 'string' },
        issuer: { type: 'string', nullable: true },
        tokenType: { type: 'string' },
        principals: { type: 'array', items: { type: 'string' } },
        admin: { type: 'boolean' },
        libraries: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
        },
        backends: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
        },
      },
      required: ['authMode', 'authenticated', 'subject', 'principals', 'admin', 'libraries', 'backends'],
      additionalProperties: false,
    },
  },
} as const;

const listGrantsSchema = {
  tags: ['Auth'],
  summary: 'List authorization grants',
  querystring: {
    type: 'object',
    properties: {
      library: { type: 'string' },
      backend: { type: 'string' },
      principal: { type: 'string' },
    },
    additionalProperties: false,
  },
  response: {
    200: { type: 'array', items: grantSchema },
    403: errorResponseSchema,
  },
} as const;

const createGrantSchema = {
  tags: ['Auth'],
  summary: 'Create an authorization grant',
  body: {
    type: 'object',
    properties: {
      principal: { type: 'string', minLength: 1 },
      resourceKind: { type: 'string', enum: ['library', 'backend', 'everything'] },
      resource: { type: 'string' },
      modes: { type: 'array', items: { type: 'string' }, minItems: 1 },
    },
    required: ['principal', 'resourceKind', 'modes'],
    additionalProperties: false,
  },
  response: {
    201: grantSchema,
    400: errorResponseSchema,
    403: errorResponseSchema,
  },
} as const;

const deleteGrantSchema = {
  tags: ['Auth'],
  summary: 'Revoke an authorization grant',
  params: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  response: { 204: { type: 'null' }, 403: errorResponseSchema, 404: errorResponseSchema },
} as const;

const listPrincipalsSchema = {
  tags: ['Auth'],
  summary: 'Search principals seen by this server',
  querystring: {
    type: 'object',
    properties: { q: { type: 'string' } },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          iri: { type: 'string' },
          rawClaim: { type: 'string' },
          kind: { type: 'string' },
          seenAt: { type: 'string' },
        },
        required: ['iri', 'rawClaim', 'kind'],
        additionalProperties: false,
      },
    },
    403: errorResponseSchema,
  },
} as const;

function serializeGrant(grant: Grant) {
  return {
    id: grant.id,
    principal: grant.principal,
    resourceKind: grant.resourceKind,
    resource: grant.resource,
    modes: [...grant.modes].sort(),
    ...(grant.grantedBy ? { grantedBy: grant.grantedBy } : {}),
    ...(grant.grantedAt ? { grantedAt: grant.grantedAt } : {}),
  };
}

/**
 * Grant administration is admin-only, except that holding Control on a library
 * lets you share *that* library — which is what makes user-driven sharing work
 * without an operator in the loop.
 */
function assertMayAdministerGrant(
  request: Parameters<typeof requireAdmin>[0],
  resourceKind: GrantResourceKind,
  resource: string | undefined
): void {
  if (isAdmin(request)) return;

  if (resourceKind === 'library' && resource && canLibrary(request, resource, 'control')) {
    return;
  }

  throw new AuthorizationError(
    resourceKind === 'library'
      ? `Missing "control" permission on library ${resource ?? '(unspecified)'}.`
      : 'Administrator access is required to administer this grant.'
  );
}

export default async function (fastify: FastifyInstance) {
  fastify.get('/me', ...typedRoute(meSchema, async (request, reply) => {
    const context = authOf(request);
    const libraries: Record<string, string[]> = {};
    for (const [iri, modes] of context.grants.libraries) {
      libraries[iri] = [...modes].sort();
    }
    const backends: Record<string, string[]> = {};
    for (const [iri, modes] of context.grants.backends) {
      backends[iri] = [...modes].sort();
    }

    return reply.send({
      authMode: context.mode,
      authenticated: !context.fullAccess,
      subject: context.subject,
      issuer: context.issuer,
      tokenType: context.tokenType,
      principals: [...context.principals],
      admin: context.fullAccess || context.grants.admin,
      libraries,
      backends,
    });
  }));

  fastify.get('/grants', ...typedRoute(listGrantsSchema, async (request, reply) => {
    const { library, backend, principal } = request.query;
    const store = getAuthStore();

    if (library) {
      assertMayAdministerGrant(request, 'library', library);
      return reply.send(store.listGrants({ library }).map(serializeGrant));
    }

    requireAdmin(request, 'listing grants');
    if (backend) return reply.send(store.listGrants({ backend }).map(serializeGrant));
    if (principal) return reply.send(store.listGrants({ principal }).map(serializeGrant));
    return reply.send(store.listGrants().map(serializeGrant));
  }));

  fastify.post('/grants', ...typedRoute(createGrantSchema, async (request, reply) => {
    const { principal, resourceKind, resource, modes } = request.body;

    if (resourceKind !== 'everything' && !resource) {
      return reply.status(400).send({ error: `A ${resourceKind} grant requires a "resource" IRI.` });
    }
    // Only an admin can mint another admin — Control on a library must never be
    // a path to Control over everything.
    if (resourceKind === 'everything') {
      requireAdmin(request, 'creating administrator grants');
    } else {
      assertMayAdministerGrant(request, resourceKind, resource);
    }

    const context = authOf(request);
    const grant = await getAuthStore().createGrant({
      principal,
      resourceKind,
      resource: resourceKind === 'everything' ? RESOURCE_EVERYTHING : resource!,
      modes,
      grantedBy: context.fullAccess ? undefined : context.subject,
    });

    auditGrantMutation(request, context, {
      action: 'create',
      grantId: grant.id,
      principal: grant.principal,
      resource: grant.resource,
      resourceKind: grant.resourceKind,
      modes: [...grant.modes],
    });

    return reply.status(201).send(serializeGrant(grant));
  }));

  fastify.delete('/grants/:id', ...typedRoute(deleteGrantSchema, async (request, reply) => {
    const { id } = request.params;
    const store = getAuthStore();
    const grant = store.getGrant(id);
    if (!grant) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    if (grant.resourceKind === 'everything') {
      requireAdmin(request, 'revoking administrator grants');
    } else {
      assertMayAdministerGrant(request, grant.resourceKind, grant.resource);
    }

    const context = authOf(request);
    await store.deleteGrant(id);

    auditGrantMutation(request, context, {
      action: 'revoke',
      grantId: grant.id,
      principal: grant.principal,
      resource: grant.resource,
      resourceKind: grant.resourceKind,
      modes: [...grant.modes],
    });

    return reply.status(204).send();
  }));

  fastify.get('/principals', ...typedRoute(listPrincipalsSchema, async (request, reply) => {
    const context = authOf(request);
    // Anyone who can share something needs the autocomplete; anyone who can
    // share nothing has no use for a directory of other people.
    const maySearch =
      context.fullAccess ||
      context.grants.admin ||
      [...context.grants.libraries.values()].some(modes => modes.has('control'));

    if (!maySearch) {
      throw new AuthorizationError('Administrator or library-control access is required.');
    }

    const records = getAuthStore().listPrincipals(request.query.q);
    return reply.send(
      records.map(record => ({
        iri: record.iri,
        rawClaim: record.rawClaim,
        kind: record.kind,
        ...(record.seenAt ? { seenAt: record.seenAt } : {}),
      }))
    );
  }));

  fastify.log.info({ authMode: getAuthConfig().mode }, 'Auth routes registered');
}
