import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { toError } from '../lib/toError.js';
import { type CacheCoordinator } from '../lib/CacheCoordinator.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { getNodeEphemeralBackendConfig } from '../lib/type-guards.js';
import type { EntityType } from '../lib/EntityRegistry.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { LdkitQueryGroup } from '../persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryGroupVersion } from '../persistence/schemas/QueryGroupVersionSchema.js';
import type { LdkitQuery } from '../persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { LdkitRuleSet } from '../persistence/schemas/RuleSetSchema.js';
import type { LdkitRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import type { LdkitQueryEdge } from '../persistence/schemas/QueryEdgeSchema.js';
import { expandGroupVersion, expandGroupVersionDetailed } from '../lib/GraphResolver.js';
import { deleteWithOwned, GROUP_VERSION_OWNED } from '../lib/ownedEntities.js';
import { createGroupVersionFlat } from '../lib/GroupVersionWriter.js';
import {
  BACKEND_TYPES,
  QUERY_VERSION_TYPES,
  RULESET_VERSION_TYPES,
  isUnresolvableReferencesError,
} from '../lib/groupVersionReferences.js';
import { setEntityConcurrencyHeaders, typedRoute, reposRoute, RouteError } from './route-helpers.js';
import { registerVersionedEntityRoutes, type StoredEntity } from './versionedEntity.js';
import { ArgumentSetService } from '../lib/ArgumentSetService.js';
import { AuthorizationError, filterReadable, requireEntityMode } from '../auth/enforce.js';
import {
  argumentSetBodySchema,
  argumentSetListResponseSchema,
  argumentSetResponseSchema,
} from './argument-set-schemas.js';
import {
  getQueryGroupsSchema,
  getQueryGroupSchema,
  createQueryGroupSchema,
  updateQueryGroupSchema,
  deleteQueryGroupSchema,
  listQueryGroupVersionsForGroupSchema,
  createQueryGroupVersionForGroupFlatSchema,
  getQueryGroupVersionForGroupSchema,
  patchQueryGroupVersionForGroupSchema,
  validateQueryGroupVersionSchema,
} from '@sparql-query-lib/contracts/schema';
import { GraphBuilder } from '../lib/orchestration/GraphBuilder.js';
import { isGraphValidationError } from '../lib/orchestration/GraphValidationError.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { registerBrowserDefaultsRoutes } from './browser-defaults.js';
import { clearBrowserDefaultsIfMoved, deleteBrowserDefaultsOf } from '../lib/browserDefaults.js';

// Loose shape for execution nodes read back from the cache (union of concrete node types).
type CachedNodeShape = {
  '@type'?: string;
  nodeType?: string;
  ruleSetVersion?: string;
  queryId?: string;
  backendId?: string;
  backendConfig?: { type?: string; storeId?: string } | null;
};

const argumentSetService = new ArgumentSetService();
// Resolved per call rather than captured at load, so it follows
// `clearCacheCoordinator()` like everything else that reaches the cache.
const cache = {
  get: (id: string) => getCacheCoordinator().get(id),
  getByType: (type: EntityType) => getCacheCoordinator().list(type),
  create<T = any>(entity: Record<string, unknown>, type: EntityType): Promise<T> {
    return getCacheCoordinator().create(type, entity as Parameters<CacheCoordinator['create']>[1]) as Promise<T>;
  },
  update<T = any>(id: string, updates: Record<string, unknown>, type: EntityType): Promise<T | null> {
    return getCacheCoordinator().update(type, id, updates as Parameters<CacheCoordinator['update']>[2]) as Promise<T | null>;
  },
  delete: (id: string, type: EntityType) => getCacheCoordinator().delete(type, id),
};
const groupIdParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
} as const;

/**
 * Flatten a version PATCH body for `classifyVersionPatch`.
 *
 * The wire shape allows both `{ comment }` and `{ queryGroupVersion: { comment } }`,
 * and the wrapped form wins. Unknown keys are kept rather than dropped: a
 * caller patching a field this route does not recognise should be told so, not
 * have the field silently ignored.
 */
function unwrapGroupVersionPatch(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const { queryGroupVersion, ...rest } = payload as Record<string, unknown> & {
    queryGroupVersion?: Record<string, unknown>;
  };
  const wrapped = queryGroupVersion && typeof queryGroupVersion === 'object' ? queryGroupVersion : {};
  return { ...rest, ...wrapped };
}

/**
 * The 500 a handler here falls back to once nothing more specific applies.
 *
 * Logged in full and answered with a fixed sentence. The message of an error
 * nobody anticipated is whatever the layer that threw it chose to say — a
 * store error can carry a SPARQL fragment, an IRI in another library, a file
 * path — and a response body is the wrong place to find out which. The log
 * keeps what an operator needs; the caller learns only that it failed.
 *
 * A refusal is re-thrown rather than answered. These catch-alls wrap handlers
 * that now call `requireEntityMode` themselves, and flattening the
 * `AuthorizationError` into a 500 would report "the server broke" where the
 * answer is a 403 the error handler gives.
 */
function sendInternalError(reply: FastifyReply, error: unknown, failure: string): FastifyReply {
  if (error instanceof AuthorizationError) throw error;
  reply.log.error({ err: error }, failure);
  return reply.status(500).send({ error: failure });
}

/**
 * A group version as GET shows it: expanded, with `iriMap` naming the query and
 * rule set versions its nodes run.
 *
 * The map covers the versions the caller may read, not every version in the
 * deployment: it is keyed by IRI rather than by this group's nodes, so
 * unfiltered it named every query in every library to anyone who could open
 * one group version. A node whose version is withheld falls back to the
 * canvas's generic label, which is what it shows for any version it cannot
 * name. Rule set versions are in it too: a RuleSetNode names a
 * `ruleSetVersion`, and with only query versions here an assigned rule set
 * came back as "Unknown" on every reload.
 */
async function presentGroupVersion(version: LdkitQueryGroupVersion, request: FastifyRequest): Promise<unknown> {
  let rich: Record<string, unknown>;
  try {
    rich = await expandGroupVersionDetailed(version, { request }) as unknown as Record<string, unknown>;
  } catch {
    return expandGroupVersion(version);
  }

  const iriMap: Record<string, string> = {};
  const names = new Map<string, string>();
  for (const query of cache.getByType('Query') as LdkitQuery[]) {
    if (query.name) names.set(query.$id, query.name);
  }
  for (const ruleSet of cache.getByType('RuleSet') as LdkitRuleSet[]) {
    if (ruleSet.name) names.set(ruleSet.$id, ruleSet.name);
  }
  const readableVersions = [
    ...filterReadable(request, cache.getByType('QueryVersion') as LdkitQueryVersion[]),
    ...filterReadable(request, cache.getByType('RuleSetVersion') as LdkitRuleSetVersion[]),
  ];
  for (const readable of readableVersions) {
    const name = names.get(readable.isPartOf);
    if (name) iriMap[readable.$id] = name;
  }
  return { ...rich, iriMap };
}

export default async function (fastify: FastifyInstance) {
  registerEntityAuthGuard(fastify, { executeSuffixes: ['/execute', '/execute/stream', '/run'], exemptSuffixes: ['/preview', '/preview/normalize'] });

  registerVersionedEntityRoutes(fastify, {
    noun: 'query group',
    type: 'QueryGroup',
    versionType: 'QueryGroupVersion',
    idKind: 'group',
    acceptCallerId: true,
    containment: 'single',
    schemas: {
      list: getQueryGroupsSchema,
      create: createQueryGroupSchema,
      get: getQueryGroupSchema,
      update: updateQueryGroupSchema,
      delete: deleteQueryGroupSchema,
      listVersions: listQueryGroupVersionsForGroupSchema,
      createVersion: createQueryGroupVersionForGroupFlatSchema,
      getVersion: getQueryGroupVersionForGroupSchema,
      // The group's in-place overwrite went in #191 and the API half in #192:
      // a version is what the graph looked like when it was saved. `canvasData`
      // is content rather than annotation deliberately — it rides in the
      // version payload, so allowing it would mean dragging a node while
      // viewing an old version silently rewrites that version.
      patchVersion: patchQueryGroupVersionForGroupSchema,
      deleteVersion: {
        tags: ['QueryGroup'],
        summary: 'Delete a query group version that nothing pins',
        response: { 204: { type: 'null' } },
      },
    },
    presentVersion: (version, request) => presentGroupVersion(version as unknown as LdkitQueryGroupVersion, request),
    presentVersionInList: version => toRestApi(version),
    unwrapVersionPatch: unwrapGroupVersionPatch,
    createVersion: async ({ request, parent, body }) => {
      // Enforce wrapper: { queryGroupVersion: { ... }, ...children }
      const { queryGroupVersion, ...children } = body as { queryGroupVersion?: unknown } & Record<string, unknown>;
      if (!queryGroupVersion || typeof queryGroupVersion !== 'object') {
        throw new RouteError(400, { error: 'Body must contain queryGroupVersion object' });
      }
      // Flatten for the writer, which expects canvasData at top level.
      const flat = { ...children, ...(queryGroupVersion as Record<string, unknown>) };

      // `{ request }` is what lets the writer check the query versions and
      // rule set versions this body's nodes will run; the route covers only
      // the group being written.
      const { created, iriMap } = await createGroupVersionFlat(parent.$id, flat as Parameters<typeof createGroupVersionFlat>[1], { request });

      // Composing needed Execute on each leg's library, which is not Read on
      // it, so the author is not owed the text of every query they wired in.
      const expanded = await expandGroupVersionDetailed(created, { request });
      const payload = ('inputTuples' in expanded)
        ? expanded
        : ({ inputTuples: [], ...(expanded as Record<string, unknown>) });
      return { created: created as unknown as StoredEntity, body: { ...payload, iriMap } };
    },
    // A payload that is well-formed but names entities that do not exist is
    // the client's to fix, not a server fault. Staging rejects before anything
    // is written, so there is nothing to clean up.
    mapCreateVersionError: error => isUnresolvableReferencesError(error)
      ? new RouteError(422, { error: (error as Error).message, references: error.failures })
      : null,
    deleteVersion: version => deleteWithOwned(version, 'QueryGroupVersion', GROUP_VERSION_OWNED),
    afterUpdate: ({ before, updated }) => clearBrowserDefaultsIfMoved('QueryGroup', before, updated),
    beforeDelete: entity => deleteBrowserDefaultsOf(entity),
  });

  // GET /query-groups/:id/versions/:version/validate — validate query group version
  fastify.get('/:id/versions/:version/validate', ...typedRoute(validateQueryGroupVersionSchema, async (request, reply) => {
    try {
      const { id: groupId, version } = request.params;
      const targetVer = parseInt(version, 10);

      const qgv = (cache.getByType('QueryGroupVersion') as LdkitQueryGroupVersion[])
        .find(v => v.isPartOf === groupId && Number(v.version) === targetVer);
      if (!qgv) return reply.status(404).send({ error: 'Query group version not found' });
      requireEntityMode(request, qgv, 'read');

      type ValidationIssue = {
        level: 'error' | 'warning';
        message: string;
        entityType?: string;
        entityId?: string | null;
        code?: string | null;
      };

      const errors: string[] = [];
      const warnings: string[] = [];
      const issues: ValidationIssue[] = [];

      const pushIssue = (
        level: 'error' | 'warning',
        message: string,
        entityType?: string,
        entityId?: string | null,
        code?: string | null,
      ) => {
        const normalizedEntityId = entityId ?? null;
        issues.push({
          level,
          message,
          entityType,
          entityId: normalizedEntityId,
          code: code ?? null,
        });
        if (level === 'error') {
          if (!errors.includes(message)) {
            errors.push(message);
          }
        } else {
          if (!warnings.includes(message)) {
            warnings.push(message);
          }
        }
      };

      // Validate that edges reference existing nodes
      for (const edgeRef of (qgv.edges || [])) {
        const edgeId = typeof edgeRef === 'string' ? edgeRef : String(edgeRef);
        const edge = cache.get(edgeId) as LdkitQueryEdge | null;
        if (!edge) {
          pushIssue('error', `Edge ${edgeId} not found`, 'edge', edgeId, 'EDGE_MISSING');
          continue;
        }

        const sourceNode = cache.get(edge.sourceNodeId as string);
        const targetNode = cache.get(edge.targetNodeId as string);

        if (!sourceNode) {
          pushIssue(
            'error',
            `Edge ${edgeId} references missing source node ${edge.sourceNodeId}`,
            'edge',
            edgeId,
            'EDGE_SOURCE_MISSING',
          );
        }
        if (!targetNode) {
          pushIssue(
            'error',
            `Edge ${edgeId} references missing target node ${edge.targetNodeId}`,
            'edge',
            edgeId,
            'EDGE_TARGET_MISSING',
          );
        }

        // Validate I/O entities exist
        if (edge.sourceOutputId) {
          const sourceIO = cache.get(edge.sourceOutputId);
          if (!sourceIO) {
            pushIssue(
              'error',
              `Edge ${edgeId} references missing source I/O entity ${edge.sourceOutputId}`,
              'edge',
              edgeId,
              'EDGE_SOURCE_IO_MISSING',
            );
          }
        }
        if (edge.targetInputId) {
          const targetIO = cache.get(edge.targetInputId);
          if (!targetIO) {
            pushIssue(
              'error',
              `Edge ${edgeId} references missing target I/O entity ${edge.targetInputId}`,
              'edge',
              edgeId,
              'EDGE_TARGET_IO_MISSING',
            );
          }
        }
      }

      // Validate execution nodes have backend and query IDs (except RuleSetNodes)
      for (const nodeRef of (qgv.executionNodes || [])) {
        const nodeId = typeof nodeRef === 'string' ? nodeRef : String(nodeRef);
        const node = cache.get(nodeId) as CachedNodeShape | null;
        if (!node) {
          pushIssue('error', `Execution node ${nodeId} not found`, 'node', nodeId, 'NODE_MISSING');
          continue;
        }

        const nodeType = node['@type'] || node.nodeType;

        /**
         * A node reference is only sound if it resolves to an entity of the
         * right type. These used to test presence alone and report absence as
         * a warning, so a version whose RuleSetNode pointed at a deleted
         * rule-set version validated clean. Same allowed-type sets the writer
         * stages against, so the two cannot disagree.
         */
        const checkReference = (
          field: 'queryId' | 'backendId' | 'ruleSetVersion',
          value: string | undefined,
          allowed: readonly string[],
          code: string,
        ) => {
          if (!value) {
            pushIssue('error', `${nodeType} ${nodeId} has no ${field}`, 'node', nodeId, code);
            return;
          }
          const target = cache.get(value) as { '@type'?: string } | null;
          if (!target) {
            pushIssue(
              'error',
              `${nodeType} ${nodeId} ${field} ${value} does not exist`,
              'node', nodeId, code,
            );
            return;
          }
          if (target['@type'] && !allowed.includes(target['@type'])) {
            pushIssue(
              'error',
              `${nodeType} ${nodeId} ${field} ${value} is a ${target['@type']}, expected ${allowed.join(' or ')}`,
              'node', nodeId, code,
            );
          }
        };

        if (nodeType === 'RuleSetNode') {
          checkReference(
            'ruleSetVersion', node.ruleSetVersion, RULESET_VERSION_TYPES,
            'NODE_RULESET_VERSION_UNRESOLVABLE',
          );
        } else {
          // A DynamicQueryNode is handed its query at execution time through a
          // QueryIdInput, so having none here is correct, not missing.
          if (nodeType !== 'DynamicQueryNode' || node.queryId) {
            checkReference(
              'queryId', node.queryId, QUERY_VERSION_TYPES, 'NODE_QUERY_ID_UNRESOLVABLE');
          }
          /*
           * A node reads one backend or the other: a resolvable `backendId`,
           * or the ephemeral store its `backendConfig` names (issue #297).
           * `ExecutorFactory` branches on the config first, and the writer
           * rejects a node that carries both, so demanding `backendId` from
           * every node reported the all-ephemeral groups — the seeded
           * two-input SHACL validation example among them — as broken when
           * they run fine. Same rule as `GraphBuilder`, so the canvas and a
           * run cannot disagree.
           */
          const ephemeralConfig = getNodeEphemeralBackendConfig(node);
          if (!ephemeralConfig) {
            checkReference(
              'backendId', node.backendId, BACKEND_TYPES, 'NODE_BACKEND_UNRESOLVABLE');
          } else if (node.backendId) {
            pushIssue(
              'error',
              `${nodeType} ${nodeId} names backendId ${node.backendId} alongside ephemeral store `
                + `${ephemeralConfig.storeId}; the node reads one or the other`,
              'node', nodeId, 'NODE_BACKEND_CONFLICT',
            );
          }
        }
      }

      // Run GraphBuilder to surface structural validation errors
      try {
        const gb = new GraphBuilder();
        gb.buildFromGroupVersion(qgv);
      } catch (graphError__u: unknown) {
      const graphError = toError(graphError__u);
        const message = graphError?.message ? String(graphError.message) : String(graphError);
        const hasDuplicate = errors.includes(message);
        if (!hasDuplicate) {
          // Structural failures carry their own code and offending entity. Anything
          // untyped is a builder error rather than a graph-shape rejection, so it
          // keeps the generic code instead of guessing an entity from the prose.
          if (isGraphValidationError(graphError)) {
            pushIssue('error', message, graphError.entityType, graphError.entityId, graphError.code);
          } else {
            pushIssue('error', message, 'graph', null, 'GRAPH_VALIDATION');
          }
        }
      }

      const valid = errors.length === 0;

      return reply.send({
        valid,
        errors,
        warnings,
        issues
      });
    } catch (e__u: unknown) {
      return sendInternalError(reply, e__u, 'Failed to validate query group version');
    }
  }));

  fastify.get('/:id/argument-sets', ...reposRoute({
      params: groupIdParamSchema,
      response: {
        200: argumentSetListResponseSchema,
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const group = repos.QueryGroup.get(id) as LdkitQueryGroup | null;
    if (!group) {
      return reply.status(404).send({ error: `QueryGroup ${id} not found` });
    }
    requireEntityMode(request, group, 'read');
    const sets = await argumentSetService.listForTarget(id, 'queryGroup');
    return reply.send(sets);
  }));

  fastify.post('/:id/argument-sets', ...reposRoute({
      params: groupIdParamSchema,
      body: argumentSetBodySchema,
      response: {
        201: argumentSetResponseSchema,
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const group = repos.QueryGroup.get(id) as LdkitQueryGroup | null;
    if (!group) {
      return reply.status(404).send({ error: `QueryGroup ${id} not found` });
    }
    /*
     * The query routes beside these have always called this; the group pair did
     * not, relying on the plugin-level guard alone. That guard resolves an
     * entity from the path id, so it did cover them — but the two spellings
     * disagreeing is how one of them comes to be wrong later.
     */
    requireEntityMode(request, group, 'write');
    const body = request.body;
    // As on the query route beside it: the guard covers this group's library,
    // `{ request }` is what lets the service check the versions the body pins.
    const created = await argumentSetService.createForTarget('queryGroup', id, body, { request });
    reply.code(201);
    if (created.dateModified) {
      setEntityConcurrencyHeaders(reply, { dateModified: created.dateModified });
    }
    return reply.send(created);
  }));

  registerBrowserDefaultsRoutes(fastify, 'QueryGroup');
}
