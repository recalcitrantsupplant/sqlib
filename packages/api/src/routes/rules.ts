import type { FastifyInstance } from 'fastify';
import { maxRuleIterations } from '../config/executionLimits.js';
import { mintId } from '../lib/id.js';
import type { LdkitRule } from '../persistence/schemas/RuleSchema.js';
import type { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import { createRuleVersion, annotateRuleVersion } from '../lib/RuleVersionWriter.js';
import { reposRoute, typedRoute, RouteError } from './route-helpers.js';
import { registerVersionedEntityRoutes, type StoredEntity } from './versionedEntity.js';
import { createRuleSchema, updateRuleSchema } from '@sparql-query-lib/contracts/schema';
import { oxigraphStoreManager } from '../lib/OxigraphStoreManager.js';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import { RuleGrammarValidator } from '../lib/RuleGrammarValidator.js';
import { getFeatureFlags } from '../config/featureFlags.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';

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
    maxIterations: { type: 'integer', minimum: 1, maximum: maxRuleIterations(), nullable: true },
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

  registerVersionedEntityRoutes(fastify, {
    noun: 'rule',
    type: 'Rule',
    versionType: 'RuleVersion',
    idKind: 'rule',
    schemas: {
      list: { tags: ['Rule'], summary: 'List rules', response: { 200: { type: 'array', items: ruleResponseSchema } } },
      create: { tags: ['Rule'], summary: 'Create rule', body: createRuleSchema.body, response: { 201: ruleResponseSchema } },
      get: { tags: ['Rule'], summary: 'Get rule', response: { 200: ruleResponseSchema } },
      update: { tags: ['Rule'], summary: 'Update rule', body: updateRuleSchema.body, response: { 200: ruleResponseSchema } },
      delete: { tags: ['Rule'], summary: 'Delete rule and all its versions (cascading delete)', response: { 204: { type: 'null' } } },
      listVersions: { tags: ['Rule'], summary: 'List rule versions', response: { 200: { type: 'array', items: ruleVersionResponseSchema } } },
      createVersion: { tags: ['Rule'], summary: 'Create rule version', body: createRuleVersionBodySchema, response: { 201: ruleVersionResponseSchema } },
      getVersion: { tags: ['Rule'], summary: 'Get rule version', response: { 200: ruleVersionResponseSchema } },
      patchVersion: {
        tags: ['Rule'],
        summary: 'Annotate a rule version (comment only; content is immutable)',
        body: annotateRuleVersionBodySchema,
        response: { 200: ruleVersionResponseSchema },
      },
      deleteVersion: { tags: ['Rule'], summary: 'Delete rule version', response: { 204: { type: 'null' } } },
    },
    beforeCreate: ({ body }) => ({ rulesetMembership: body.rulesetMembership ?? [] }),
    createVersion: async ({ parent, body }) => {
      const ruleString = String(body.ruleString || '');
      if (!ruleString.trim()) {
        throw new RouteError(400, { error: 'ruleString must be provided' });
      }

      const validation = ruleValidator.validateWithAllGrammars(ruleString);
      const allowInvalidSave = getFeatureFlags().rulesAllowInvalidSave && body.allowInvalidSave === true;
      if (!validation.valid && !allowInvalidSave) {
        throw new RouteError(400, { error: validation.error ?? 'Provided ruleString is not valid SHACL Rules syntax' });
      }

      const created = await createRuleVersion(parent.$id, {
        ruleString,
        comment: (body.comment as string | null | undefined) ?? null,
        defaultBackend: (body.defaultBackend as string | null | undefined) ?? null,
        immutable: (body.immutable as boolean | null | undefined) ?? undefined,
        allowInvalidSave,
      });
      return { created: created as unknown as StoredEntity };
    },
    // A version is a snapshot (issue #192): `ruleString` is what a rule set
    // version that names this version was stratified against. Only the
    // comment is writable.
    annotateVersion: async (version, annotations) => await annotateRuleVersion(version.$id, {
      comment: annotations.comment as string | null | undefined,
      immutable: annotations.immutable as boolean | undefined,
    }) as unknown as StoredEntity,
  });

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
    const maxIterations = Math.min(
      typeof body.maxIterations === 'number' && body.maxIterations > 0 ? body.maxIterations : 25,
      maxRuleIterations(),
    );

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
      // Always: a caller-controlled way to keep the store left one behind per
      // call, reachable by nothing and freed by nothing.
      oxigraphStoreManager.destroyEphemeralStore(storeId);
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
      return reply.status(400).send({ error: validation.error ?? 'Provided ruleString is not valid SHACL Rules syntax' });
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
    return { error: 'Stored rule is not valid SHACL Rules syntax' };
  }
  return { program: ensureTrailingSemicolon(fallback) };
}
