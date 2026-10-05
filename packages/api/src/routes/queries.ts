import type { FastifyInstance } from 'fastify';
import type { LdkitQuery } from '../persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import { expandQueryVersion } from '../lib/QueryVersionResolver.js';
import { SparqlQueryParser } from '../lib/parser.js';
import { createQueryVersionFlat } from '../lib/QueryVersionWriter.js';
import { deriveQueryVersionMetadata } from '../lib/QueryVersionDeriver.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import { deleteWithOwned, QUERY_VERSION_OWNED } from '../lib/ownedEntities.js';
import { reposRoute, setEntityConcurrencyHeaders, RouteError } from './route-helpers.js';
import { registerVersionedEntityRoutes, type StoredEntity } from './versionedEntity.js';
import { requireEntityMode } from '../auth/enforce.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import { toQueryTypeIri } from '../lib/queryTypes.js';
import { ArgumentSetService } from '../lib/ArgumentSetService.js';
import {
  argumentSetBodySchema,
  argumentSetListResponseSchema,
  argumentSetResponseSchema,
} from './argument-set-schemas.js';
import {
  getQuerysSchema,
  getQuerySchema,
  createQuerySchema,
  updateQuerySchema,
  deleteQuerySchema,
  listQueryVersionsForQuerySchema,
  createQueryVersionForQuerySchema,
  getQueryVersionForQuerySchema,
  patchQueryVersionForQuerySchema,
} from '@sparql-query-lib/contracts/schema';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { registerBrowserDefaultsRoutes } from './browser-defaults.js';
import { clearBrowserDefaultsIfMoved } from '../lib/browserDefaults.js';

/**
 * `/queries` — the reference module for `registerVersionedEntityRoutes`.
 *
 * The ten CRUD routes come from there; what is a query's own is how a version
 * body is flattened and derived from its text, that versions are shown
 * expanded, and the argument-set routes below.
 */
export default async function (fastify: FastifyInstance) {
  registerEntityAuthGuard(fastify, { executeSuffixes: ['/execute', '/execute/stream', '/run'], exemptSuffixes: ['/preview', '/preview/normalize'] });

  // Single parser instance for this plugin scope
  const parser = new SparqlQueryParser();
  const argumentSetService = new ArgumentSetService();
  const queryIdParamSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
    },
    required: ['id'],
    additionalProperties: false,
  } as const;

  registerVersionedEntityRoutes(fastify, {
    noun: 'query',
    type: 'Query',
    versionType: 'QueryVersion',
    idKind: 'query',
    acceptCallerId: true,
    schemas: {
      list: getQuerysSchema,
      create: createQuerySchema,
      get: getQuerySchema,
      update: updateQuerySchema,
      delete: deleteQuerySchema,
      listVersions: listQueryVersionsForQuerySchema,
      createVersion: createQueryVersionForQuerySchema,
      getVersion: getQueryVersionForQuerySchema,
      patchVersion: patchQueryVersionForQuerySchema,
      deleteVersion: {
        tags: ['Query'],
        summary: 'Delete a query version that nothing pins',
        response: { 204: { type: 'null' } },
      },
    },
    // A query version is always shown expanded: its parameters, variables and
    // tuples inline rather than as IRIs.
    presentVersion: version => expandQueryVersion(version as unknown as LdkitQueryVersion),
    presentVersionInList: version => toRestApi(version),
    beforeCreate: ({ body }) => (body.defaultBackend !== undefined ? { defaultBackend: body.defaultBackend } : {}),
    createVersion: async ({ parent, body: rawBody }) => {
      const body = rawBody as { queryVersion?: Record<string, unknown> } & Record<string, unknown>;
      const flat = flattenVersionBody(body);
      const { created, iriMap } = await createQueryVersionFlat(parent.$id, flat);
      const expanded = await expandQueryVersion(created);
      return { created: created as unknown as StoredEntity, body: { ...expanded, iriMap } };
    },
    deleteVersion: version => deleteWithOwned(version, 'QueryVersion', QUERY_VERSION_OWNED),
    afterUpdate: ({ before, updated }) => clearBrowserDefaultsIfMoved('Query', before, updated),
  });

  /**
   * The wire body is `{ queryVersion: { … }, ...children }`; the writer takes
   * one flat record. What the client left out — outputs, parameters, inputs —
   * is derived from the query text.
   */
  function flattenVersionBody(body: { queryVersion?: Record<string, unknown> } & Record<string, unknown>): Record<string, unknown> {
    // Enforce wrapper: { queryVersion: { ... }, ...children }
    if (!body || typeof body.queryVersion !== 'object' || !body.queryVersion) {
      throw new RouteError(400, { error: 'Body must contain queryVersion object' });
    }
    // Flatten wrapper for writer
    const flat: Record<string, unknown> = { ...body, ...body.queryVersion };
    delete flat.queryVersion;
    delete flat.inferredOutputs;

    // If client didn’t provide outputs/params, attempt to derive minimally
    if (typeof flat.queryType !== 'undefined' && typeof flat.queryType !== 'string') {
      throw new RouteError(400, { error: 'queryType must be a string' });
    }

    if (typeof flat.queryString === 'string') {
      try {
        const parsed = parser.parseQuery(flat.queryString);
        if (!flat.queryType) {
          if (parsed && parsed.type === 'update') {
            flat.queryType = QueryTypeIri.update;
          } else if (parsed && parsed.type === 'query' && parsed.subType) {
            const detected = toQueryTypeIri(String(parsed.subType));
            if (detected) {
              flat.queryType = detected;
            }
          }
        } else {
          const normalized = toQueryTypeIri(flat.queryType as string);
          if (normalized) {
            flat.queryType = normalized;
          }
        }

        const hasOutputs = Array.isArray(flat.outputs) && (flat.outputs as unknown[]).length > 0;

        const hasLimitParams = Array.isArray(flat.limitParameters) && (flat.limitParameters as unknown[]).length > 0;
        const hasOffsetParams = Array.isArray(flat.offsetParameters) && (flat.offsetParameters as unknown[]).length > 0;
        const hasInputs = Array.isArray(flat.inputs) && (flat.inputs as unknown[]).length > 0;
        const hasInputTuples = Array.isArray(flat.inferredInputs) && (flat.inferredInputs as unknown[]).length > 0;
        const hasTupleMembers = Array.isArray(flat.tupleMembers) && (flat.tupleMembers as unknown[]).length > 0;

        const needsDerivation = !hasOutputs || !hasLimitParams || !hasOffsetParams || (!hasInputs && !hasInputTuples && !hasTupleMembers);
        if (needsDerivation) {
          const derived = deriveQueryVersionMetadata(parser, flat.queryString);
          if (!hasOutputs && derived.outputs.length > 0) flat.outputs = derived.outputs;
          if (!hasLimitParams && derived.limitParameters.length > 0) flat.limitParameters = derived.limitParameters;
          if (!hasOffsetParams && derived.offsetParameters.length > 0) flat.offsetParameters = derived.offsetParameters;
          if (!hasInputs && !hasInputTuples && !hasTupleMembers) {
            if (derived.inputs.length > 0) flat.inputs = derived.inputs;
            if (derived.tupleMembers.length > 0) flat.tupleMembers = derived.tupleMembers;
            if (derived.inputTuples.length > 0) flat.inferredInputs = derived.inputTuples;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new RouteError(400, { error: 'Invalid SPARQL query', details: message });
      }
    }
    return flat;
  }

  fastify.get('/:id/argument-sets', ...reposRoute({
    params: queryIdParamSchema,
    response: {
      200: argumentSetListResponseSchema,
      404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
    },
  }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const query = repos.Query.get(id) as LdkitQuery | null;
    if (!query) {
      return reply.status(404).send({ error: `Query ${id} not found` });
    }
    requireEntityMode(request, query, 'read');
    const sets = await argumentSetService.listForTarget(id, 'query');
    return reply.send(sets);
  }));

  fastify.post('/:id/argument-sets', ...reposRoute({
    params: queryIdParamSchema,
    body: argumentSetBodySchema,
    response: {
      201: argumentSetResponseSchema,
      404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
    },
  }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const query = repos.Query.get(id) as LdkitQuery | null;
    if (!query) {
      return reply.status(404).send({ error: `Query ${id} not found` });
    }
    requireEntityMode(request, query, 'write');
    const body = request.body;
    // `{ request }` is what carries the caller into the pinned-source check:
    // the guard above covers this query's library, the check covers any tuple
    // set version the body pins from another one.
    const created = await argumentSetService.createForTarget('query', id, body, { request });
    reply.code(201);
    if (created.dateModified) {
      setEntityConcurrencyHeaders(reply, { dateModified: created.dateModified });
    }
    return reply.send(created);
  }));

  registerBrowserDefaultsRoutes(fastify, 'Query');
}
