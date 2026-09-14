import type { FastifyInstance, FastifyReply } from 'fastify';
import { mintId } from '../lib/id.js';
import { toError } from '../lib/toError.js';
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
import { expandCurrentVersionForGroup, expandGroupVersion } from '../lib/GraphResolver.js';
import { createGroupVersionFlat } from '../lib/GroupVersionWriter.js';
import { classifyVersionPatch } from '../lib/versionPatch.js';
import {
  BACKEND_TYPES,
  IO_REFERENCE_TYPES,
  QUERY_VERSION_TYPES,
  RULESET_VERSION_TYPES,
  isUnresolvableReferencesError,
} from '../lib/groupVersionReferences.js';
import { validateIfMatch, setEntityConcurrencyHeaders, typedRoute, reposRoute, withReposHandler } from './route-helpers.js';
import { ArgumentSetService } from '../lib/ArgumentSetService.js';
import { requireEntityMode } from '../auth/enforce.js';
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
import { analyseTags } from '../lib/tagMembership.js';

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
const cacheCoordinator = getCacheCoordinator();
const cache = {
  get: (id: string) => cacheCoordinator.get(id),
  getByType: (type: EntityType) => cacheCoordinator.list(type),
  create<T = any>(entity: Record<string, unknown>, type: EntityType): Promise<T> {
    return cacheCoordinator.create(type, entity as Parameters<typeof cacheCoordinator.create>[1]) as Promise<T>;
  },
  update<T = any>(id: string, updates: Record<string, unknown>, type: EntityType): Promise<T | null> {
    return cacheCoordinator.update(type, id, updates as Parameters<typeof cacheCoordinator.update>[2]) as Promise<T | null>;
  },
  delete: (id: string, type: EntityType) => cacheCoordinator.delete(type, id),
};
const groupIdParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
} as const;

function byVersionAsc(a: { version?: number | string }, b: { version?: number | string }) {
  return Number(a.version) - Number(b.version);
}

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

export default async function (fastify: FastifyInstance) {
  registerEntityAuthGuard(fastify, { executeSuffixes: ['/execute', '/execute/stream', '/run'], exemptSuffixes: ['/preview', '/preview/normalize'] });

  // GET /query-groups
  fastify.get('/', ...typedRoute(getQueryGroupsSchema, async (request, reply) => {
    try {
      const items = cache.getByType('QueryGroup') as LdkitQueryGroup[];
      return reply.send(items.map(i => toRestApi(i)));
    } catch (e__u: unknown) {
      const e = toError(e__u);
      console.error('Error fetching query groups:', e);
      return reply.status(500).send({
        error: 'Failed to fetch query groups',
        details: e.message,
        stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
      });
    }
  }));

  // POST /query-groups
  fastify.post('/', ...typedRoute(createQueryGroupSchema, async (request, reply) => {
    try {
      const body = request.body;

      // Validate that isPartOf (library) is provided
      if (!body.isPartOf) {
        return reply.status(400).send({ error: 'isPartOf (library) is required' });
      }

      // Verify that the referenced library exists and is actually a library
      const library = cache.get(body.isPartOf);
      if (!library) {
        return reply.status(400).send({ error: 'Referenced library does not exist' });
      }
      
      if (library['@type'] !== 'Library') {
        return reply.status(400).send({ error: 'Query groups can only belong to libraries' });
      }

      const tagCheck = analyseTags('QueryGroup', body.tags, body.isPartOf, iri => cache.get(iri));
      if (!tagCheck.ok) {
        return reply.status(400).send({ error: tagCheck.error });
      }

      const id = body.id || mintId('group');
      const toCreate: Partial<LdkitQueryGroup> = {
        $id: id,
        name: body.name,
        description: body.description,
        isPartOf: body.isPartOf,
        ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
      };

      const created = await cache.create<LdkitQueryGroup>(toCreate, 'QueryGroup');
      setEntityConcurrencyHeaders(reply, created);
      return reply.status(201).send(toRestApi(created));
    } catch (e__u: unknown) {
      const e = toError(e__u);
      console.error('Error creating query group:', e);
      return reply.status(500).send({
        error: 'Failed to create query group',
        details: e.message,
        stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
      });
    }
  }));

  // GET /query-groups/:id — return stable entity only (no expand flag)
  fastify.get('/:id', ...typedRoute(getQueryGroupSchema, async (request, reply) => {
    try {
      const { id } = request.params;
      const item = cache.get(id) as LdkitQueryGroup | null;
      if (!item) return reply.status(404).send({ error: 'Not Found' });
      const base = toRestApi(item);
      setEntityConcurrencyHeaders(reply, item);
      return reply.send(base);
    } catch (e__u: unknown) {
      const e = toError(e__u);
      return reply.status(500).send({ error: e.message });
    }
  }));

  // PUT /query-groups/:id
  fastify.put('/:id', ...typedRoute(updateQueryGroupSchema, async (request, reply) => {
    try {
      const { id } = request.params;
      const updates = request.body;
      const current = cache.get(id) as LdkitQueryGroup | null;
      if (!current) {
        return reply.status(404).send({ error: 'Not Found' });
      }

      // If updating isPartOf, validate the library constraint
      if (updates.isPartOf !== undefined) {
        const library = cache.get(updates.isPartOf);
        if (!library) {
          return reply.status(400).send({ error: 'Referenced library does not exist' });
        }
        
        if (library['@type'] !== 'Library') {
          return reply.status(400).send({ error: 'Query groups can only belong to libraries' });
        }
      }

      const { valid, currentTag } = validateIfMatch(request, current);
      if (!valid) {
        return reply.status(412).send({
          error: 'Precondition Failed',
          expected: currentTag,
          current: toRestApi(current),
        });
      }
      
      const tagCheck = analyseTags(
        'QueryGroup',
        updates.tags,
        updates.isPartOf ?? current.isPartOf,
        iri => cache.get(iri)
      );
      if (!tagCheck.ok) {
        return reply.status(400).send({ error: tagCheck.error });
      }

      const updated = await cache.update<LdkitQueryGroup>(
        id,
        { ...updates, ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}) },
        'QueryGroup'
      );
      if (!updated) {
        return reply.status(404).send({ error: 'Not Found' });
      }
      setEntityConcurrencyHeaders(reply, updated);
      return reply.send(toRestApi(updated));
    } catch (e__u: unknown) {
      const e = toError(e__u);
      return reply.status(500).send({ error: e.message });
    }
  }));

  // DELETE /query-groups/:id
  fastify.delete('/:id', ...typedRoute(deleteQueryGroupSchema, async (request, reply) => {
    try {
      const { id } = request.params;
      const versions = (cache.getByType('QueryGroupVersion') as LdkitQueryGroupVersion[])
        .filter(version => version.isPartOf === id);

      const ownedTypes = new Set<EntityType>([
        'QueryEdge', 'QueryNode', 'DynamicQueryNode', 'RuleSetNode', 'PatchNode', 'StartNode', 'EndNode',
        'QueryInputTuple', 'QueryOutputTuple', 'TupleMember', 'QueryInputVariable',
        'QueryOutputVariable', 'TriplesQuadsIO', 'BooleanIO', 'QueryIdInput',
      ]);
      const ownedReferences = ['inputs', 'outputs', 'memberEntries', 'variable'] as const;
      const deleteOwned = async (entityId: string, seen = new Set<string>()): Promise<void> => {
        if (seen.has(entityId)) return;
        seen.add(entityId);
        const entity = cache.get(entityId) as (Record<string, unknown> & { '@type'?: EntityType }) | null;
        if (!entity?.['@type'] || !ownedTypes.has(entity['@type'])) return;
        for (const key of ownedReferences) {
          const value = entity[key];
          const refs = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
          for (const ref of refs) await deleteOwned(ref, seen);
        }
        await cache.delete(entityId, entity['@type']);
      };

      for (const version of versions) {
        const ownedIds = new Set<string>([
          ...(version.edges || []),
          ...(version.executionNodes || []),
          ...(version.startNode ? [version.startNode] : []),
          ...(version.endNode ? [version.endNode] : []),
        ]);
        for (const ownedId of ownedIds) await deleteOwned(ownedId);
        await cache.delete(version.$id, 'QueryGroupVersion');
      }
      await cache.delete(id, 'QueryGroup');
      return reply.status(204).send();
    } catch (e__u: unknown) {
      const e = toError(e__u);
      return reply.status(500).send({ error: e.message });
    }
  }));

  // GET /query-groups/:id/v — list versions
  fastify.get('/:id/v', ...typedRoute(listQueryGroupVersionsForGroupSchema, async (request, reply) => {
    try {
      const { id } = request.params;
      const versions = (cache.getByType('QueryGroupVersion') as LdkitQueryGroupVersion[])
        .filter(v => v.isPartOf === id)
        .sort(byVersionAsc);
      return reply.send(versions.map(v => toRestApi(v)));
    } catch (e__u: unknown) {
      const e = toError(e__u);
      return reply.status(500).send({ error: e.message });
    }
  }));

  // POST /query-groups/:id/v — create new immutable version (flat write)
  fastify.post(
    '/:id/v',
    ...typedRoute(createQueryGroupVersionForGroupFlatSchema, async (request, reply) => {
      try {
        const { id: groupId } = request.params;
        const parent = cache.get(groupId) as LdkitQueryGroup | null;
        if (!parent) return reply.status(404).send({ error: 'QueryGroup not found' });

        const body = request.body;

        // Enforce wrapper: { queryGroupVersion: { ... }, ...children }
        if (!body || typeof body.queryGroupVersion !== 'object' || !body.queryGroupVersion) {
          return (reply as FastifyReply).status(400).send({ error: 'Body must contain queryGroupVersion object' });
        }
        // Flatten for writer (writer expects canvasData at top-level).
        // Destructured rather than spread-then-delete: the schema makes
        // `queryGroupVersion` required, so it is not a deletable property.
        const { queryGroupVersion, ...children } = body;
        const flat = { ...children, ...queryGroupVersion };

        const { created, iriMap } = await createGroupVersionFlat(groupId, flat);

        try {
          const { expandGroupVersionDetailed } = await import('../lib/GraphResolver.js');
          const expanded = await expandGroupVersionDetailed(created);

          const payload = ('inputTuples' in expanded)
            ? expanded
            : ({ inputTuples: [], ...(expanded as Record<string, unknown>) });

          const responseBody = { ...payload, iriMap };
          setEntityConcurrencyHeaders(reply, created);

          const result = reply.status(201).send(responseBody);
          return result;
        } catch (expansionError__u: unknown) {
      const expansionError = toError(expansionError__u);
          // If expansion fails, return specific error message
          return reply.status(500).send({ error: 'Failed to create query group version' });
        }
      } catch (e__u: unknown) {
      const e = toError(e__u);
        // A payload that is well-formed but names entities that do not exist
        // is the client's to fix, not a server fault. Staging rejects before
        // anything is written, so there is nothing to clean up.
        if (isUnresolvableReferencesError(e__u)) {
          return reply.status(422).send({ error: e.message, references: e__u.failures });
        }
        // If createGroupVersionFlat fails, bubble up the original error message
        return reply.status(500).send({ error: e.message });
      }
    }));

  // GET /query-groups/:id/v/:version — get specific group version (always expanded)
  fastify.get('/:id/v/:version', ...typedRoute(getQueryGroupVersionForGroupSchema, async (request, reply) => {
    try {
      const { id: groupId, version } = request.params;
      const targetVer = parseInt(version, 10);
      const match = (cache.getByType('QueryGroupVersion') as LdkitQueryGroupVersion[])
        .find(v => v.isPartOf === groupId && Number(v.version) === targetVer);
      if (!match) return reply.status(404).send({ error: 'Not Found' });
      const detailed = await expandGroupVersion(match);
      // For "flat everything", also include typed arrays and related entities
      try {
        const { expandGroupVersionDetailed } = await import('../lib/GraphResolver.js');
        const rich = await expandGroupVersionDetailed(match);

        // Build iriMap with query version IDs mapped to query names
        const iriMap: Record<string, string> = {};
        const allQueries = cache.getByType('Query') as LdkitQuery[];
        const allQueryVersions = cache.getByType('QueryVersion') as LdkitQueryVersion[];

        // Map each query version ID to its query's name
        for (const queryVersion of allQueryVersions) {
          const queryId = queryVersion.isPartOf;
          const query = allQueries.find(q => q.$id === queryId);
          if (query && query.name) {
            iriMap[queryVersion.$id] = query.name;
          }
        }

        /*
         * And the same for rule set versions. A RuleSetNode names a
         * `ruleSetVersion`, and the canvas looks that IRI up in this map to
         * label the node and its inspector — with only query versions here, an
         * assigned rule set came back as "Unknown" on every reload, while the
         * query node beside it kept its name.
         */
        const allRuleSets = cache.getByType('RuleSet') as LdkitRuleSet[];
        const allRuleSetVersions = cache.getByType('RuleSetVersion') as LdkitRuleSetVersion[];
        for (const ruleSetVersion of allRuleSetVersions) {
          const ruleSet = allRuleSets.find(r => r.$id === ruleSetVersion.isPartOf);
          if (ruleSet && ruleSet.name) {
            iriMap[ruleSetVersion.$id] = ruleSet.name;
          }
        }

        setEntityConcurrencyHeaders(reply, match);
        return reply.send({ ...rich, iriMap });
      } catch {
        setEntityConcurrencyHeaders(reply, match);
        return reply.send(detailed);
      }
    } catch (e__u: unknown) {
      const e = toError(e__u);
      return reply.status(500).send({ error: e.message });
    }
  }));

  // PATCH /query-groups/:id/v/:version — annotate a version; content is a snapshot
  //
  // The group's in-place overwrite went in #191 and the API half in #192: a
  // version is what the graph looked like when it was saved, and every
  // compatibility check that named it stays true. `canvasData` is treated as
  // content rather than annotation deliberately — it rides in the version
  // payload, so allowing it would mean dragging a node while viewing an old
  // version silently rewrites that version.
  fastify.patch('/:id/v/:version', ...typedRoute(patchQueryGroupVersionForGroupSchema, async (request, reply) => {
    try {
      const { id: groupId, version } = request.params;
      const targetVer = parseInt(version, 10);

      // Find the existing version
      const existing = (cache.getByType('QueryGroupVersion') as LdkitQueryGroupVersion[])
        .find(v => v.isPartOf === groupId && Number(v.version) === targetVer);
      if (!existing) return reply.status(404).send({ error: 'Query group version not found' });

      const { annotations, rejection } = classifyVersionPatch(unwrapGroupVersionPatch(request.body), {
        ignore: ['dateModified'],
      });
      if (rejection) return reply.status(rejection.status).send(rejection);

      const { valid, currentTag } = validateIfMatch(request, existing);
      if (!valid) {
        try {
          const { expandGroupVersionDetailed } = await import('../lib/GraphResolver.js');
          const rich = await expandGroupVersionDetailed(existing);
          return reply.status(412).send({
            error: 'Precondition Failed',
            expected: currentTag,
            current: rich,
          });
        } catch {
          return reply.status(412).send({
            error: 'Precondition Failed',
            expected: currentTag,
          });
        }
      }

      const updated = Object.keys(annotations).length > 0
        ? await cache.update<LdkitQueryGroupVersion>(existing.$id, annotations, 'QueryGroupVersion')
        : existing;

      if (!updated) {
        return reply.status(404).send({ error: 'Query group version not found' });
      }

      // Return expanded envelope like GET
      try {
        const { expandGroupVersionDetailed } = await import('../lib/GraphResolver.js');
        const rich = await expandGroupVersionDetailed(updated);
        setEntityConcurrencyHeaders(reply, updated);
        return reply.send(rich);
      } catch {
        const detailed = await expandGroupVersion(updated);
        setEntityConcurrencyHeaders(reply, updated);
        return reply.send(detailed);
      }
    } catch (e__u: unknown) {
      const e = toError(e__u);
      return reply.status(500).send({ error: e.message });
    }
  }));

  // GET /query-groups/:id/v/:version/validate — validate query group version
  fastify.get('/:id/v/:version/validate', ...typedRoute(validateQueryGroupVersionSchema, async (request, reply) => {
    try {
      const { id: groupId, version } = request.params;
      const targetVer = parseInt(version, 10);

      const qgv = (cache.getByType('QueryGroupVersion') as LdkitQueryGroupVersion[])
        .find(v => v.isPartOf === groupId && Number(v.version) === targetVer);
      if (!qgv) return reply.status(404).send({ error: 'Query group version not found' });

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
      const e = toError(e__u);
      return reply.status(500).send({ error: e.message });
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
}
