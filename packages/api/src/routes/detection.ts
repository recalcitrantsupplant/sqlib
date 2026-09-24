import type { FastifyInstance } from 'fastify';
import { SparqlQueryParser } from '../lib/parser.js';
import { detectionRouteSchemas, substituteRouteSchemas } from '@sparql-query-lib/contracts/schema/routes';
import { applyExecutionArguments, resolveExecutionPayload } from '../lib/executionArguments.js';
import { ArgumentSetService } from '../lib/ArgumentSetService.js';
import { detectSparqlOperation } from '../lib/queryTypeDetector.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import { typedRoute } from './route-helpers.js';
import { deriveQueryVersionMetadata } from '../lib/QueryVersionDeriver.js';
import { RuleGrammarValidator } from '../lib/RuleGrammarValidator.js';

function isSrlDocument(code: string): boolean {
  // Skip comments and SPARQL prologue declarations before checking the SRL directive.
  const body = code.replace(
    /^(?:\s|#[^\n]*(?:\n|$)|(?:PREFIX\s+(?:[A-Za-z][\w-]*)?:\s*<[^>]*>|BASE\s*<[^>]*>)\s*)*/i,
    ''
  );
  return /^(?:RULE|DATA|IF)\b/i.test(body);
}

export default async function (fastify: FastifyInstance) {
  const parser = new SparqlQueryParser();
  const ruleValidator = new RuleGrammarValidator();

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

      try {
        // SRL has its own generator (the rule/DATA structure is not SPARQL), so an
        // SRL document is formatted by the SRL package. Do not send normal SPARQL
        // down this branch: it would miss the query generator below.
        if (isSrlDocument(code)) {
          const { formatted } = ruleValidator.formatRuleOrData(code);
          return reply.send({ formatted });
        }

        const formatted = parser.formatQueryString(code);
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
          new ArgumentSetService()
        );
        return reply.send({
          query: applyExecutionArguments(query, {
            argumentSets: resolved.argumentSets,
            limits: resolved.limits,
            offsets: resolved.offsets,
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
