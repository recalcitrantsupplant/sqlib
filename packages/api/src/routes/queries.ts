import type { FastifyInstance } from 'fastify';
import { mintId } from '../lib/id.js';
import { toRestApi, toLdkit } from '../persistence/utils/id-adapter.js';
import type { LdkitQuery } from '../persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import { expandQueryVersion } from '../lib/QueryVersionResolver.js';
import { SparqlQueryParser } from '../lib/parser.js';
import { createQueryVersionFlat, cleanupOrphanedAutoTuple, findExistingAutoTuple } from '../lib/QueryVersionWriter.js';
import { deriveQueryVersionMetadata } from '../lib/QueryVersionDeriver.js';
import { classifyVersionPatch } from '../lib/versionPatch.js';
import { reposRoute, validateIfMatch, setEntityConcurrencyHeaders } from './route-helpers.js';
import { filterReadable, requireEntityMode } from '../auth/enforce.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { analyseReferences, describeWrongType } from '../lib/entityReferences.js';
import { analyseTags } from '../lib/tagMembership.js';
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

// Utilities for sorting and selecting versions
function byVersionAsc(a: { version?: number | string }, b: { version?: number | string }) {
  const va = typeof a.version === 'number' ? a.version : parseInt(String(a.version || 0), 10);
  const vb = typeof b.version === 'number' ? b.version : parseInt(String(b.version || 0), 10);
  return va - vb;
}

// Note: Auto-tuple creation is now handled by QueryVersionWriter.createQueryVersionFlat
// This helper is only used for PATCH operations to maintain inferred outputs

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
  // GET /queries — list all stable queries (from cache)
  fastify.get('/', ...reposRoute(getQuerysSchema, async ({ repos, reply, request }) => {
    const items = repos.Query.list() as LdkitQuery[];
    return reply.send(filterReadable(request, items).map(q => toRestApi(q)));
  }));

  // POST /queries — create a stable Query (no currentVersion required at creation)
  fastify.post('/', ...reposRoute(createQuerySchema, async ({ repos, reply, request }) => {
    const body = request.body;
    const cacheCoordinator = getCacheCoordinator();

    // Normalize isPartOf to array
    const isPartOfArray = Array.isArray(body.isPartOf) ? body.isPartOf : body.isPartOf ? [body.isPartOf] : [];

    // What a query's parents may be, and how many of them may be a library, is
    // declared on `Query.isPartOf` (`@references`) rather than restated here.
    const parents = analyseReferences('Query', 'isPartOf', isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );

    if (parents.missing.length > 0) {
      return reply.status(400).send({ error: `Referenced entity ${parents.missing[0]} does not exist` });
    }

    if (parents.wrongType.length > 0) {
      return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
    }

    if (parents.exactlyOneCount === 0) {
      return reply.status(400).send({ error: 'Query must be part of exactly one library' });
    }

    if ((parents.exactlyOneCount ?? 0) > 1) {
      return reply.status(400).send({ error: 'Query can only be part of one library (multiple query groups allowed)' });
    }

    const tagCheck = analyseTags('Query', body.tags, isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    // The library is the unit of sharing: creating inside it needs write there.
    requireEntityMode(request, { isPartOf: isPartOfArray }, 'write');

    const id = body.id || mintId('query');
    const toCreate: Partial<LdkitQuery> & { $id: string } = {
      $id: id,
      name: body.name,
      description: body.description,
      defaultBackend: body.defaultBackend,
      isPartOf: isPartOfArray,
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
    };

    const created = await repos.Query.create(toCreate);
    setEntityConcurrencyHeaders(reply, created);
    return reply.status(201).send(toRestApi(created));
  }));

  // GET /queries/:id — get a stable Query
  fastify.get('/:id', ...reposRoute(getQuerySchema, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const item = repos.Query.get(id) as LdkitQuery | null;
    if (!item) return reply.status(404).send({ error: 'Not Found' });
    requireEntityMode(request, item, 'read');
    setEntityConcurrencyHeaders(reply, item);
    return reply.send(toRestApi(item));
  }));

  // PUT /queries/:id — update stable Query metadata or currentVersion
  fastify.put('/:id', ...reposRoute(updateQuerySchema, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const updates = request.body;
    const cacheCoordinator = getCacheCoordinator();

    const current = repos.Query.get(id) as LdkitQuery | null;
    if (!current) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    requireEntityMode(request, current, 'write');

    const { valid, currentTag } = validateIfMatch(request, current);
    if (!valid) {
      return reply.status(412).send({
        error: 'Precondition Failed',
        expected: currentTag,
        current: toRestApi(current),
      });
    }

    // If updating isPartOf, validate the constraint
    if (updates.isPartOf !== undefined) {
      const isPartOfArray = Array.isArray(updates.isPartOf) ? updates.isPartOf : [updates.isPartOf];

      const parents = analyseReferences('Query', 'isPartOf', isPartOfArray, iri =>
        cacheCoordinator.get(iri)
      );

      if (parents.missing.length > 0) {
        return reply.status(400).send({ error: `Referenced entity ${parents.missing[0]} does not exist` });
      }

      if (parents.wrongType.length > 0) {
        return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
      }

      if (parents.exactlyOneCount === 0) {
        return reply.status(400).send({ error: 'Query must be part of exactly one library' });
      }

      if ((parents.exactlyOneCount ?? 0) > 1) {
        return reply.status(400).send({ error: 'Query can only be part of one library (multiple query groups allowed)' });
      }

      // Ensure the updates use array format
      updates.isPartOf = isPartOfArray;
    }

    // Judged against the containment this write leaves behind, so moving and
    // retagging in one request is checked against the destination library.
    const tagCheck = analyseTags(
      'Query',
      updates.tags,
      updates.isPartOf ?? current.isPartOf,
      iri => cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }
    if (tagCheck.tags !== undefined) {
      updates.tags = tagCheck.tags;
    }

    const updated = await repos.Query.update(id, updates);
    if (!updated) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(toRestApi(updated));
  }));

  // DELETE /queries/:id — delete stable Query
  fastify.delete('/:id', ...reposRoute(deleteQuerySchema, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const existing = repos.Query.get(id) as LdkitQuery | null;
    if (existing) requireEntityMode(request, existing, 'delete');
    await repos.Query.delete(id);
    return reply.status(204).send();
  }));

  /*
   * GET /queries/:id/v — list versions for a query
   *
   * The three routes below match versions by `isPartOf` and never look the
   * query in the path up, so the plugin guard's premise does not hold for
   * them: it resolves `:id` through the cache and abstains on a miss, because
   * "a miss is a 404 the handler will produce" — true where the handler reads
   * the same id, and false here. A query's versions outlive it (deletion is
   * one entity, not a cascade), so a version whose query no longer resolves
   * was reachable with no check at all.
   *
   * `filterReadable` rather than a 404 for the listing: an unresolvable
   * version has no library, so it is not readable by anyone below admin, and
   * an unknown id keeps answering with an empty list rather than gaining a
   * status code that says whether it ever existed.
   */
  fastify.get('/:id/v', ...reposRoute(listQueryVersionsForQuerySchema, async ({ repos, reply, request }) => {
    const { id } = request.params;

    const readAllVersions = async (): Promise<LdkitQueryVersion[]> => {
      try {
        const items = repos.QueryVersion.list() as LdkitQueryVersion[] | undefined;
        return Array.isArray(items) ? items : [];
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (/Cache not loaded/i.test(error.message)) {
          return [];
        }
        throw error;
      }
    };

    const allVersions = await readAllVersions();
    const versions = allVersions
      .filter(v => {
        const partOf = Array.isArray(v.isPartOf) ? v.isPartOf : [v.isPartOf];
        return partOf.includes(id);
      })
      .sort(byVersionAsc);

    return reply.send(filterReadable(request, versions).map(v => toRestApi(v)));
  }));

  // POST /queries/:id/v — create a new version; set currentVersion to it by default
  fastify.post(
    '/:id/v',
    ...reposRoute(createQueryVersionForQuerySchema, async ({ repos, reply, request }) => {
      const { id: queryId } = request.params;
      const parent = repos.Query.get(queryId) as LdkitQuery | null;
      if (!parent) return reply.status(404).send({ error: 'Query not found' });
      requireEntityMode(request, parent, 'write');

      const body = request.body;
      // Enforce wrapper: { queryVersion: { ... }, ...children }
      if (!body || typeof body.queryVersion !== 'object' || !body.queryVersion) {
        return reply.status(400).send({ error: 'Body must contain queryVersion object' });
      }
      // Flatten wrapper for writer
      const flat: Record<string, unknown> = { ...body, ...body.queryVersion };
      delete flat.queryVersion;
      delete flat.inferredOutputs;

      // If client didn’t provide outputs/params, attempt to derive minimally
      if (typeof flat.queryType !== 'undefined' && typeof flat.queryType !== 'string') {
        return reply.status(400).send({ error: 'queryType must be a string' });
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
          return reply.status(400).send({ error: 'Invalid SPARQL query', details: message });
        }
      }

      try {
        const { created, iriMap } = await createQueryVersionFlat(queryId, flat);
        const { expandQueryVersion } = await import('../lib/QueryVersionResolver.js');
        const expanded = await expandQueryVersion(created);
        setEntityConcurrencyHeaders(reply, created);
        return reply.status(201).send({ ...expanded, iriMap });
      } catch (error) {
        console.error('Error creating query version:', error);
        return reply.status(500).send({
          error: 'Failed to create query version',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    })
  );

  // GET /queries/:id/v/:version — fetch a specific version (always expanded)
  fastify.get('/:id/v/:version', ...reposRoute(getQueryVersionForQuerySchema, async ({ repos, reply, request }) => {
    const { id: queryId, version } = request.params;
    const targetVer = parseInt(version, 10);
    const match = (repos.QueryVersion.list() as LdkitQueryVersion[])
      .find(v => v.isPartOf === queryId && Number(v.version) === targetVer);
    if (!match) return reply.status(404).send({ error: 'Not Found' });
    // The version, not the path's `:id`: a version whose query no longer
    // resolves has no library, and reading it is refused rather than waved
    // through by a guard that could not resolve anything either.
    requireEntityMode(request, match, 'read');
    const expanded = await expandQueryVersion(match);
    setEntityConcurrencyHeaders(reply, match);
    return reply.send(expanded);
  }));

  // PATCH /queries/:id/v/:version — annotate a version; content is a snapshot
  //
  // A version is not edited in place (issue #192). `comment` is metadata about
  // the snapshot rather than part of it, so it stays writable; `queryString`
  // and everything else it derives from does not. Saving a new version is
  // the only way to change what a query says.
  fastify.patch('/:id/v/:version', ...reposRoute(patchQueryVersionForQuerySchema, async ({ repos, reply, request }) => {
    const { id: queryId, version } = request.params;
    const targetVer = parseInt(version, 10);

    // Find the existing version
    const existing = (repos.QueryVersion.list() as LdkitQueryVersion[])
      .find(v => v.isPartOf === queryId && Number(v.version) === targetVer);
    if (!existing) return reply.status(404).send({ error: 'Query version not found' });
    requireEntityMode(request, existing, 'write');

    const { annotations, rejection } = classifyVersionPatch(request.body as Record<string, unknown>);
    if (rejection) return reply.status(rejection.status).send(rejection);

    const { valid, currentTag } = validateIfMatch(request, existing);
    if (!valid) {
      const expanded = await expandQueryVersion(existing);
      return reply.status(412).send({
        error: 'Precondition Failed',
        expected: currentTag,
        current: expanded,
      });
    }

    if (Object.keys(annotations).length === 0) {
      const expanded = await expandQueryVersion(existing);
      setEntityConcurrencyHeaders(reply, existing);
      return reply.send(expanded);
    }

    const updated = await repos.QueryVersion.update(existing.$id, annotations);
    if (!updated) {
      return reply.status(404).send({ error: 'Query version not found' });
    }
    const expanded = await expandQueryVersion(updated);
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(expanded);
  }));

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
    // set or data graph version the body pins from another one.
    const created = await argumentSetService.createForTarget('query', id, body, { request });
    reply.code(201);
    if (created.dateModified) {
      setEntityConcurrencyHeaders(reply, { dateModified: created.dateModified });
    }
    return reply.send(created);
  }));
}
