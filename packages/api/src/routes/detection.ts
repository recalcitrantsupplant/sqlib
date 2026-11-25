import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { callerOfRequest } from '../auth/caller.js';
import type { FeatureFlags } from '@sparql-query-lib/types';
import { getFeatureFlags } from '../config/featureFlags.js';
import { SparqlQueryParser } from '../lib/parser.js';
import { detectionRouteSchemas, substituteRouteSchemas } from '@sparql-query-lib/contracts/schema/routes';
import { applyExecutionArguments, resolveExecutionPayload } from '../lib/executionArguments.js';
import { ArgumentSetService } from '../lib/ArgumentSetService.js';
import { detectSparqlOperation } from '../lib/queryTypeDetector.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import { typedRoute } from './route-helpers.js';
import { deriveQueryVersionMetadata } from '../lib/QueryVersionDeriver.js';
import { RuleGrammarValidator } from '../lib/RuleGrammarValidator.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { requireLibraryMode, resolveOwningLibrary } from '../auth/enforce.js';
import {
  cacheAudience,
  markPinned,
  matchesIfNoneMatch,
  pinQueryAndArguments,
  pinnedEtag,
  setPinnedHeaders,
  applyPinnedHeaders,
} from '../lib/pinnedCaching.js';
import type { ExecutionParameter } from '../lib/executionArguments.js';
import { formatText } from '../lib/formatText.js';

function isSrlDocument(code: string): boolean {
  // Skip comments and SPARQL prologue declarations before checking the SRL directive.
  const body = code.replace(
    /^(?:\s|#[^\n]*(?:\n|$)|(?:PREFIX\s+(?:[A-Za-z][\w-]*)?:\s*<[^>]*>|BASE\s*<[^>]*>)\s*)*/i,
    ''
  );
  return /^(?:RULE|DATA|IF)\b/i.test(body);
}

export default async function (
  fastify: FastifyInstance,
  options: FastifyPluginOptions & { featureFlags?: FeatureFlags },
) {
  const parser = new SparqlQueryParser();
  const ruleValidator = new RuleGrammarValidator();
  const flags = options.featureFlags ?? getFeatureFlags();

  // Parameter detection is the queries section's: with queries off there is
  // no query to detect parameters in. The validators and the formatter below
  // stay, because the rules editor uses them too.
  if (flags.queries) {
    // POST /detect-inputs — body: { query: string }
    fastify.post(
      '/detect-inputs',
      ...typedRoute(detectionRouteSchemas.detectInputsPost, async (request, reply) => {
        const { query } = request.body;
        try {
          const derived = deriveQueryVersionMetadata(parser, query);
          return reply.send({
            valuesInputs: derived.raw.valuesInputs,
            limitParameters: derived.raw.limitParameters,
            offsetParameters: derived.raw.offsetParameters,
            correlatedExistsInputs: derived.raw.correlatedExistsInputs,
            constantInputs: derived.raw.constantInputs,
            constantWarnings: derived.raw.constantWarnings,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid SPARQL query';
          return reply.status(400).send({ error: message });
        }
      })
    );

    // GET /detect-inputs?query=...
    fastify.get(
      '/detect-inputs',
      ...typedRoute(detectionRouteSchemas.detectInputsGet, async (request, reply) => {
        const { query } = request.query;
        try {
          const derived = deriveQueryVersionMetadata(parser, query);
          return reply.send({
            valuesInputs: derived.raw.valuesInputs,
            limitParameters: derived.raw.limitParameters,
            offsetParameters: derived.raw.offsetParameters,
            correlatedExistsInputs: derived.raw.correlatedExistsInputs,
            constantInputs: derived.raw.constantInputs,
            constantWarnings: derived.raw.constantWarnings,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid SPARQL query';
          return reply.status(400).send({ error: message });
        }
      })
    );

    // POST /detect-outputs — body: { query: string }
    fastify.post(
      '/detect-outputs',
      ...typedRoute(detectionRouteSchemas.detectOutputsPost, async (request, reply) => {
        const { query } = request.body;
        const derived = deriveQueryVersionMetadata(parser, query);
        return reply.send(derived.raw.outputs);
      })
    );

    // GET /detect-outputs?query=...
    fastify.get(
      '/detect-outputs',
      ...typedRoute(detectionRouteSchemas.detectOutputsGet, async (request, reply) => {
        const { query } = request.query;
        const derived = deriveQueryVersionMetadata(parser, query);
        return reply.send(derived.raw.outputs);
      })
    );
  }

  // POST /validate — body: { query: string }
  fastify.post(
    '/validate',
    ...typedRoute(detectionRouteSchemas.validateQueryPost, async (request, reply) => {
      const { query } = request.body;
      try {
        parser.parseQuery(query);
        return reply.send({ valid: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid SPARQL query';
        return reply.status(400).send({ valid: false, error: message });
      }
    })
  );

  // POST /validate-rule-data — body: { ruleOrData: string }
  fastify.post(
    '/validate-rule-data',
    ...typedRoute(detectionRouteSchemas.validateRuleDataPost, async (request, reply) => {
      const { ruleOrData } = request.body;

      try {
        // Validate against all three grammars
        const result = ruleValidator.validateWithAllGrammars(ruleOrData);

        // Return 400 if ALL grammars failed
        if (!result.valid) {
          return reply.status(400).send({
            valid: false,
            error: result.error,
            validations: result.validations,
          });
        }

        // Return success with multi-grammar results
        return reply.send({
          valid: true,
          normalized: result.normalized,
          primaryGrammar: result.primaryGrammar,
          validations: result.validations,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid syntax';
        return reply.status(400).send({
          valid: false,
          error: message,
        });
      }
    })
  );

  // POST /format — body: { code: string }
  fastify.post(
    '/format',
    ...typedRoute(detectionRouteSchemas.formatPost, async (request, reply) => {
      const { code } = request.body;

      if (!code.trim()) return reply.status(400).send({ error: 'No code to format' });

      // An SRL document and a SPARQL query parse from different entry points
      // of the same grammar, so the route picks one before it formats.
      try {
        const formatted = formatText(code, isSrlDocument(code) ? 'srl' : 'sparql');
        return reply.send({ formatted });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid syntax';
        return reply.status(400).send({ error: message });
      }
    })
  );

  /**
   * POST /substitute — the substituted query, without running it.
   *
   * What a browser-side executor is missing. The runtime can splice a VALUES
   * block over a span without a parser; finding the spans needs one, and a
   * named argument set needs the store. So this does both and hands the text
   * back, and the caller decides where it runs — including at an endpoint sqlib
   * never sees, which is the whole point of a browser backend.
   *
   * Nothing is stored and nothing is executed, which is why a read-only
   * deployment can serve it (`config/readOnly.ts`).
   */
  // A pinned GET /substitute that succeeded may be cached (`lib/pinnedCaching.ts`).
  fastify.addHook('onSend', async (request, reply, payload) => {
    applyPinnedHeaders(request, reply);
    return payload;
  });

  /**
   * GET /substitute — the substituted text of a stored query with stored
   * arguments (#206), in one request.
   *
   * `targetId` names a query version, or a query, which runs its current
   * version. `argumentSetIds`, `limits` and `offsets` are JSON arrays, as in
   * the POST body. A query version with argument-set versions is pinned, so
   * the response carries an ETag and may be cached for a year.
   */
  fastify.get<{
    Querystring: { targetId: string; argumentSetIds?: string; limits?: string; offsets?: string };
  }>(
    '/substitute',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['targetId'],
          properties: {
            targetId: { type: 'string', description: 'A query version id, or a query id for its current version.' },
            argumentSetIds: { type: 'string', description: 'JSON array of argument set ids or argument-set version ids.' },
            limits: { type: 'string', description: 'JSON array of { name, value }.' },
            offsets: { type: 'string', description: 'JSON array of { name, value }.' },
          },
        },
      },
    },
    async (request, reply) => {
      const parseArray = (name: string, raw: string | undefined): unknown[] | undefined => {
        if (raw === undefined) return undefined;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new SubstituteParameterError(`Invalid JSON in ${name}: ${(error as Error).message}`);
        }
        if (!Array.isArray(parsed)) throw new SubstituteParameterError(`${name} must be a JSON array.`);
        return parsed;
      };

      let argumentSetIds: string[] | undefined;
      let limits: ExecutionParameter[] | undefined;
      let offsets: ExecutionParameter[] | undefined;
      try {
        const ids = parseArray('argumentSetIds', request.query.argumentSetIds);
        if (ids && !ids.every((id): id is string => typeof id === 'string')) {
          throw new SubstituteParameterError('argumentSetIds must be a JSON array of strings.');
        }
        argumentSetIds = ids as string[] | undefined;
        limits = parseArray('limits', request.query.limits) as ExecutionParameter[] | undefined;
        offsets = parseArray('offsets', request.query.offsets) as ExecutionParameter[] | undefined;
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }

      const lookup = (id: string) => getCacheCoordinator().get(id);
      const { targetId } = request.query;
      let target = lookup(targetId) as { '@type'?: string; currentVersion?: string; queryString?: string } | null;
      if (target?.['@type'] === 'Query') {
        target = target.currentVersion ? (lookup(target.currentVersion) as typeof target) : null;
      }
      if (!target || target['@type'] !== 'QueryVersion' || typeof target.queryString !== 'string') {
        return reply.status(404).send({ error: `No query or query version ${targetId}.` });
      }

      // The query text is stored content: substituting it needs Read on its library.
      requireLibraryMode(request, resolveOwningLibrary(target), 'read');

      const pin = pinQueryAndArguments(lookup, { targetId, argumentSetIds });
      if (pin.pinned) {
        for (const id of argumentSetIds ?? []) {
          requireLibraryMode(request, resolveOwningLibrary(lookup(id)), 'read');
        }
        const audience = cacheAudience(request);
        const etag = pinnedEtag({
          route: 'substitute',
          ...pin.pins,
          limits: limits ?? null,
          offsets: offsets ?? null,
          caller: audience.caller,
        });
        if (matchesIfNoneMatch(request.headers['if-none-match'], etag)) {
          setPinnedHeaders(reply, etag, audience.scope);
          return reply.code(304).send();
        }
        markPinned(request, etag, audience.scope);
      }

      try {
        const query = target.queryString;
        const operation = detectSparqlOperation(query);
        const resolved = await resolveExecutionPayload(
          { limits, offsets, argumentSetIds },
          new ArgumentSetService(),
          { request },
        );
        return reply.send({
          query: applyExecutionArguments(query, {
            argumentSets: resolved.argumentSets,
            limits: resolved.limits,
            offsets: resolved.offsets,
            caller: callerOfRequest(request),
          }),
          operation: operation === QueryTypeIri.update ? 'update' : 'query',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid request';
        return reply.status(400).send({ error: message });
      }
    },
  );

  fastify.post(
    '/substitute',
    ...typedRoute(substituteRouteSchemas.substitutePost, async (request, reply) => {
      const { query, arguments: inlineArguments, limits, offsets, argumentSetIds } = request.body;

      try {
        /*
         * Detected from the query the caller wrote, before substitution, for
         * the reason `/sparql` gives: substituting VALUES rows cannot turn a
         * SELECT into anything else, and a caller choosing a request shape from
         * this needs the answer for the query itself.
         */
        const operation = detectSparqlOperation(query);
        const resolved = await resolveExecutionPayload(
          { arguments: inlineArguments, limits, offsets, argumentSetIds },
          new ArgumentSetService(),
          // The route reads no entity of its own, but named sets are stored
          // content: substituting them needs Read on their libraries.
          { request },
        );
        return reply.send({
          query: applyExecutionArguments(query, {
            argumentSets: resolved.argumentSets,
            limits: resolved.limits,
            offsets: resolved.offsets,
            caller: callerOfRequest(request),
          }),
          operation: operation === QueryTypeIri.update ? 'update' : 'query',
        });
      } catch (error) {
        // Every failure here is the caller's payload: an unparseable query, an
        // argument set that does not fit it, or a conflict with a stored one.
        const message = error instanceof Error ? error.message : 'Invalid request';
        return reply.status(400).send({ error: message });
      }
    })
  );
}

class SubstituteParameterError extends Error {}
