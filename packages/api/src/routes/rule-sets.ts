import type { FastifyInstance } from 'fastify';
import { mintId } from '../lib/id.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { analyseReferences, describeWrongType } from '../lib/entityReferences.js';
import { analyseTags } from '../lib/tagMembership.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { LdkitRuleSet } from '../persistence/schemas/RuleSetSchema.js';
import type { LdkitRule } from '../persistence/schemas/RuleSchema.js';
import type { LdkitRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import type { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import type { MemoryCacheManager } from '../lib/MemoryCacheManager.js';
import { reposRoute, validateIfMatch, setEntityConcurrencyHeaders, findVersionByNumber } from './route-helpers.js';
import { ruleSetExecutionResponseJsonSchema } from '@sparql-query-lib/contracts/schema/routes';
import { createRuleSetVersion } from '../lib/RuleSetVersionWriter.js';
import { ruleTuplesAllowed, ruleTuplesRefusal, hasSeedText } from '../lib/ruleTuples.js';
import { RuleSetExecutor } from '../lib/RuleSetExecutor.js';
import type { RuleSetExecutionCallbacks } from '../lib/RuleSetExecutor.js';
import { expandRuleSetVersion } from '../lib/RuleSetVersionResolver.js';
import { classifyVersionPatch } from '../lib/versionPatch.js';
import { ImmutableEntityError } from '../lib/immutability.js';
import {
  abbreviateIris,
  compileRule,
  sparqlToRule,
  expandIris,
  extractPrologueText,
  generateRule,
  generateTupleSeeds,
  groundTupleSeedRows,
  mergeRuleSet,
  parseRuleSet,
  parseTupleSeeds,
  reconcileRuleSet,
  stratify,
  splitDataBlocks,
  splitRuleSet,
  canonicalRuleText,
  canonicalDataBlockText,
  checkWellFormed,
  tupleSeedDeclarations,
  type CompileFlavour,
  type SrlDataBlockDocument,
  type SrlRuleDocument,
} from '@sparql-query-lib/srl';
import type { LdkitDataBlock } from '../persistence/schemas/DataBlockSchema.js';
import type { LdkitDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import { createDataBlockVersion } from '../lib/DataBlockVersionWriter.js';
import { createRuleVersion } from '../lib/RuleVersionWriter.js';
import {
  getRuleSetsSchema,
  getRuleSetSchema,
  createRuleSetSchema,
  updateRuleSetSchema,
  deleteRuleSetSchema,
  rulesetversionSchema,
  ruleversionSchema,
  ruleSchema,
  datablockversionSchema,
  datablockSchema,
} from '@sparql-query-lib/contracts/schema';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { filterReadable, requireEntityMode } from '../auth/enforce.js';
import { DATA_GRAPH_FORMATS } from '../lib/dataGraphContent.js';
import { DataGraphContentError, resolveDataGraphInput, type ResolvedDataGraph } from '../lib/dataGraphInput.js';
import { TupleSeedInputError, resolveTupleSeedInput } from '../lib/tupleSeedInput.js';

type AnyRecord = Record<string, unknown>;

const ruleSetVersionResponseSchema = {
  ...rulesetversionSchema,
  properties: {
    ...rulesetversionSchema.properties,
    stratificationReport: { type: 'string', nullable: true },
  },
  additionalProperties: false,
} as const;

const ruleVersionItemSchema = {
  type: 'object',
  properties: {
    ruleVersion: {
      ...ruleversionSchema,
      properties: {
        ...ruleversionSchema.properties,
        grammarValid: { type: 'boolean', nullable: true },
        validationError: { type: 'string', nullable: true },
      },
      additionalProperties: false,
    },
    rule: {
      ...ruleSchema,
      nullable: true,
      additionalProperties: false,
    },
  },
  required: ['ruleVersion'],
  additionalProperties: false,
} as const;

const dataBlockVersionItemSchema = {
  type: 'object',
  properties: {
    dataBlockVersion: {
      ...datablockversionSchema,
      properties: {
        ...datablockversionSchema.properties,
        grammarValid: { type: 'boolean', nullable: true },
        validationError: { type: 'string', nullable: true },
      },
      additionalProperties: false,
    },
    dataBlock: {
      ...datablockSchema,
      nullable: true,
      additionalProperties: false,
    },
  },
  required: ['dataBlockVersion'],
  additionalProperties: false,
} as const;

const expandedRuleSetVersionSchema = {
  type: 'object',
  properties: {
    ruleSetVersion: ruleSetVersionResponseSchema,
    rules: {
      type: 'array',
      items: ruleVersionItemSchema,
    },
    dataBlocks: {
      type: 'array',
      items: dataBlockVersionItemSchema,
    },
  },
  required: ['ruleSetVersion', 'rules', 'dataBlocks'],
  additionalProperties: false,
} as const;

const createRuleSetVersionBodySchema = {
  type: 'object',
  properties: {
    comment: { type: 'string', nullable: true },
    hasRule: { type: 'array', items: { type: 'string' }, nullable: true },
    hasDataBlock: { type: 'array', items: { type: 'string' }, nullable: true },
    immutable: { type: 'boolean', nullable: true },
  },
  additionalProperties: false,
} as const;

const patchRuleSetVersionBodySchema = {
  type: 'object',
  properties: {
    comment: { type: 'string', nullable: true },
    hasRule: { type: 'array', items: { type: 'string' }, nullable: true },
    hasDataBlock: { type: 'array', items: { type: 'string' }, nullable: true },
    immutable: { type: 'boolean', nullable: true },
  },
  minProperties: 1,
  additionalProperties: false,
} as const;

const executeRuleSetBodySchema = {
  type: 'object',
  properties: {
    version: { type: 'integer', nullable: true },
    maxIterations: { type: 'integer', minimum: 1, nullable: true },
    inferenceFormat: {
      type: 'string',
      enum: ['application/n-triples', 'text/turtle', 'application/rdf+xml', 'application/ld+json'],
      nullable: true,
    },
    /*
     * The data graph the rules run against — `G0`, the base graph. Either a
     * saved version (reproducible) or inline RDF (ephemeral, for drafts and
     * the playground), never both. Distinct from the rule set's DATA blocks,
     * which are part of the rule set and come out in the inference graph.
     */
    dataGraphVersionId: { type: 'string', nullable: true },
    /* Floats to the graph's current version; see `lib/dataGraphInput.ts`. */
    dataGraphId: { type: 'string', nullable: true },
    dataGraphInline: { type: 'string', nullable: true },
    /*
     * Rows for this run, overriding the version's stored seeds. Exactly one of
     * the three, and absent means "run the stored seeds" — which is what every
     * run did before this field existed. See `lib/tupleSeedInput.ts`.
     */
    tuples: {
      type: 'object',
      properties: {
        tupleSetVersionId: { type: 'string', nullable: true },
        tupleSetId: { type: 'string', nullable: true },
        inline: { type: 'object', additionalProperties: true, nullable: true },
      },
      additionalProperties: false,
      nullable: true,
    },
    dataGraphInlineFormat: { type: 'string', enum: [...DATA_GRAPH_FORMATS], nullable: true },
  },
  additionalProperties: false,
} as const;

/**
 * Strip the request fields that only mean something with the rule-tuples
 * extension on, for a build that withholds it.
 *
 * The handlers refuse those fields either way (see `lib/ruleTuples.ts`); this
 * keeps `/docs` from advertising a field that can only ever answer 400. Called
 * at route registration, after the flags are resolved, so it reflects the
 * running configuration rather than whatever the module saw at import.
 */
function ruleTupleFields<const T>(schema: T): T {
  if (ruleTuplesAllowed()) return schema;
  /*
   * Unconstrained in T so the schema literal keeps its exact type: the route
   * helper infers each handler's body type from this object, and a constraint
   * as loose as Record<string, unknown> widens `properties` to nothing useful.
   * The returned type still declares the fields; only the runtime schema drops
   * them, which is what /docs reads.
   */
  const { properties, ...rest } = schema as { properties?: Record<string, unknown> };
  if (!properties) return schema;
  const kept = { ...properties };
  delete kept.tuples;
  delete kept.tupleSeeds;
  return { ...rest, properties: kept } as T;
}

const serializedErrorSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    stack: { type: 'string' },
  },
  required: ['message'],
  additionalProperties: false,
} as const;

const dataBlockExecutionSchema = {
  type: 'object',
  properties: {
    dataBlockVersionId: { type: 'string' },
    programSource: { type: 'string', enum: ['normalized', 'raw'] },
    durationMs: { type: 'number' },
    tripleDelta: { type: 'integer' },
    error: { ...serializedErrorSchema, nullable: true },
  },
  required: ['dataBlockVersionId', 'programSource', 'durationMs', 'tripleDelta'],
  additionalProperties: false,
} as const;

const ruleExecutionRecordSchema = {
  type: 'object',
  properties: {
    ruleVersionId: { type: 'string' },
    programSource: { type: 'string', enum: ['normalized', 'raw'] },
    durationMs: { type: 'number' },
    triplesInserted: { type: 'integer' },
    triplesDeleted: { type: 'integer' },
    quadSamples: { type: 'array', items: { type: 'string' } },
    insertedQuads: { type: 'array', items: { type: 'string' } },
    deletedQuads: { type: 'array', items: { type: 'string' } },
    timedOut: { type: 'boolean' },
    error: { ...serializedErrorSchema, nullable: true },
  },
  required: [
    'ruleVersionId',
    'programSource',
    'durationMs',
    'triplesInserted',
    'triplesDeleted',
    'quadSamples',
    'insertedQuads',
    'deletedQuads',
    'timedOut',
  ],
  additionalProperties: false,
} as const;

const iterationRecordSchema = {
  type: 'object',
  properties: {
    index: { type: 'integer' },
    signature: { type: 'string' },
    tripleCount: { type: 'integer' },
    delta: { type: 'integer' },
    rules: { type: 'array', items: ruleExecutionRecordSchema },
  },
  required: ['index', 'signature', 'tripleCount', 'delta', 'rules'],
  additionalProperties: false,
} as const;

// Use the shared schema from contracts instead of duplicating it here
const executeRuleSetResponseSchema = ruleSetExecutionResponseJsonSchema;

export default async function (fastify: FastifyInstance) {
  /*
   * No exempt suffixes, and the absence is the decision.
   *
   * `exemptSuffixes` is for stateless helpers that analyse caller-supplied
   * input and touch no stored entity — `rules.ts`'s `/preview/normalize`, or
   * `tuple-sets.ts`'s `/preview`. This plugin has no such route. What it has
   * is `POST /:id/srl/preview`, which loads a stored rule set, resolves its
   * current version, and reports that version's composition — and which the
   * inherited `'/preview'` entry exempted, because the list matches path
   * *suffixes*. A principal holding nothing on the library was answered 200
   * with every rule version id in the set, its rule id, the number of other
   * rule sets using it and whether it is orphaned, while `GET /:id` and
   * `GET /:id/srl` refused the same caller with 403.
   *
   * So the route is guarded like any other `:id` POST: Write on the owning
   * library. Stricter than `patches.ts`'s preview-needs-`use` split, and
   * deliberately — this preview is the first half of an import into this rule
   * set rather than a diff for a reviewer, so the caller who may run it is the
   * caller who could run the import.
   */
  registerEntityAuthGuard(fastify, { executeSuffixes: ['/execute', '/execute/stream', '/run'], exemptSuffixes: [] });

  /*
   * The collection GET has no `:id` for the guard to resolve, so what a caller
   * may see is the handler's to decide — as it is in `/queries`, `/tuple-sets`
   * and `/tags`, all of which filter. This one did not: it answered every
   * authenticated principal with every rule set in the deployment, names,
   * descriptions and current-version pointers included, whatever they held.
   */
  fastify.get('/', ...reposRoute(getRuleSetsSchema, async ({ repos, reply, request }) => {
    const items = repos.RuleSet.list() as LdkitRuleSet[];
    return reply.send(filterReadable(request, items).map(ruleSet => toRestApi(ruleSet)));
  }));

  // Until Phase B2 this route registered no schema at all: the body was
  // unvalidated and the handler coerced whatever arrived. `name` and `isPartOf`
  // are now required by the document, so the two guards below are reachable only
  // for values the schema admits — a whitespace-only name, and an `isPartOf`
  // that arrives empty. They are kept for exactly that, not as the gate.
  fastify.post('/', ...reposRoute(createRuleSetSchema, async ({ repos, reply, request }) => {
    const body = request.body;
    const cacheCoordinator = getCacheCoordinator();
    const name = String(body.name).trim();
    if (!name) {
      return reply.status(400).send({ error: 'Rule set name is required' });
    }

    // `coerceTypes: 'array'` has already wrapped a bare `isPartOf` string into
    // an array by the time the handler runs.
    const isPartOfArray: string[] = (body.isPartOf ?? []).map((val: unknown) => String(val));
    if (isPartOfArray.length === 0) {
      return reply.status(400).send({ error: 'Rule set must be associated with at least one parent' });
    }

    const parents = analyseReferences('RuleSet', 'isPartOf', isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );

    if (parents.exactlyOneCount !== 1) {
      return reply.status(400).send({ error: 'Rule set must belong to exactly one library' });
    }

    if (parents.wrongType.length > 0) {
      return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
    }

    if (parents.missing.length > 0) {
      return reply.status(400).send({ error: `Referenced entity ${parents.missing[0]} does not exist` });
    }

    const tagCheck = analyseTags('RuleSet', body.tags, isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    const id = mintId('ruleSet');
    const toCreate: Partial<LdkitRuleSet> & { $id: string } = {
      $id: id,
      name,
      description: body.description ?? null,
      isPartOf: isPartOfArray,
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
    };

    const created = await repos.RuleSet.create(toCreate);
    setEntityConcurrencyHeaders(reply, created);
    return reply.status(201).send(toRestApi(created));
  }));

  fastify.get('/:id', ...reposRoute(getRuleSetSchema, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const entity = repos.RuleSet.get(id) as LdkitRuleSet | null;
    if (!entity) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, entity);
    return reply.send(toRestApi(entity));
  }));

  fastify.put('/:id', ...reposRoute(updateRuleSetSchema, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const updates = request.body;
    const cacheCoordinator = getCacheCoordinator();

    const current = repos.RuleSet.get(id) as LdkitRuleSet | null;
    if (!current) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    const { valid, currentTag } = validateIfMatch(request, current);
    if (!valid) {
      return reply.status(412).send({
        error: 'Precondition Failed',
        expected: currentTag,
        current: toRestApi(current),
      });
    }

    let ids: string[] | undefined;
    if (updates.isPartOf) {
      ids = Array.isArray(updates.isPartOf)
        ? updates.isPartOf.map(val => String(val))
        : [String(updates.isPartOf)];
      const parents = analyseReferences('RuleSet', 'isPartOf', ids, iri => cacheCoordinator.get(iri));
      if (parents.exactlyOneCount !== 1) {
        return reply.status(400).send({ error: 'Rule set must belong to exactly one library' });
      }
      if (parents.wrongType.length > 0) {
        return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
      }
    }

    const tagCheck = analyseTags('RuleSet', updates.tags, ids ?? current.isPartOf, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    const updated = await repos.RuleSet.update(id, {
      ...updates,
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
    } as Partial<LdkitRuleSet>);
    if (!updated) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(toRestApi(updated));
  }));

  fastify.delete('/:id', ...reposRoute(deleteRuleSetSchema, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const current = repos.RuleSet.get(id);
    if (!current) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    // Delete all ruleset versions first
    const versions = (repos.RuleSetVersion.list() as LdkitRuleSetVersion[]).filter(v => v.isPartOf === id);
    for (const version of versions) {
      await repos.RuleSetVersion.delete(version.$id);
    }

    // Then delete the ruleset itself
    await repos.RuleSet.delete(id);
    return reply.status(204).send();
  }));

  fastify.get('/:id/versions', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'List rule set versions',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'array',
          items: ruleSetVersionResponseSchema,
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.RuleSet.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Rule set not found' });
    }
    const versions = (repos.RuleSetVersion.list() as LdkitRuleSetVersion[])
      .filter(v => v.isPartOf === id)
      .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    return reply.send(versions.map(v => toRestApi(v)));
  }));

  fastify.post('/:id/versions', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Create rule set version',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: createRuleSetVersionBodySchema,
      response: {
        201: expandedRuleSetVersionSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.RuleSet.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Rule set not found' });
    }

    const body = request.body;
    
    try {
      const created = await createRuleSetVersion(id, {
        comment: body.comment ?? null,
        hasRule: body.hasRule ?? [],
        hasDataBlock: body.hasDataBlock ?? [],
        immutable: body.immutable ?? undefined,
      });
      const expanded = await expandRuleSetVersion(created);
      setEntityConcurrencyHeaders(reply, created);
      return reply.status(201).send(expanded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }));

  fastify.get('/:id/versions/:version', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Get rule set version',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['id', 'version'],
      },
      response: {
        200: expandedRuleSetVersionSchema,
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const parent = repos.RuleSet.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Rule set not found' });
    }

    const lookup = findVersionByNumber(
      repos.RuleSetVersion.list() as LdkitRuleSetVersion[],
      id,
      version,
      'rule set',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;
    const expanded = await expandRuleSetVersion(match);
    setEntityConcurrencyHeaders(reply, match);
    return reply.send(expanded);
  }));

  fastify.patch('/:id/versions/:version', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Annotate a rule set version (comment only; content is immutable)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['id', 'version'],
      },
      body: patchRuleSetVersionBodySchema,
      response: {
        200: expandedRuleSetVersionSchema,
        400: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id: ruleSetId, version } = request.params;

    const lookup = findVersionByNumber(
      repos.RuleSetVersion.list() as LdkitRuleSetVersion[],
      ruleSetId,
      version,
      'rule set',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const existing = lookup.version;
    /*
     * The sibling GET and DELETE fetch the rule set first and 404 on a miss,
     * which is what makes the plugin guard's abstain safe for them; this one
     * matches on `isPartOf` alone, so it checks the version it is about to
     * write instead. A live version resolves through its rule set to the same
     * library the guard resolved; one whose rule set is gone resolves to
     * nothing, which `requireLibraryMode(null, …)` refuses.
     */
    requireEntityMode(request, existing, 'write');

    // A version is a snapshot (issue #192): `hasRule` and `hasDataBlock` are
    // what the set was composed of when it was saved, so the stratification
    // report computed from them stays true. Only the comment is writable.
    const { annotations, rejection } = classifyVersionPatch(request.body as AnyRecord, {
      ignore: ['dateModified'],
    });
    if (rejection) return reply.status(rejection.status).send(rejection);

    const { valid, currentTag } = validateIfMatch(request, existing);
    if (!valid) {
      const expanded = await expandRuleSetVersion(existing);
      return reply.status(412).send({
        error: 'Precondition Failed',
        expected: currentTag,
        current: expanded,
      });
    }

    if (Object.keys(annotations).length === 0) {
      const unchanged = await expandRuleSetVersion(existing);
      setEntityConcurrencyHeaders(reply, existing);
      return reply.send(unchanged);
    }

    let updated: LdkitRuleSetVersion | null = null;
    try {
      updated = await repos.RuleSetVersion.update(existing.$id, annotations as Partial<LdkitRuleSetVersion>);
    } catch (error) {
      if (error instanceof ImmutableEntityError) {
        return reply.status(409).send({ error: error.message });
      }
      throw error;
    }
    if (!updated) {
      return reply.status(404).send({ error: 'Rule set version not found' });
    }

    const expanded = await expandRuleSetVersion(updated as LdkitRuleSetVersion);
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(expanded);
  }));

  fastify.delete('/:id/versions/:version', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Delete rule set version',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['id', 'version'],
      },
      response: {
        204: {
          type: 'null',
          description: 'Rule set version deleted successfully',
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const parent = repos.RuleSet.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Rule set not found' });
    }

    const lookup = findVersionByNumber(
      repos.RuleSetVersion.list() as LdkitRuleSetVersion[],
      id,
      version,
      'rule set',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;

    await repos.RuleSetVersion.delete(match.$id);
    return reply.status(204).send();
  }));

  fastify.post('/:id/execute', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Execute rule set',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: ruleTupleFields(executeRuleSetBodySchema),
      response: {
        200: executeRuleSetResponseSchema,
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.RuleSet.get(id) as LdkitRuleSet | null;
    if (!parent) {
      return reply.status(404).send({ error: 'Rule set not found' });
    }

    const body = request.body ?? {};
    const requestedVersion = typeof body.version === 'number' ? body.version : undefined;
    const maxIterations = typeof body.maxIterations === 'number' && body.maxIterations > 0
      ? body.maxIterations
      : undefined;
    const inferenceFormat = typeof body.inferenceFormat === 'string'
      ? body.inferenceFormat
      : 'application/n-triples';

    const resolution = resolveRuleSetVersionForExecution(repos, id, parent, requestedVersion);
    if (!resolution.ok) {
      return reply.status(resolution.status).send({ error: resolution.message });
    }

    const tupleRefusal = ruleTuplesRefusal(body.tuples != null);
    if (tupleRefusal) {
      return reply.status(400).send({ error: tupleRefusal });
    }

    let dataGraph: ResolvedDataGraph | null = null;
    let tupleSeeds: string | null = null;
    try {
      // `{ request }` because the guard above checked the *rule set's* library
      // and `dataGraphVersionId` names a graph that need not live in it: the
      // second entity this body names, and the caller is reading its triples.
      dataGraph = resolveDataGraphInput(body, { request });
      tupleSeeds = resolveTupleSeedInput(body.tuples);
    } catch (error) {
      if (error instanceof DataGraphContentError || error instanceof TupleSeedInputError) {
        return reply.status(400).send({ error: error.message });
      }
      throw error;
    }

    const executionOptions = {
      maxIterations,
      inferenceFormat,
      initialGraph: dataGraph?.content ?? null,
      initialGraphFormat: dataGraph?.format ?? null,
      tupleSeeds,
    };
    const executor = new RuleSetExecutor();
    const result = await executor.execute(resolution.version, executionOptions);

    return reply.send(result);
  }));

  fastify.post('/:id/execute/stream', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Execute rule set with streaming updates',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: ruleTupleFields(executeRuleSetBodySchema),
      response: {
        200: { type: 'null', description: 'SSE stream' },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.RuleSet.get(id) as LdkitRuleSet | null;
    if (!parent) {
      return reply.status(404).send({ error: 'Rule set not found' });
    }

    const body = request.body ?? {};
    const requestedVersion = typeof body.version === 'number' ? body.version : undefined;
    const maxIterations = typeof body.maxIterations === 'number' && body.maxIterations > 0
      ? body.maxIterations
      : undefined;

    const inferenceFormat = typeof body.inferenceFormat === 'string'
      ? body.inferenceFormat
      : 'application/n-triples';

    const resolution = resolveRuleSetVersionForExecution(repos, id, parent, requestedVersion);
    if (!resolution.ok) {
      return reply.status(resolution.status).send({ error: resolution.message });
    }

    const tupleRefusal = ruleTuplesRefusal(body.tuples != null);
    if (tupleRefusal) {
      return reply.status(400).send({ error: tupleRefusal });
    }

    let dataGraph: ResolvedDataGraph | null = null;
    let tupleSeeds: string | null = null;
    try {
      // `{ request }` because the guard above checked the *rule set's* library
      // and `dataGraphVersionId` names a graph that need not live in it: the
      // second entity this body names, and the caller is reading its triples.
      dataGraph = resolveDataGraphInput(body, { request });
      tupleSeeds = resolveTupleSeedInput(body.tuples);
    } catch (error) {
      if (error instanceof DataGraphContentError || error instanceof TupleSeedInputError) {
        return reply.status(400).send({ error: error.message });
      }
      throw error;
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.hijack();

    const flush = (reply.raw as unknown as { flush?: () => void }).flush?.bind(reply.raw) as (() => void) | undefined;
    let clientAborted = false;
    let streamEnded = false;

    const endStream = () => {
      if (streamEnded || clientAborted) {
        return;
      }
      streamEnded = true;
      reply.raw.end();
    };

    const sendEvent = (event: string, data: unknown) => {
      if (clientAborted) return;
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      flush?.();
    };

    request.raw.on('close', () => {
      clientAborted = true;
    });

    const executor = new RuleSetExecutor();
    const callbacks: RuleSetExecutionCallbacks = {
      onExecutionStart: (payload: { ruleSetVersionId: string; totalRules: number; totalDataBlocks: number }) => {
        sendEvent('execution-start', payload);
      },
      onDataBlockComplete: (payload) => {
        sendEvent('data-block-complete', payload);
      },
      onIterationStart: (payload) => {
        sendEvent('iteration-start', payload);
      },
      onRuleResult: (payload) => {
        sendEvent('rule-result', payload);
      },
      onIterationComplete: (payload) => {
        sendEvent('iteration-complete', payload);
      },
      onExecutionComplete: (payload) => {
        sendEvent('execution-complete', payload);
        endStream();
      },
      onExecutionError: (payload: { message: string; status: string }) => {
        sendEvent('execution-error', payload);
        endStream();
      },
    };

    await executor.execute(resolution.version, {
      maxIterations,
      inferenceFormat,
      initialGraph: dataGraph?.content ?? null,
      initialGraphFormat: dataGraph?.format ?? null,
      tupleSeeds,
      callbacks,
      shouldAbort: () => clientAborted,
    });
  }));

  // ---------------------------------------------------------------------------
  // Ruleset-as-text (SRL document) authoring
  //
  // A .srl document *is* a ruleset (prologue + N rules), so we support authoring
  // either way: per-rule (existing CRUD, enables reuse across rulesets) or as one
  // document that is transpiled into N RuleVersions + one RuleSetVersion.
  //
  // Rules are stored canonically with **expanded IRIs** and no prologue; the
  // prologue is presentation supplied per request. That makes a prefix-only edit
  // provably not a content change, so re-import does not churn versions.
  // ---------------------------------------------------------------------------

  fastify.get('/:id/srl', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Export a rule set as a single SRL document',
      params: {
        type: 'object',
        properties: { id: { type: 'string' }, version: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          version: { type: 'string' },
          prologue: { type: 'string', description: 'PREFIX/BASE lines to emit (presentation only)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            srl: { type: 'string' },
            ruleCount: { type: 'number' },
            dataBlockCount: { type: 'number' },
            tupleSeeds: { type: 'string' },
            tuplesEnabled: { type: 'boolean' },
            warnings: { type: 'array', items: { type: 'string' } },
          },
          required: ['srl', 'ruleCount', 'dataBlockCount', 'tupleSeeds', 'tuplesEnabled', 'warnings'],
        },
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const query = request.query ?? {};
    const parent = repos.RuleSet.get(id) as LdkitRuleSet | undefined;
    if (!parent) {
      return reply.status(404).send({ error: 'Rule set not found' });
    }
    const resolution = resolveRuleSetVersionForExecution(repos, id, parent, parseVersionParam(query.version));
    if (!resolution.ok) {
      return reply.status(resolution.status).send({ error: resolution.message });
    }

    const ruleVersions = loadRuleVersions(repos, resolution.version);
    const dataBlockVersions = loadDataBlockVersions(repos, resolution.version);
    const warnings: string[] = [];
    const dataDocs: Array<{ text: string }> = [];
    for (const dbv of dataBlockVersions) {
      const text = toDataBlockText(dbv.dataString);
      if (text) dataDocs.push({ text });
      // Never fabricate SRL for content that is not ground triples — say what
      // was left out instead, or the round-trip silently rewrites the ruleset.
      else warnings.push(`Data block ${dbv.$id} is not expressible as an SRL DATA block and was omitted from the document.`);
    }

    const srl = mergeRuleSet(
      ruleVersions.map((rv) => ({ text: rv.ruleString ?? '' })),
      query.prologue ?? '',
      dataDocs,
    );
    return reply.send({
      srl,
      ruleCount: ruleVersions.length,
      dataBlockCount: dataDocs.length,
      // Seeds are stored expanded; abbreviate them back against the same
      // prologue the document uses, so box 2 reads like box 1.
      /*
       * With the extension withheld the response says it is off rather than
       * echoing what an older version stored: a client told `tuplesEnabled` is
       * true would draw a toggle this build does not honour.
       */
      tupleSeeds: ruleTuplesAllowed()
        ? abbreviateIris(resolution.version.tupleSeeds ?? '', query.prologue ?? '')
        : '',
      tuplesEnabled: ruleTuplesAllowed() && resolution.version.tuplesEnabled === true,
      warnings,
    });
  }));

  fastify.post('/:id/srl/preview', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Preview importing an SRL document (no writes)',
      description:
        'Reports which rules would be created, updated, or detached. Detach never deletes: a rule '
        + 'absent from the document is removed from this rule set only, and is flagged as orphaned '
        + 'when no other rule set references it.',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: ruleTupleFields({
        type: 'object',
        properties: {
          srl: { type: 'string' },
          version: { type: 'string' },
          tuples: { type: 'boolean' },
          tupleSeeds: { type: 'string', nullable: true },
        },
        required: ['srl'],
      }),
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const body = request.body ?? {};
    /*
     * The deployment gate, above the document's own toggle: a request may not
     * turn the extension on, or send seed rows for it, unless this build
     * offers it. Checked before the rule set is looked up, because a field
     * this build does not offer is refused whether or not the rule set exists.
     * See lib/ruleTuples.ts.
     */
    const tupleRefusal = ruleTuplesRefusal(body.tuples === true || hasSeedText(body.tupleSeeds));
    if (tupleRefusal) {
      return reply.status(400).send({ error: tupleRefusal });
    }

    const parent = repos.RuleSet.get(id) as LdkitRuleSet | undefined;
    if (!parent) {
      return reply.status(404).send({ error: 'Rule set not found' });
    }
    const resolution = resolveRuleSetVersionForExecution(repos, id, parent, parseVersionParam(body.version));
    if (!resolution.ok) {
      return reply.status(resolution.status).send({ error: resolution.message });
    }

    const tuples = body.tuples === true;
    let docs: SrlRuleDocument[];
    let dataDocs: SrlDataBlockDocument[];
    let warnings: string[];
    let seeds: ReturnType<typeof describeTupleSeeds>;
    try {
      ({ docs, dataDocs, warnings } = parseSrlDocument(body.srl ?? '', tuples));
      seeds = describeTupleSeeds(body.tupleSeeds, body.srl ?? '', tuples);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid SRL document' });
    }

    const existing = loadRuleVersions(repos, resolution.version).map((rv) => ({
      ruleVersion: rv,
      ...canonicalizeStoredRule(rv),
    }));

    const result = reconcileRuleSet(docs, existing, (e) => e.identity, (e) => e.text);
    const detached = result.detached.map((e) => describeDetached(repos, e.ruleVersion, id));

    const existingData = loadDataBlockVersions(repos, resolution.version).map((dbv) => ({
      dataBlockVersion: dbv,
      ...canonicalizeStoredDataBlock(dbv),
    }));
    const dataResult = reconcileRuleSet<typeof existingData[number], SrlDataBlockDocument>(
      dataDocs,
      existingData,
      (e) => e.identity,
      (e) => e.text,
    );

    return reply.send({
      warnings,
      created: result.created.map((d) => ({ label: d.suggestedLabel, named: d.named, text: d.text })),
      updated: result.updated.map((u) => ({
        ruleVersionId: u.existing.ruleVersion.$id,
        changed: u.changed,
        text: u.doc.text,
      })),
      detached,
      unchangedCount: result.updated.filter((u) => !u.changed).length,
      data: {
        created: dataResult.created.map((d) => ({ label: d.suggestedLabel, text: d.text })),
        unchangedCount: dataResult.updated.filter((u) => !u.changed).length,
        detached: dataResult.detached.map((e) => describeDetachedDataBlock(repos, e.dataBlockVersion, id)),
      },
      tupleSeeds: seeds,
    });
  }));

  fastify.post('/:id/srl', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Import an SRL document, creating a new rule set version',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: ruleTupleFields({
        type: 'object',
        properties: {
          srl: { type: 'string' },
          version: { type: 'string' },
          comment: { type: 'string', nullable: true },
          tuples: { type: 'boolean' },
          tupleSeeds: { type: 'string', nullable: true },
        },
        required: ['srl'],
      }),
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const body = request.body ?? {};
    /*
     * The deployment gate, above the document's own toggle: a request may not
     * turn the extension on, or send seed rows for it, unless this build
     * offers it. Checked before the rule set is looked up, because a field
     * this build does not offer is refused whether or not the rule set exists.
     * See lib/ruleTuples.ts.
     */
    const tupleRefusal = ruleTuplesRefusal(body.tuples === true || hasSeedText(body.tupleSeeds));
    if (tupleRefusal) {
      return reply.status(400).send({ error: tupleRefusal });
    }

    const parent = repos.RuleSet.get(id) as LdkitRuleSet | undefined;
    if (!parent) {
      return reply.status(404).send({ error: 'Rule set not found' });
    }
    const resolution = resolveRuleSetVersionForExecution(repos, id, parent, parseVersionParam(body.version));

    const tuples = body.tuples === true;
    let docs: SrlRuleDocument[];
    let dataDocs: SrlDataBlockDocument[];
    let seedDocument: string;
    try {
      ({ docs, dataDocs } = parseSrlDocument(body.srl ?? '', tuples));
      // A seed document that does not parse must fail the import rather than be
      // stored and blow up later, at execution, where the author is no longer
      // looking. Stored canonically (expanded IRIs, no prologue) for the same
      // reason rules are: nothing stores the prologue beside it, so a prefixed
      // seed would reach execution unexpanded and match no rule's tuple read.
      seedDocument = tuples ? canonicalTupleSeeds(body.tupleSeeds, body.srl ?? '') : '';
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid SRL document' });
    }

    const existing = resolution.ok
      ? loadRuleVersions(repos, resolution.version).map((rv) => ({
        ruleVersion: rv,
        ...canonicalizeStoredRule(rv),
      }))
      : [];

    const result = reconcileRuleSet(docs, existing, (e) => e.identity, (e) => e.text);

    // Reuse an unchanged rule's existing version; mint a version for new or
    // edited rules. Detached rules are simply omitted from hasRule.
    const hasRule: string[] = [];
    const created: string[] = [];
    const updated: string[] = [];

    for (const doc of docs) {
      const match = result.updated.find((u) => u.doc.identity === doc.identity);
      if (match && !match.changed) {
        hasRule.push(match.existing.ruleVersion.$id);
        continue;
      }
      if (match && match.changed) {
        const version = await createRuleVersion(match.existing.ruleVersion.isPartOf, { ruleString: doc.text });
        hasRule.push(version.$id);
        updated.push(version.$id);
        continue;
      }
      const ruleId = await createRuleForImport(repos, doc, parent);
      const version = await createRuleVersion(ruleId, { ruleString: doc.text });
      hasRule.push(version.$id);
      created.push(version.$id);
    }

    // Data blocks reconcile the same way, keyed on content hash. Doing this is
    // what stops the document losing its DATA on a save/export round trip: the
    // previous version's blocks used to be carried forward wholesale, so a
    // block deleted in the editor came back and a new one was dropped.
    const existingData = resolution.ok
      ? loadDataBlockVersions(repos, resolution.version).map((dbv) => ({
        dataBlockVersion: dbv,
        ...canonicalizeStoredDataBlock(dbv),
      }))
      : [];

    const dataResult = reconcileRuleSet<typeof existingData[number], SrlDataBlockDocument>(
      dataDocs,
      existingData,
      (e) => e.identity,
      (e) => e.text,
    );

    const hasDataBlock: string[] = [];
    const dataCreated: string[] = [];
    for (const doc of dataDocs) {
      const match = dataResult.updated.find((u) => u.doc.identity === doc.identity);
      // Identity *is* the content hash, so a match is always unchanged — there
      // is no "edited data block", only a different one.
      if (match) {
        hasDataBlock.push(match.existing.dataBlockVersion.$id);
        continue;
      }
      const dataBlockId = await createDataBlockForImport(repos, doc, parent);
      const version = await createDataBlockVersion(dataBlockId, { dataString: doc.text });
      hasDataBlock.push(version.$id);
      dataCreated.push(version.$id);
    }

    const newVersion = await createRuleSetVersion(id, {
      comment: body.comment ?? 'Imported from SRL document',
      hasRule,
      hasDataBlock,
      tupleSeeds: seedDocument,
      tuplesEnabled: tuples,
    });

    return reply.send({
      ruleSetVersionId: newVersion.$id,
      version: newVersion.version,
      created,
      updated,
      detached: result.detached.map((e) => e.ruleVersion.$id),
      ruleCount: hasRule.length,
      dataCreated,
      dataDetached: dataResult.detached.map((e) => e.dataBlockVersion.$id),
      dataBlockCount: hasDataBlock.length,
      tuplesEnabled: tuples,
    });
  }));

  /*
   * Not scoped to a rule set: compiling reads nothing but the text posted to
   * it, and an unsaved draft has no id to scope to. It was `/:id/srl/compile`
   * for a day, out of misplaced symmetry with the routes around it.
   */
  fastify.post('/srl/compile', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Compile each rule of an SRL document to equivalent SPARQL',
      description:
        'Returns one SPARQL program per rule: an INSERT ... WHERE for an ordinary rule, or a '
        + 'SELECT whose rows the executor captures as tuples for a tuple-producing one. A rule '
        + 'that *reads* tuples renders each read as a reserved all-UNDEF VALUES row — a parameter '
        + 'slot the executor fills from the tuple store — and is only equivalent once those rows '
        + 'are substituted, so it carries an explicit caveat. '
        + 'Pass flavour=construct for the non-destructive reading: the same head and body as a '
        + 'CONSTRUCT ... WHERE, which returns the triples one pass of the rule would add instead '
        + 'of writing them. Nothing is stored under either flavour — both are computed from the '
        + 'posted document — and a tuple-producing rule has no CONSTRUCT form, so it comes back '
        + 'as the same SELECT with a caveat saying so.',
      body: ruleTupleFields({
        type: 'object',
        properties: {
          srl: { type: 'string' },
          tuples: { type: 'boolean' },
          flavour: { type: 'string', enum: ['insert', 'construct'], default: 'insert' },
        },
        required: ['srl'],
      }),
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ reply, request }) => {
    const body = request.body ?? {};

    const text = (body.srl ?? '').trim();
    if (!text) {
      return reply.status(400).send({ error: 'An SRL document is required' });
    }
    const flavour: CompileFlavour = body.flavour === 'construct' ? 'construct' : 'insert';

    try {
      // Deliberately NOT expanded: the compiled SPARQL carries the document's
      // own prologue, so a reader sees the prefixes they wrote rather than a
      // wall of full IRIs. Identity is not at stake here — nothing is stored.
      const ruleSet = parseRuleSet(text, { tuples: body.tuples === true && ruleTuplesAllowed() });
      const rules = ruleSet.rules.map((rule, index) => {
        const compiled = compileRule(rule, ruleSet.prologueText, { flavour });
        const caveats: string[] = [];
        if (compiled.tupleReads.length > 0) {
          caveats.push(
            'This rule reads tuples. Each VALUES block under a # TUPLE( … ) comment is a slot that '
            + 'the executor fills with the matching rows from the ephemeral tuple store. Run as-is, '
            + 'the reserved row binds the variable positions to nothing, so the tuple premises are '
            + 'effectively absent: the program is only equivalent once the rows are substituted.',
          );
          caveats.push(
            'A slot has one column per tuple position, so it states the read\'s arity, and its '
            + 'constants are pinned into the row — which is exactly what the store matches on, so '
            + 'the slot says which rows it wants rather than pointing at a table elsewhere. A '
            + 'position holding a constant, or repeating a variable already declared, has no name '
            + 'of its own and gets a generated one (?_readN_slotM) that nothing else in the program '
            + 'mentions; a repeated position also emits a sameTerm filter, since VALUES cannot '
            + 'declare one column twice.',
          );
        }
        if (compiled.producesTuples) {
          caveats.push(
            'This rule writes tuples, so it compiles to a SELECT whose rows the executor captures '
            + 'into the tuple store rather than an INSERT against the graph. That SELECT is already '
            + 'the non-destructive form: it writes nothing to the graph, and its rows land in an '
            + 'ephemeral store that has no SPARQL surface — so there is no CONSTRUCT preview for it '
            + 'to have, and the same program is what you get under either flavour.',
          );
        }
        return {
          index,
          name: rule.name ?? null,
          label: rule.name ? rule.name.split(/[/#:]/).pop() : `rule-${index + 1}`,
          srl: generateRule(rule),
          sparql: compiled.program,
          producesTuples: compiled.producesTuples,
          tupleReads: compiled.tupleReads.length,
          caveats,
        };
      });

      // A DATA block's non-destructive reading is `CONSTRUCT { … } WHERE {}` —
      // the empty body yields one solution, so the template comes back once,
      // which is what the block contributes to a pass. `INSERT DATA` has no
      // WHERE clause to reuse, so this is built rather than rewritten too.
      const dataBlocks = ruleSet.dataBlocks.map((block, index) => ({
        index,
        label: `data-${index + 1}`,
        srl: canonicalDataBlockText(block),
        sparql: `${ruleSet.prologueText ? `${ruleSet.prologueText}\n` : ''}${
          flavour === 'construct'
            ? `CONSTRUCT { ${block.dataText} } WHERE {}`
            : `INSERT DATA { ${block.dataText} }`
        }`,
      }));

      // Echoed so a client that debounces its requests can tell which flavour a
      // late response belongs to, rather than assuming it is the current one.
      return reply.send({ rules, dataBlocks, flavour });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid SRL document' });
    }
  }));

  /*
   * What the editor needs to draw a document: is it valid, which lines each
   * block occupies, and which stratum each rule lands in.
   *
   * Not scoped to a rule set, and not a 400 on a syntax error. This runs on
   * every pause in typing, and a half-written document is the normal case, not
   * a failed request — `valid: false` with the parser's message is a state the
   * editor renders, where a 4xx would be an error it reports. Genuine failures
   * (a missing body) still 4xx.
   */
  fastify.post('/srl/analyze', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Analyze an SRL document: block spans, stratification, well-formedness',
      description:
        'Parses a document that need not be stored anywhere and reports what an editor has to '
        + 'show while it is being written: the line range and label of every rule and DATA block, '
        + 'the stratum and monotonicity of every rule, the dependency edges between them, and any '
        + 'well-formedness issues. A syntax error is reported as `valid: false`, not as a 400.',
      body: ruleTupleFields({
        type: 'object',
        properties: { srl: { type: 'string' }, tuples: { type: 'boolean' } },
        required: ['srl'],
      }),
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ reply, request }) => {
    const body = request.body ?? {};
    if (typeof body.srl !== 'string') {
      return reply.status(400).send({ error: 'An SRL document is required' });
    }

    const analyzeRefusal = ruleTuplesRefusal(body.tuples === true);
    if (analyzeRefusal) {
      return reply.status(400).send({ error: analyzeRefusal });
    }
    return reply.send(analyzeSrlDocument(body.srl, body.tuples === true));
  }));

  /**
   * Turn a CONSTRUCT or INSERT … WHERE query into a rule, ready to append to a
   * document.
   *
   * The inverse of `/srl/compile` in both its flavours, and the same convention
   * as `/srl/analyze`: a query that cannot become a rule is a 200 carrying the
   * reasons, not a 4xx. Pasting a SELECT, or a CONSTRUCT with an OPTIONAL in
   * it, is a normal thing for the import dialog to render — the request itself
   * succeeded. Only a missing body is a 400.
   *
   * Nothing is stored. The rule comes back as text for the editor to insert,
   * spelled with the target document's prefixes.
   */
  fastify.post('/srl/from-sparql', ...reposRoute({
      tags: ['RuleSet'],
      summary: 'Convert a CONSTRUCT or INSERT … WHERE query into an SRL rule',
      description:
        'Maps a CONSTRUCT template — or the INSERT template of an INSERT … WHERE — to a rule head, '
        + 'and the WHERE clause to a rule body. FILTER NOT EXISTS becomes NOT, a conjunctive group is '
        + 'flattened, and BIND(e AS ?v) FILTER(BOUND(?v)) becomes SET (?v := e) — the exact inverse of '
        + 'what a SET compiles to. A bare BIND and a MINUS over shared variables are converted with a '
        + 'warning; OPTIONAL, UNION, VALUES, GRAPH, SERVICE, sub-SELECT, a disjoint MINUS, FROM and '
        + 'the solution modifiers are rejected, all of them at once. An update is readable only as a '
        + 'single INSERT … WHERE: a DELETE clause, WITH, USING, a GRAPH block in the template, and a '
        + 'sequence of operations are all rejected. Terms are expanded against the query prologue and '
        + 're-abbreviated against targetPrologue, so the target document wins any prefix conflict. '
        + 'The form the rule was read from is echoed as `form`. Nothing is stored.',
      body: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          /** The prologue of the document being imported into. */
          targetPrologue: { type: 'string' },
          /** Optional `RULE <iri>` name. */
          name: { type: 'string' },
        },
        required: ['query'],
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      },
    }, async ({ reply, request }) => {
    const body = request.body ?? {};
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return reply.status(400).send({ error: 'A CONSTRUCT or INSERT … WHERE query is required' });
    }

    return reply.send(sparqlToRule(query, {
      targetPrologue: typeof body.targetPrologue === 'string' ? body.targetPrologue : '',
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
    }));
  }));

}

// ---------------------------------------------------------------------------
// SRL document analysis (the editor's view of a document)
// ---------------------------------------------------------------------------

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

export interface SrlDocumentBlock {
  kind: 'rule' | 'data';
  /** Index within its own kind, 0-based. */
  index: number;
  /** Stable within one analysis, and the key stratification is reported under. */
  id: string;
  /** What the block asserts, as the author spelled it. */
  label: string;
  /** The `RULE <iri>` name, when there is one. */
  name: string | null;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  stratum: number | null;
  monotonicity: 'monotone' | 'negation' | null;
  /**
   * The spec's `SL.once`: a rule the evaluator runs exactly once rather than to
   * fixpoint, because re-firing it yields a fresh answer every pass. Null for a
   * DATA block.
   */
  runOnce: boolean | null;
  /** Ground triples in a DATA block; null for a rule. */
  triples: number | null;
}

export function analyzeSrlDocument(srl: string, tuples: boolean) {
  const empty = {
    valid: true,
    error: null as string | null,
    ruleCount: 0,
    dataBlockCount: 0,
    blocks: [] as SrlDocumentBlock[],
    stratification: {
      strata: {} as Record<string, number>,
      monotonicity: {} as Record<string, string>,
      runOnce: {} as Record<string, boolean>,
      edges: [] as unknown[],
      issues: [] as string[],
      strataCount: 0,
      negationCount: 0,
      runOnceCount: 0,
      stratified: true,
    },
    wellFormedness: [] as unknown[],
  };

  if (!srl.trim()) return empty;

  let ruleSet: ReturnType<typeof parseRuleSet>;
  try {
    ruleSet = parseRuleSet(srl, { tuples });
  } catch (error) {
    return {
      ...empty,
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid SRL document',
    };
  }

  const lineAt = lineIndexer(srl);
  // Labels are read before expansion, so a rule is described in the prefixes
  // its author wrote rather than as a wall of full IRIs; stratification is run
  // after it, because identity there has to compare expanded IRIs.
  const names = ruleSet.rules.map((rule) => rule.name ?? null);
  const labels = ruleSet.rules.map((rule, index) => headLabel(rule, index));
  const wellFormedness = checkWellFormed(ruleSet);

  expandIris(ruleSet);
  const ruleIds = ruleSet.rules.map((_, index) => `rule-${index + 1}`);
  const report = stratify(ruleSet.rules.map((ast, index) => ({ id: ruleIds[index], ast })));

  const blocks: SrlDocumentBlock[] = [
    ...ruleSet.dataBlocks.map((block, index) => ({
      kind: 'data' as const,
      index,
      id: `data-${index + 1}`,
      label: 'DATA block',
      name: null,
      startLine: lineAt(block.span[0]),
      endLine: lineAt(block.span[1] - 1),
      stratum: null,
      monotonicity: null,
      runOnce: null,
      triples: countTriples(block.triples),
    })),
    ...ruleSet.rules.map((rule, index) => ({
      kind: 'rule' as const,
      index,
      id: ruleIds[index],
      label: labels[index],
      name: names[index],
      startLine: lineAt(rule.span[0]),
      endLine: lineAt(rule.span[1] - 1),
      stratum: report.strata[ruleIds[index]] ?? null,
      monotonicity: report.monotonicity[ruleIds[index]] ?? null,
      runOnce: report.runOnce[ruleIds[index]] ?? false,
      triples: null,
    })),
  ].sort((a, b) => a.startLine - b.startLine);

  const strataValues = Object.values(report.strata);
  return {
    valid: true,
    error: null,
    ruleCount: ruleSet.rules.length,
    dataBlockCount: ruleSet.dataBlocks.length,
    blocks,
    stratification: {
      strata: report.strata,
      monotonicity: report.monotonicity,
      runOnce: report.runOnce,
      edges: report.edges,
      issues: report.issues,
      strataCount: new Set(strataValues).size,
      negationCount: Object.values(report.monotonicity).filter((kind) => kind === 'negation').length,
      runOnceCount: Object.values(report.runOnce).filter(Boolean).length,
      // Stratification only fails on a cycle through negation, which the
      // stratifier reports as an issue rather than by refusing to produce strata.
      stratified: report.issues.length === 0,
    },
    wellFormedness,
  };
}

/** 1-based line number of an offset, without rescanning the document each time. */
function lineIndexer(text: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

/**
 * A rule's one-line description: the predicate it asserts.
 *
 * A rule set is read by what its rules produce, so the head predicate is the
 * name a reader already uses for a rule ("the friendOfFriend rule"). An
 * author-supplied `RULE <iri>` name wins where there is one, since that is
 * someone deliberately naming the thing.
 */
function headLabel(rule: { name?: string; head: unknown; headTuples: unknown[]; headText: string }, index: number): string {
  if (rule.name) return rule.name;
  const first = triplesOf(rule.head)[0] as { predicate?: AnyRecord } | undefined;
  const predicate = first?.predicate;
  if (predicate && typeof predicate === 'object') {
    const value = String((predicate as AnyRecord).value ?? '');
    const prefix = (predicate as AnyRecord).prefix;
    if (typeof prefix === 'string') return `${prefix}:${value}`;
    if (value === RDF_TYPE) return 'a';
    if (value) return value;
  }
  if (rule.headTuples.length > 0) return 'TUPLE';
  return `rule-${index + 1}`;
}

function triplesOf(bgp: unknown): unknown[] {
  const triples = (bgp as { triples?: unknown } | undefined)?.triples;
  return Array.isArray(triples) ? triples : [];
}

function countTriples(bgp: unknown): number {
  return triplesOf(bgp).length;
}

function resolveRuleSetVersionForExecution(
  repos: { RuleSetVersion: { list: () => LdkitRuleSetVersion[] } },
  ruleSetId: string,
  parent: LdkitRuleSet,
  requestedVersion?: number,
): { ok: true; version: LdkitRuleSetVersion } | { ok: false; status: number; message: string } {
  const versions = repos.RuleSetVersion.list()
    .filter((v) => v.isPartOf === ruleSetId);

  if (versions.length === 0) {
    return { ok: false, status: 404, message: 'Rule set has no versions to execute' };
  }

  if (requestedVersion !== undefined) {
    const match = versions.find((v) => Number(v.version) === requestedVersion);
    if (!match) {
      return { ok: false, status: 404, message: `Rule set version ${requestedVersion} not found` };
    }
    return { ok: true, version: match };
  }

  if (parent.currentVersion) {
    const selected = versions.find((v) => {
      const altId = (v as { '@id'?: string })['@id'];
      return v.$id === parent.currentVersion || (typeof altId === 'string' && altId === parent.currentVersion);
    });
    if (selected) {
      return { ok: true, version: selected };
    }
  }

  const fallback = [...versions].sort((a, b) => (a.version ?? 0) - (b.version ?? 0)).pop();
  if (!fallback) {
    return { ok: false, status: 404, message: 'Unable to determine rule set version to execute' };
  }

  return { ok: true, version: fallback };
}

// ---------------------------------------------------------------------------
// SRL document helpers
// ---------------------------------------------------------------------------

/**
 * Parse an SRL document into per-rule and per-data-block documents with
 * canonical (expanded-IRI) text. Well-formedness issues are returned as
 * warnings rather than hard failures, so an author can still save work in
 * progress.
 *
 * `tuples` is the ruleset's extension toggle, not a constant: with it off a
 * `TUPLE( … )` is a syntax error and the document is conformant SRL. Parsing
 * unconditionally with the extension on — which every call site here used to do
 * — is what made the toggle meaningless.
 */
function parseSrlDocument(
  srl: string,
  tuples = false,
): { docs: SrlRuleDocument[]; dataDocs: SrlDataBlockDocument[]; warnings: string[] } {
  const text = (srl ?? '').trim();
  if (!text) {
    throw new Error('An SRL document is required');
  }
  const ruleSet = expandIris(parseRuleSet(text, { tuples }));
  // A document may legitimately be data-only — DATA blocks are as much a part
  // of a ruleset as rules are — but empty is still an error.
  if (ruleSet.rules.length === 0 && ruleSet.dataBlocks.length === 0) {
    throw new Error('The SRL document contains no rules');
  }
  const warnings = checkWellFormed(ruleSet).map((issue) => `[${issue.category}] rule ${issue.ruleIndex + 1}: ${issue.message}`);
  return { docs: splitRuleSet(ruleSet), dataDocs: splitDataBlocks(ruleSet), warnings };
}

/**
 * Validate a tuple-seed document and describe what it declares.
 *
 * The ruleset's prologue is prepended so a seed row may use the prefixes the
 * document declares — box 2 is part of the same authoring surface as box 1, and
 * making the author redeclare `PREFIX :` there would be a papercut. Seeds carry
 * their own prologue too, which wins for any prefix they redefine.
 */
function describeTupleSeeds(
  seedText: string | null | undefined,
  documentText: string,
  tuples: boolean,
): { rows: number; declarations: Array<{ arity: number; terms: string[] }> } {
  const seeds = parseSeedDocument(seedText, documentText, tuples);
  if (!seeds) return { rows: 0, declarations: [] };
  return {
    rows: groundTupleSeedRows(seeds).length,
    declarations: tupleSeedDeclarations(seeds).map((d) => ({ arity: d.arity, terms: d.terms })),
  };
}

/** The canonical (expanded, prologue-free) storage form of a seed document. */
function canonicalTupleSeeds(seedText: string | null | undefined, documentText: string): string {
  const seeds = parseSeedDocument(seedText, documentText, true);
  return seeds ? generateTupleSeeds(seeds) : '';
}

/** Parse a seed document under the ruleset's prefixes, or null when empty. */
function parseSeedDocument(
  seedText: string | null | undefined,
  documentText: string,
  tuples: boolean,
) {
  const text = (seedText ?? '').trim();
  if (!text) return null;
  if (!tuples) {
    throw new Error('Initial named tuples require the rule-tuples extension to be enabled');
  }
  const prologue = extractPrologueText(documentText ?? '');
  return parseTupleSeeds(prologue ? `${prologue}\n${text}` : text, { tuples: true });
}

/**
 * Render a stored data block as an SRL `DATA { … }` block, or null when it is
 * not expressible as one.
 *
 * Two shapes reach this: blocks written through the SRL document path (already
 * `DATA { … }`) and blocks authored in the standalone data-block editor, which
 * are ordinarily `INSERT DATA { … }` SPARQL. Anything else — an arbitrary
 * update, say — has no `DATA` form and is reported as omitted rather than
 * mangled into one.
 */
function toDataBlockText(dataString?: string | null): string | null {
  const raw = (dataString ?? '').trim();
  if (!raw) return null;

  // IRIs are expanded before canonicalizing, exactly as on the rule path: the
  // canonical form is prefix-independent, so a block spelled `:a` and one
  // spelled with the full IRI are the same block and match on re-import.
  const canonicalize = (document: string): string | null => {
    try {
      const parsed = expandIris(parseRuleSet(document, { tuples: true }));
      if (parsed.rules.length > 0 || parsed.dataBlocks.length === 0) return null;
      return parsed.dataBlocks.map((b) => canonicalDataBlockText(b)).join('\n\n');
    } catch {
      return null;
    }
  };

  const asSrl = canonicalize(raw);
  if (asSrl) return asSrl;

  // The standalone data-block editor stores SPARQL, ordinarily
  // `[prologue] INSERT DATA { … }`. Rewrite that into the SRL form; anything
  // else (an arbitrary update, say) has no DATA form and is left alone.
  const prologue = extractPrologueText(raw);
  const withoutPrologue = raw
    .split('\n')
    .filter((line) => !/^[ \t]*(PREFIX|BASE)\b/i.test(line))
    .join('\n')
    .trim();
  const insertData = /^INSERT\s+DATA\s*\{([\s\S]*)\}\s*;?\s*$/i.exec(withoutPrologue);
  if (!insertData) return null;
  const inner = insertData[1].trim();
  return canonicalize(`${prologue ? `${prologue}\n` : ''}DATA { ${inner} }`);
}

/** DataBlockVersion IDs referenced by a rule set version, resolved to entities. */
function loadDataBlockVersions(
  repos: { DataBlockVersion: { get: (id: string) => unknown } },
  version: LdkitRuleSetVersion,
): LdkitDataBlockVersion[] {
  const out: LdkitDataBlockVersion[] = [];
  for (const dataBlockVersionId of normalizeIdList(version.hasDataBlock)) {
    const found = repos.DataBlockVersion.get(dataBlockVersionId) as LdkitDataBlockVersion | undefined;
    if (found) out.push(found);
  }
  return out;
}

/**
 * Canonicalize a stored data block for identity matching, mirroring
 * {@link canonicalizeStoredRule}. A block with no `DATA` form stays addressable
 * under an `unparseable:` identity so re-import never silently drops it.
 */
function canonicalizeStoredDataBlock(version: LdkitDataBlockVersion): { identity: string; text: string } {
  const fallback = { identity: `unparseable:${version.$id}`, text: (version.dataString ?? '').trim() };
  const text = toDataBlockText(version.dataString);
  if (!text) return fallback;
  try {
    // Identity comes from the srl package rather than a local hash, so the two
    // sides cannot drift: a stored block and an imported one must agree, or
    // every re-import would report the same data as new.
    const doc = splitDataBlocks(expandIris(parseRuleSet(text, { tuples: true })))[0];
    return doc ? { identity: doc.identity, text: doc.text } : fallback;
  } catch {
    return fallback;
  }
}

/** Describe a data block being detached from this rule set. Detach never deletes. */
function describeDetachedDataBlock(
  repos: { RuleSetVersion: { list: () => LdkitRuleSetVersion[] } },
  version: LdkitDataBlockVersion,
  currentRuleSetId: string,
): { dataBlockVersionId: string; otherRuleSets: number; orphaned: boolean } {
  const others = repos.RuleSetVersion.list().filter(
    (v) => v.isPartOf !== currentRuleSetId && normalizeIdList(v.hasDataBlock).includes(version.$id),
  );
  return {
    dataBlockVersionId: version.$id,
    otherRuleSets: others.length,
    orphaned: others.length === 0,
  };
}

/** Create the parent DataBlock entity for a newly-imported data block. */
async function createDataBlockForImport(
  repos: { DataBlock: { create: (entity: Partial<LdkitDataBlock> & { $id: string }) => Promise<LdkitDataBlock> } },
  doc: SrlDataBlockDocument,
  ruleSet: LdkitRuleSet,
): Promise<string> {
  const created = await repos.DataBlock.create({
    $id: mintId('dataBlock'),
    name: doc.suggestedLabel,
    description: null,
    isPartOf: normalizeIdList(ruleSet.isPartOf),
  });
  return created.$id;
}

/** RuleVersion IDs referenced by a rule set version, resolved to entities. */
function loadRuleVersions(
  repos: { RuleVersion: { get: (id: string) => unknown } },
  version: LdkitRuleSetVersion,
): LdkitRuleVersion[] {
  const out: LdkitRuleVersion[] = [];
  for (const ruleVersionId of normalizeIdList(version.hasRule)) {
    const found = repos.RuleVersion.get(ruleVersionId) as LdkitRuleVersion | undefined;
    if (found) out.push(found);
  }
  return out;
}

/**
 * Canonicalize a stored rule the same way `splitRuleSet` canonicalizes an
 * imported one: identity is the explicit `RULE <iri>` when present, else a hash
 * of the AST-generated canonical text.
 *
 * Both sides must be canonicalized — comparing a raw stored string against
 * generated text would report a spurious change (differing whitespace or IRI
 * spelling) and mint a pointless new version on every import.
 */
function canonicalizeStoredRule(ruleVersion: LdkitRuleVersion): { identity: string; text: string } {
  const raw = (ruleVersion.ruleString ?? '').trim();
  const fallback = { identity: `unparseable:${ruleVersion.$id}`, text: raw };
  if (!raw) return fallback;
  try {
    const docs = splitRuleSet(expandIris(parseRuleSet(raw, { tuples: true })));
    const doc = docs[0];
    // Keep unparseable/empty rules addressable so they are never silently dropped.
    return doc ? { identity: doc.identity, text: doc.text } : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Describe a rule being detached from this rule set. Detach never deletes — the
 * entities survive because other rule sets may reference them — so we
 * distinguish "still used elsewhere" from "now orphaned".
 */
function describeDetached(
  repos: { RuleSetVersion: { list: () => LdkitRuleSetVersion[] } },
  ruleVersion: LdkitRuleVersion,
  currentRuleSetId: string,
): { ruleVersionId: string; ruleId: string; otherRuleSets: number; orphaned: boolean } {
  const others = repos.RuleSetVersion.list().filter(
    (v) => v.isPartOf !== currentRuleSetId && normalizeIdList(v.hasRule).includes(ruleVersion.$id),
  );
  return {
    ruleVersionId: ruleVersion.$id,
    ruleId: ruleVersion.isPartOf,
    otherRuleSets: others.length,
    orphaned: others.length === 0,
  };
}

/**
 * Create the parent Rule entity for a newly-imported rule, in the same library
 * as the owning rule set.
 */
async function createRuleForImport(
  repos: { Rule: { create: (entity: Partial<LdkitRule> & { $id: string }) => Promise<LdkitRule> } },
  doc: SrlRuleDocument,
  ruleSet: LdkitRuleSet,
): Promise<string> {
  const toCreate: Partial<LdkitRule> & { $id: string; rulesetMembership?: unknown } = {
    $id: mintId('rule'),
    name: doc.suggestedLabel,
    description: null,
    isPartOf: normalizeIdList(ruleSet.isPartOf),
    rulesetMembership: [],
  };
  const created = await repos.Rule.create(toCreate);
  return created.$id;
}

/** Local id-list normalizer (mirrors the executor's helper). */
function normalizeIdList(value: unknown): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [String(value)];
}

/** Parse an optional `version` query/body param into a number. */
function parseVersionParam(value?: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
