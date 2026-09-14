import type { FastifyInstance } from 'fastify';
import { classifyVersionPatch } from '../lib/versionPatch.js';
import { mintId } from '../lib/id.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { LdkitRule } from '../persistence/schemas/RuleSchema.js';
import type { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import { createRuleVersion, annotateRuleVersion } from '../lib/RuleVersionWriter.js';
import { reposRoute, typedRoute, withReposHandler, validateIfMatch, setEntityConcurrencyHeaders, findVersionByNumber } from './route-helpers.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { analyseReferences, describeWrongType } from '../lib/entityReferences.js';
import { analyseTags } from '../lib/tagMembership.js';
import { createRuleSchema, updateRuleSchema } from '@sparql-query-lib/contracts/schema';
import { oxigraphStoreManager } from '../lib/OxigraphStoreManager.js';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import { ImmutableEntityError } from '../lib/immutability.js';
import { RuleGrammarValidator } from '../lib/RuleGrammarValidator.js';
import { getFeatureFlags } from '../config/featureFlags.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { filterReadable } from '../auth/enforce.js';

export const ruleResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
    currentVersion: { type: 'string', nullable: true },
    isPartOf: {
      type: 'array',
      items: { type: 'string' },
    },
    rulesetMembership: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
    },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
    tags: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
    },
  },
  required: ['id', 'name', 'isPartOf'],
  additionalProperties: false,
} as const;

const ruleVersionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    isPartOf: { type: 'string' },
    version: { type: 'integer' },
    immutable: { type: 'boolean', nullable: true },
    ruleString: { type: 'string' },
    normalizedInsert: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
    defaultBackend: { type: 'string', nullable: true },
    grammarValid: { type: 'boolean', nullable: true },
    validationError: { type: 'string', nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'isPartOf', 'version', 'ruleString'],
  additionalProperties: false,
} as const;

const createRuleVersionBodySchema = {
  type: 'object',
  properties: {
    ruleString: { type: 'string' },
    comment: { type: 'string', nullable: true },
    defaultBackend: { type: 'string', nullable: true },
    immutable: { type: 'boolean', nullable: true },
    allowInvalidSave: { type: 'boolean', nullable: true },
  },
  required: ['ruleString'],
  additionalProperties: false,
} as const;

const annotateRuleVersionBodySchema = {
  type: 'object',
  properties: {
    ruleString: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
    defaultBackend: { type: 'string', nullable: true },
    immutable: { type: 'boolean', nullable: true },
    allowInvalidSave: { type: 'boolean', nullable: true },
  },
  additionalProperties: false,
} as const;

const executionPreviewResponseSchema = {
  type: 'object',
  properties: {
    normalizedInsert: { type: 'string' },
    primaryGrammar: { type: 'string', nullable: true },
  },
  required: ['normalizedInsert'],
  additionalProperties: false,
} as const;

const executeRuleBodySchema = {
  type: 'object',
  properties: {
    version: { type: 'integer', nullable: true },
    maxIterations: { type: 'integer', minimum: 1, nullable: true },
    destroyStore: { type: 'boolean', nullable: true },
  },
  additionalProperties: false,
} as const;

const executeRuleResponseSchema = {
  type: 'object',
  properties: {
    iterations: { type: 'integer' },
    triplesAfter: { type: 'integer' },
    triplesAddedLastIteration: { type: 'integer' },
    nquads: { type: 'string' },
  },
  required: ['iterations', 'triplesAfter', 'triplesAddedLastIteration', 'nquads'],
  additionalProperties: false,
} as const;

export default async function (fastify: FastifyInstance) {
  /*
   * The suffix lists name routes this plugin actually mounts, and nothing else.
   * A suffix with no route behind it is not inert: it is an exemption waiting
   * for the first route whose path ends that way, which is how `/rule-sets`
   * came to leave `POST /:id/srl/preview` — a route that loads an entity —
   * unguarded. `/execute/stream`, `/run` and a bare `/preview` were all in
   * these lists with no such route here.
   */
  registerEntityAuthGuard(fastify, { executeSuffixes: ['/execute'], exemptSuffixes: ['/preview/normalize'] });

  const ruleValidator = new RuleGrammarValidator();

  fastify.get('/', ...reposRoute({
      tags: ['Rule'],
      summary: 'List rules',
      response: {
        200: {
          type: 'array',
          items: ruleResponseSchema,
        },
      },
    }, async ({ repos, reply, request }) => {
    // Filtered rather than refused: an empty array is the answer to "which of
    // these may I see" when the answer is none, and says nothing about what
    // exists. The same decision `/queries`, `/tuple-sets` and `/rule-sets`
    // make; this listing made none and answered with every rule in the
    // deployment.
    const items = repos.Rule.list() as LdkitRule[];
    return reply.send(filterReadable(request, items).map(rule => toRestApi(rule)));
  }));

  fastify.post('/', ...reposRoute({
      tags: ['Rule'],
      summary: 'Create rule',
      body: createRuleSchema.body,
      response: {
        201: ruleResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const cacheCoordinator = getCacheCoordinator();
    const body = request.body;
    const name = String(body.name).trim();
    if (!name) {
      return reply.status(400).send({ error: 'Rule name is required' });
    }

    const rawIsPartOf = body.isPartOf;
    const isPartOfArray: string[] = Array.isArray(rawIsPartOf)
      ? rawIsPartOf.map((val: unknown) => String(val))
      : rawIsPartOf
        ? [String(rawIsPartOf)]
        : [];
    if (isPartOfArray.length === 0) {
      return reply.status(400).send({ error: 'Rule must be associated with at least one parent' });
    }

    const parents = analyseReferences('Rule', 'isPartOf', isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );

    if (parents.exactlyOneCount === 0) {
      return reply.status(400).send({ error: 'Rule must belong to exactly one library' });
    }
    if ((parents.exactlyOneCount ?? 0) > 1) {
      return reply.status(400).send({ error: 'Rule can only belong to a single library' });
    }

    if (parents.missing.length > 0) {
      return reply.status(400).send({ error: `Referenced entity ${parents.missing[0]} does not exist` });
    }

    if (parents.wrongType.length > 0) {
      return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
    }

    const tagCheck = analyseTags('Rule', body.tags, isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    const id = mintId('rule');
    const toCreate: Partial<LdkitRule> & { $id: string; rulesetMembership?: unknown } = {
      $id: id,
      name,
      description: body.description ?? null,
      isPartOf: isPartOfArray,
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
      rulesetMembership: body.rulesetMembership ?? [],
    };

    const created = await repos.Rule.create(toCreate);
    setEntityConcurrencyHeaders(reply, created);
    return reply.status(201).send(toRestApi(created));
  }));

  fastify.get('/:id', ...reposRoute({
      tags: ['Rule'],
      summary: 'Get rule',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: ruleResponseSchema,
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const entity = repos.Rule.get(id) as LdkitRule | null;
    if (!entity) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, entity);
    return reply.send(toRestApi(entity));
  }));

  fastify.put('/:id', ...reposRoute({
      tags: ['Rule'],
      summary: 'Update rule',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: updateRuleSchema.body,
      response: {
        200: ruleResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const updates = request.body;
    const cacheCoordinator = getCacheCoordinator();

    const current = repos.Rule.get(id) as LdkitRule | null;
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

    // The body schema admits `isPartOf` as a string or an array; ajv's
    // `coerceTypes: 'array'` has already wrapped the string form by the time we
    // get here, but normalising explicitly keeps the handler correct if that
    // option ever changes, and it is what gets persisted (queries.ts does the
    // same). `LdkitRule.isPartOf` is `string[]`.
    let ids: string[] | undefined;
    if (updates.isPartOf) {
      ids = Array.isArray(updates.isPartOf)
        ? updates.isPartOf.map(val => String(val))
        : [String(updates.isPartOf)];
      const parents = analyseReferences('Rule', 'isPartOf', ids, iri => cacheCoordinator.get(iri));
      if (parents.exactlyOneCount === 0) {
        return reply.status(400).send({ error: 'Rule must belong to exactly one library' });
      }
      if ((parents.exactlyOneCount ?? 0) > 1) {
        return reply.status(400).send({ error: 'Rule can only belong to a single library' });
      }
      if (parents.wrongType.length > 0) {
        return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
      }
    }

    // The body now projects from RuleSchema (Phase C3, issue #65), so each
    // field's nullability on the wire is the one the entity declares rather than
    // a hand-written `nullable: true`. `name` is required there, and ajv coerces
    // an explicit `null` to `''`, so it is the entity's `minLength: 1` that
    // rejects the null-out this handler used to have to tolerate. The cast stays
    // because `LdkitRule` types `isPartOf` as `string[]` while the body's is the
    // pre-coercion union.
    const tagCheck = analyseTags('Rule', updates.tags, ids ?? current.isPartOf, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    const updated = await repos.Rule.update(id, {
      ...updates,
      ...(ids ? { isPartOf: ids } : {}),
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
    } as Partial<LdkitRule>);
    if (!updated) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(toRestApi(updated));
  }));

  fastify.delete('/:id', ...reposRoute({
      tags: ['Rule'],
      summary: 'Delete rule and all its versions (cascading delete)',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        204: { type: 'null' },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const current = repos.Rule.get(id);
    if (!current) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    // Cascading delete: delete all versions first
    const versions = (repos.RuleVersion.list() as LdkitRuleVersion[]).filter(v => v.isPartOf === id);
    for (const version of versions) {
      await repos.RuleVersion.delete(version.$id);
    }

    // Then delete the parent rule
    await repos.Rule.delete(id);
    return reply.status(204).send();
  }));

  fastify.get('/:id/versions', ...reposRoute({
      tags: ['Rule'],
      summary: 'List rule versions',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'array',
          items: ruleVersionResponseSchema,
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.Rule.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Rule not found' });
    }
    const versions = (repos.RuleVersion.list() as LdkitRuleVersion[])
      .filter(v => v.isPartOf === id)
      .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    return reply.send(versions.map(v => toRestApi(v)));
  }));

  fastify.post('/:id/versions', ...reposRoute({
      tags: ['Rule'],
      summary: 'Create rule version',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: createRuleVersionBodySchema,
      response: {
        201: ruleVersionResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.Rule.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Rule not found' });
    }

    const body = request.body;
    const ruleString = String(body.ruleString || '');
    if (!ruleString.trim()) {
      return reply.status(400).send({ error: 'ruleString must be provided' });
    }

    const validation = ruleValidator.validateWithAllGrammars(ruleString);
    const flags = getFeatureFlags();
    const allowInvalidSave = flags.rulesAllowInvalidSave && body.allowInvalidSave === true;
    if (!validation.valid && !allowInvalidSave) {
      return reply.status(400).send({ error: validation.error ?? 'Provided ruleString is not valid SPARQL-RL (SRL) syntax' });
    }

    try {
      const created = await createRuleVersion(id, {
        ruleString,
        comment: body.comment ?? null,
        defaultBackend: body.defaultBackend ?? null,
        immutable: body.immutable ?? undefined,
        allowInvalidSave,
      });
      setEntityConcurrencyHeaders(reply, created);
      return reply.status(201).send(toRestApi(created));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }));

  fastify.post('/:id/execute', ...reposRoute({
      tags: ['Rule'],
      summary: 'Execute rule iteratively against an ephemeral Oxigraph store',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: executeRuleBodySchema,
      response: {
        200: executeRuleResponseSchema,
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const parent = repos.Rule.get(id) as LdkitRule | null;
    if (!parent) {
      return reply.status(404).send({ error: 'Rule not found' });
    }

    const body = request.body ?? {};
    const requestedVersion = body.version as number | undefined;
    const maxIterations = typeof body.maxIterations === 'number' && body.maxIterations > 0 ? body.maxIterations : 25;
    const destroyStore = body.destroyStore !== false;

    const versions = (repos.RuleVersion.list() as LdkitRuleVersion[])
      .filter(v => v.isPartOf === id);
    if (versions.length === 0) {
      return reply.status(404).send({ error: 'Rule has no versions to execute' });
    }

    let selected: LdkitRuleVersion | undefined;
    if (requestedVersion !== undefined) {
      selected = versions.find(v => Number(v.version) === requestedVersion);
      if (!selected) {
        return reply.status(404).send({ error: `Rule version ${requestedVersion} not found` });
      }
    } else if (parent.currentVersion) {
      selected = versions.find((v) => {
        const altId = (v as { '@id'?: string })['@id'];
        return v.$id === parent.currentVersion || (typeof altId === 'string' && altId === parent.currentVersion);
      });
    }
    if (!selected) {
      selected = versions.sort((a, b) => (a.version ?? 0) - (b.version ?? 0)).pop();
    }
    if (!selected) {
      return reply.status(404).send({ error: 'Unable to determine rule version to execute' });
    }

    if (selected.grammarValid === false) {
      return reply.status(400).send({ error: 'Stored rule is marked invalid and cannot be executed' });
    }

    const resolved = resolveRuleProgram(selected.ruleString, selected.normalizedInsert, ruleValidator);
    if ('error' in resolved) {
      return reply.status(400).send({ error: resolved.error });
    }
    const normalized = resolved.program;

    const storeId = mintId('rule') + ':exec';
    const store = oxigraphStoreManager.createEphemeralStore(storeId);
    const executor = new OxigraphSparqlExecutor(store);

    let iterations = 0;
    let delta = 0;
    try {
      do {
        const before = store.size;
        await executor.update(normalized);
        const after = store.size;
        delta = after - before;
        iterations += 1;
      } while (delta > 0 && iterations < maxIterations);

      const nquads = await executor.constructQueryParsed('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');

      return reply.send({
        iterations,
        triplesAfter: store.size,
        triplesAddedLastIteration: delta,
        nquads,
      });
    } finally {
      if (destroyStore) {
        oxigraphStoreManager.destroyEphemeralStore(storeId);
      }
    }
  }));

  fastify.get('/:id/versions/:version', ...reposRoute({
      tags: ['Rule'],
      summary: 'Get rule version',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['id', 'version'],
      },
      response: {
        200: ruleVersionResponseSchema,
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const parent = repos.Rule.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Rule not found' });
    }

    const lookup = findVersionByNumber(
      repos.RuleVersion.list() as LdkitRuleVersion[],
      id,
      version,
      'rule',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;
    setEntityConcurrencyHeaders(reply, match);
    return reply.send(toRestApi(match));
  }));

  fastify.delete('/:id/versions/:version', ...reposRoute({
      tags: ['Rule'],
      summary: 'Delete rule version',
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
          description: 'Rule version deleted successfully',
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const parent = repos.Rule.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Rule not found' });
    }

    const lookup = findVersionByNumber(
      repos.RuleVersion.list() as LdkitRuleVersion[],
      id,
      version,
      'rule',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;

    await repos.RuleVersion.delete(match.$id);
    return reply.status(204).send();
  }));

  // PATCH /rules/:id/versions/:version — annotate a version
  //
  // A version is a snapshot (issue #192): `ruleString` is what a rule set
  // version that names this version was stratified against. Only the comment is
  // writable.
  fastify.patch('/:id/versions/:version', ...reposRoute({
      tags: ['Rule'],
      summary: 'Annotate a rule version (comment only; content is immutable)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['id', 'version'],
      },
      body: annotateRuleVersionBodySchema,
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    const parent = repos.Rule.get(id);
    if (!parent) {
      return reply.status(404).send({ error: 'Rule not found' });
    }

    const lookup = findVersionByNumber(
      repos.RuleVersion.list() as LdkitRuleVersion[],
      id,
      version,
      'rule',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;

    const { annotations, rejection } = classifyVersionPatch(request.body as Record<string, unknown>);
    if (rejection) return reply.status(rejection.status).send(rejection);

    try {
      const updated = await annotateRuleVersion(match.$id, {
        comment: annotations.comment as string | null | undefined,
        immutable: annotations.immutable as boolean | undefined,
      });
      setEntityConcurrencyHeaders(reply, updated);
      return reply.send(toRestApi(updated));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }));

  fastify.post('/preview/normalize', ...typedRoute({
    tags: ['Rule'],
    summary: 'Preview normalized SPARQL update for rule',
    body: {
      type: 'object',
      properties: {
        ruleString: { type: 'string' },
      },
      required: ['ruleString'],
      additionalProperties: false,
    },
    response: {
      200: executionPreviewResponseSchema,
      400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
    },
  }, async (request, reply) => {
    const body = request.body;
    const ruleString = String(body.ruleString || '');
    const validation = ruleValidator.validateWithAllGrammars(ruleString);
    if (!validation.valid || !validation.normalized) {
      return reply.status(400).send({ error: validation.error ?? 'Provided ruleString is not valid SPARQL-RL (SRL) syntax' });
    }
    const normalized = ensureTrailingSemicolon(validation.normalized);
    return reply.send({
      normalizedInsert: normalized,
      primaryGrammar: validation.primaryGrammar,
    });
  }));
}

function ensureTrailingSemicolon(program: string): string {
  return program.endsWith(';') ? program : `${program};`;
}

function resolveRuleProgram(
  ruleString: string,
  normalizedInsert: string | null | undefined,
  validator: RuleGrammarValidator,
): { program: string } | { error: string } {
  const normalized = (normalizedInsert ?? '').trim();
  if (normalized) {
    return { program: ensureTrailingSemicolon(normalized) };
  }

  const validation = validator.validateWithAllGrammars(ruleString);
  if (validation.valid && validation.normalized) {
    return { program: ensureTrailingSemicolon(validation.normalized) };
  }
  if (validation.usesTuples) {
    // Valid, but a tuple rule only means anything against a tuple store, which
    // is built per rule-set execution. Running it here would read from nothing.
    return {
      error: 'Rule uses the rule-tuples extension and cannot be executed on its own; execute it through a rule set',
    };
  }

  const fallback = (ruleString ?? '').trim();
  if (!fallback) {
    return { error: 'Stored rule is not valid SPARQL-RL (SRL) syntax' };
  }
  return { program: ensureTrailingSemicolon(fallback) };
}
