/**
 * `/auth` — identity introspection and grant administration (design §6).
 *
 * Grant writes are the only mutation path into the auth graph. Everything here
 * is audited, including the reads that reveal who holds what.
 *
 * The two writes below are also the only routes in the API that refuse in
 * `dry-run`, and `requireAuthGraphDecision` carries the argument for why: a
 * grant is the state `required` mode consults, so a grant written while the
 * deployment was only *observing* is live the moment it starts enforcing.
 * Every read here keeps the behaviour it has always had.
 */
import type { FastifyInstance } from 'fastify';
import { getAuthStore, type Grant, type GrantResourceKind } from '../auth/AuthStore.js';
import { auditGrantMutation } from '../auth/audit.js';
import { getAuthConfig } from '../auth/config.js';
import { hasLibraryMode } from '../auth/grants.js';
import { isGroupPrincipal } from '../auth/principals.js';
import {
  authOf,
  isOpenDeployment,
  requireAdmin,
  requireAuthGraphDecision,
} from '../auth/enforce.js';
import { RESOURCE_EVERYTHING, type AuthContext } from '../auth/types.js';
import { typedRoute } from './route-helpers.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';

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
    resourceKind: { type: 'string', enum: ['library', 'backend', 'environment', 'everything'] },
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
        /**
         * The caller's group principals with the names their tokens carried,
         * which `principals` hides behind hashed IRIs. A group the store has
         * not recorded yet comes without a name.
         */
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: { iri: { type: 'string' }, name: { type: 'string' } },
            required: ['iri'],
            additionalProperties: false,
          },
        },
        /** The caller's email, username or name from their last token. */
        label: { type: 'string' },
        displayName: { type: 'string' },
        /** When the caller was first recorded. */
        seenAt: { type: 'string' },
        admin: { type: 'boolean' },
        libraries: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
        },
        backends: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
        },
        environments: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
        },
      },
      required: ['authMode', 'authenticated', 'subject', 'principals', 'groups', 'admin', 'libraries', 'backends'],
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
      environment: { type: 'string' },
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
      resourceKind: { type: 'string', enum: ['library', 'backend', 'environment', 'everything'] },
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
          label: { type: 'string' },
          displayName: { type: 'string' },
          groups: { type: 'array', items: { type: 'string' } },
        },
        required: ['iri', 'rawClaim', 'kind'],
        additionalProperties: false,
      },
    },
    403: errorResponseSchema,
  },
} as const;

/**
 * At most this many IRIs per `GET /auth/names`. One screen of a library names
 * far fewer people than this; the web app batches the IRIs it shows.
 */
export const MAX_NAME_LOOKUPS = 100;

const namesSchema = {
  tags: ['Auth'],
  summary: 'Display names of the people who created or changed entities',
  description:
    'Pass each principal IRI as an `iri` parameter, at most 100. The answer has a row for each user principal ' +
    'that this server has a display name for. Groups, clients and unknown IRIs are left out.',
  querystring: {
    type: 'object',
    properties: {
      iri: {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' }, maxItems: MAX_NAME_LOOKUPS },
        ],
      },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          iri: { type: 'string' },
          displayName: { type: 'string' },
        },
        required: ['iri', 'displayName'],
        additionalProperties: false,
      },
    },
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
 * What the caller may do to the auth graph.
 *
 * `countFullAccess` decides whether a full-access context is authority. It is
 * `true` for reads, which keeps every read here behaving exactly as it always
 * has, and `isOpenDeployment` for writes, because a `dry-run` request carrying
 * no token also arrives full-access and what a write leaves behind outlives
 * the mode.
 *
 * A full-access context's grants cannot be consulted either way:
 * `EMPTY_GRANTS.admin` is `true` on all of them, so such a context counts
 * wholesale or not at all.
 */
function standingOf(context: AuthContext, countFullAccess: boolean) {
  if (context.fullAccess) {
    return {
      admin: countFullAccess,
      controls: (_library: string | undefined) => countFullAccess,
      controlsSomething: countFullAccess,
    };
  }
  return {
    admin: context.grants.admin,
    controls: (library: string | undefined) =>
      !!library && hasLibraryMode(context.grants, library, 'control'),
    controlsSomething: [...context.grants.libraries.values()].some(modes => modes.has('control')),
  };
}

/**
 * Grant administration is admin-only, except that holding Control on a library
 * lets you share *that* library — which is what makes user-driven sharing work
 * without an operator in the loop.
 *
 * `write` says whether the caller is about to change the graph rather than
 * read it, which is the only thing that decides how a full-access context and
 * `dry-run` mode are treated. Both refuse in every mode, as this check always
 * has.
 */
function assertMayAdministerGrant(
  request: Parameters<typeof requireAdmin>[0],
  resourceKind: GrantResourceKind,
  resource: string | undefined,
  { write }: { write: boolean }
): void {
  const context = authOf(request);
  const standing = standingOf(context, write ? isOpenDeployment(context) : context.fullAccess);
  // An environment's grants are its library's to share: Control on the
  // library lets a person say who may promote into its environments.
  const library = resourceKind === 'library' ? resource : resourceKind === 'environment' ? libraryOfEnvironment(resource) : undefined;
  const onLibrary = library !== undefined;

  requireAuthGraphDecision(
    request,
    standing.admin || (onLibrary && standing.controls(library)),
    {
      resource: onLibrary ? library ?? null : null,
      resourceKind: onLibrary ? 'library' : 'everything',
      mode: onLibrary ? 'control' : 'admin',
      message: onLibrary
        ? `Missing "control" permission on library ${library ?? '(unspecified)'}.`
        : 'Administrator access is required to administer this grant.',
    }
  );
}

/** The library an environment belongs to, if it resolves. */
function libraryOfEnvironment(environment: string | undefined): string | undefined {
  if (!environment) return undefined;
  const record = getCacheCoordinator().get(environment) as { '@type'?: string; isPartOf?: string } | null;
  return record?.['@type'] === 'Environment' && typeof record.isPartOf === 'string' ? record.isPartOf : undefined;
}

/**
 * The admin half of the same question, for the routes whose resource kind is
 * `everything` and which therefore have no library fallback.
 */
function assertMayAdministerEverything(
  request: Parameters<typeof requireAdmin>[0],
  what: string
): void {
  const context = authOf(request);

  requireAuthGraphDecision(request, standingOf(context, isOpenDeployment(context)).admin, {
    resource: null,
    resourceKind: 'everything',
    mode: 'admin',
    message: `Administrator access is required for ${what}.`,
  });
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

    const environments: Record<string, string[]> = {};
    for (const [iri, modes] of context.grants.environments ?? []) {
      environments[iri] = [...modes].sort();
    }

    // What the account menu shows. Read from the records the auth plugin
    // writes on sign-in, so it is only ever what this caller's own tokens said.
    const store = getAuthStore();
    const self = store.principalRecord(context.subject);
    const groups = context.principals.filter(isGroupPrincipal).map(iri => {
      const name = store.principalRecord(iri)?.rawClaim;
      return name ? { iri, name } : { iri };
    });

    return reply.send({
      authMode: context.mode,
      authenticated: !context.fullAccess,
      subject: context.subject,
      issuer: context.issuer,
      tokenType: context.tokenType,
      principals: [...context.principals],
      groups,
      ...(self?.label ? { label: self.label } : {}),
      ...(self?.displayName ? { displayName: self.displayName } : {}),
      ...(self?.seenAt ? { seenAt: self.seenAt } : {}),
      admin: context.fullAccess || context.grants.admin,
      libraries,
      backends,
      environments,
    });
  }));

  /**
   * Names for the `createdBy` and `modifiedBy` IRIs a reader already holds.
   *
   * Open to every caller who reaches it. A principal IRI is a hash of the
   * issuer and the token subject, so a caller can only ask about IRIs it read
   * from an entity or a grant it may see. The answer is the display name only
   * (see `displayNameOf`), never the email or the raw claim, which
   * stay in the administrator's `GET /principals`.
   */
  fastify.get('/names', ...typedRoute(namesSchema, async (request, reply) => {
    const asked = request.query.iri;
    const iris = [...new Set(asked === undefined ? [] : Array.isArray(asked) ? asked : [asked])];
    const store = getAuthStore();
    const rows: { iri: string; displayName: string }[] = [];
    for (const iri of iris) {
      const record = store.principalRecord(iri);
      if (!record || record.kind !== 'user' || !record.displayName) continue;
      rows.push({ iri, displayName: record.displayName });
    }
    return reply.send(rows);
  }));

  fastify.get('/grants', ...typedRoute(listGrantsSchema, async (request, reply) => {
    const { library, backend, environment, principal } = request.query;
    const store = getAuthStore();

    if (library) {
      assertMayAdministerGrant(request, 'library', library, { write: false });
      return reply.send(store.listGrants({ library }).map(serializeGrant));
    }
    if (environment) {
      assertMayAdministerGrant(request, 'environment', environment, { write: false });
      return reply.send(store.listGrants({ environment }).map(serializeGrant));
    }

    // Unchanged, and the one asymmetry left in this file: listing the whole
    // graph follows `dry-run` like the rest of the API, because it discloses
    // rather than writes and a `dry-run` deployment discloses everything else
    // it holds. §4 of the design note.
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
    if (resourceKind === 'environment' && !libraryOfEnvironment(resource)) {
      return reply.status(400).send({ error: `${resource} is not an environment.` });
    }
    // Only an admin can mint another admin — Control on a library must never be
    // a path to Control over everything.
    if (resourceKind === 'everything') {
      assertMayAdministerEverything(request, 'creating administrator grants');
    } else {
      assertMayAdministerGrant(request, resourceKind, resource, { write: true });
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
      assertMayAdministerEverything(request, 'revoking administrator grants');
    } else {
      assertMayAdministerGrant(request, grant.resourceKind, grant.resource, { write: true });
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
    //
    // A read, so full access counts as it always has. What changes is that the
    // refusal is now a row in the audit log rather than a bare throw — this
    // route's check never reached `decide`, so the reads this file's header
    // claims are audited were not.
    const standing = standingOf(context, context.fullAccess);
    const maySearch = standing.admin || standing.controlsSomething;

    requireAuthGraphDecision(request, maySearch, {
      resource: null,
      resourceKind: 'everything',
      mode: 'control',
      message: 'Administrator or library-control access is required.',
    });

    const records = getAuthStore().listPrincipals(request.query.q);
    return reply.send(
      records.map(record => ({
        iri: record.iri,
        rawClaim: record.rawClaim,
        kind: record.kind,
        ...(record.seenAt ? { seenAt: record.seenAt } : {}),
        ...(record.label ? { label: record.label } : {}),
        ...(record.displayName ? { displayName: record.displayName } : {}),
        // Group membership is for administrators, who test graph policies
        // with it; a library owner sharing a library needs only names.
        ...(record.groups && standing.admin ? { groups: record.groups } : {}),
      }))
    );
  }));

  fastify.log.info({ authMode: getAuthConfig().mode }, 'Auth routes registered');
}
