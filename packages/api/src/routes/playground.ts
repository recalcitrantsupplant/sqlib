import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { RuleGrammarValidator } from '../lib/RuleGrammarValidator.js';
import { toError } from '../lib/toError.js';
import { mintId } from '../lib/id.js';
import { RuleSetExecutor } from '../lib/RuleSetExecutor.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { RuleStratifier } from '../lib/RuleStratifier.js';
import { getFeatureFlags } from '../config/featureFlags.js';
import { ruleTuplesAllowed, ruleTuplesRefusal, hasSeedText } from '../lib/ruleTuples.js';
import type { LdkitDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import type { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import type { LdkitRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import type { ColumnDefinition } from '../persistence/schemas/EtlColumnMappingVersionSchema.js';
import type { LdkitEtlJob } from '../persistence/schemas/EtlJobSchema.js';
import type { LdkitEtlJobVersion } from '../persistence/schemas/EtlJobVersionSchema.js';
import type { LdkitEtlColumnMappingVersion } from '../persistence/schemas/EtlColumnMappingVersionSchema.js';
import { duckDbService } from '../lib/DuckDbService.js';
import { SparqlQueryParser } from '../lib/parser.js';
import { ExecutorFactory } from '../lib/orchestration/ExecutorFactory.js';
import type { SparqlBinding } from '../lib/query-chaining.js';
import type { ArgumentSet } from '../lib/orchestration/types.js';
import { etlService } from '../lib/EtlService.js';
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';
import * as crypto from 'crypto';
import { oxigraphStoreManager } from '../lib/OxigraphStoreManager.js';
import { typedRoute } from './route-helpers.js';
import { requireAdmin } from '../auth/enforce.js';
import { DataGraphContentError, resolveDataGraphInput, type ResolvedDataGraph } from '../lib/dataGraphInput.js';
import {
  expandIris,
  extractPrologueText,
  generateTupleSeeds,
  parseRuleSet,
  parseTupleSeeds,
  splitDataBlocks,
  splitRuleSet,
} from '@sparql-query-lib/srl';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import {
  playgroundRulesExecuteRequestJsonSchema,
  playgroundRulesExecuteResponseJsonSchema,
} from '@sparql-query-lib/contracts/schema/routes';
import type {
  PlaygroundRulesExecuteRequest,
  PlaygroundRulesExecuteResponse,
} from '@sparql-query-lib/contracts';

const responseErrorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
};

function toUrn(kind: string, value: string): string {
  const trimmed = String(value ?? '').trim();
  if (trimmed.startsWith('urn:')) return trimmed;
  return mintId(kind, trimmed);
}

function normalizeColumnDefinitions(columns: ColumnDefinition[]): ColumnDefinition[] {
  return columns.map((col) => ({
    ...col,
    targetVariable: String(col.targetVariable ?? '').trim().replace(/^\?/, ''),
    columnName: String(col.columnName ?? '').trim(),
  }));
}

function bindingsToArgumentSet(bindings: SparqlBinding[], columnDefs: ColumnDefinition[]): ArgumentSet {
  const vars = columnDefs.map((c) => c.targetVariable.replace(/^\?/, ''));
  return {
    head: { vars },
    arguments: { bindings },
  };
}

/**
 * Strip the request fields that only mean something with the rule-tuples
 * extension on, for a build that withholds it.
 *
 * The handler refuses them either way (see `lib/ruleTuples.ts`); this keeps
 * `/docs` from advertising a field that can only ever answer 400. Called at
 * route registration, after the flags are resolved.
 */
function withoutRuleTupleFields<const T>(schema: T): T {
  if (ruleTuplesAllowed()) return schema;
  const { properties, ...rest } = schema as { properties?: Record<string, unknown> };
  if (!properties) return schema;
  const kept = { ...properties };
  delete kept.tuples;
  delete kept.tupleSeeds;
  return { ...rest, properties: kept } as T;
}

export default async function playgroundRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  const validator = new RuleGrammarValidator();
  const cacheCoordinator = getCacheCoordinator();

  const buildValidationPayload = (
    source: string,
  ): {
    normalized?: string;
    grammarValid: boolean;
    grammarType?: string | null;
    grammarValidations?: string | null;
    error?: string;
  } => {
    const validation = validator.validateWithAllGrammars(source);
    return {
      normalized: validation.normalized,
      grammarValid: validation.valid,
      grammarType: validation.primaryGrammar ?? null,
      grammarValidations: JSON.stringify(validation.validations),
      error: validation.valid ? undefined : validation.error,
    };
  };

  fastify.post(
    '/rules/execute',
    {
      schema: {
        tags: ['Rule'],
        summary: 'Execute rules in playground (inline data + rules)',
        body: withoutRuleTupleFields(playgroundRulesExecuteRequestJsonSchema),
        response: {
          200: playgroundRulesExecuteResponseJsonSchema,
          400: responseErrorSchema,
          404: responseErrorSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Body: PlaygroundRulesExecuteRequest }>, reply: FastifyReply) => {
      const flags = getFeatureFlags();
      if (!flags.playgroundRules) {
        return reply.status(404).send({ error: 'Rules feature is disabled' });
      }

      const body = request.body || {};

      /*
       * A rule set is one SRL document, so that is what the editor sends: the
       * server splits it into the rules and data blocks it runs. The two arrays
       * remain for callers that already hold split parts (and for the executor
       * below, which is entity-shaped either way).
       */
      const useTuples = body.tuples === true;
      /*
       * The deployment gate on the rule-tuples extension, checked before the
       * document is parsed so a `TUPLE( … )` is refused by name rather than as
       * a bare syntax error. See lib/ruleTuples.ts.
       */
      const tupleRefusal = ruleTuplesRefusal(useTuples || hasSeedText(body.tupleSeeds));
      if (tupleRefusal) {
        return reply.status(400).send({ error: tupleRefusal });
      }
      let dataBlocks = Array.isArray(body.dataBlocks) ? body.dataBlocks : [];
      let rules = Array.isArray(body.rules) ? body.rules : [];
      let ruleLabels: string[] | null = null;
      let tupleSeeds = '';
      if (typeof body.srl === 'string' && body.srl.trim()) {
        try {
          const document = expandIris(parseRuleSet(body.srl, { tuples: useTuples }));
          const ruleDocs = splitRuleSet(document);
          rules = ruleDocs.map((d) => d.text);
          ruleLabels = ruleDocs.map((d) => d.suggestedLabel);
          dataBlocks = splitDataBlocks(document).map((d) => d.text);
          if (typeof body.tupleSeeds === 'string' && body.tupleSeeds.trim()) {
            if (!useTuples) {
              return reply.status(400).send({
                error: 'Initial named tuples require the rule-tuples extension to be enabled',
              });
            }
            // Seeds are expanded against the document's prologue and stored in
            // the canonical, prologue-free form the executor reads.
            const prologue = extractPrologueText(body.srl);
            tupleSeeds = generateTupleSeeds(
              parseTupleSeeds(prologue ? `${prologue}\n${body.tupleSeeds}` : body.tupleSeeds, { tuples: true }),
            );
          }
        } catch (error__u: unknown) {
          const error = toError(error__u);
          return reply.status(400).send({ error: error?.message || 'Invalid SRL document' });
        }
      }

      const inferenceFormat = typeof body.inferenceFormat === 'string' && body.inferenceFormat.trim().length > 0
        ? body.inferenceFormat
        : 'application/n-triples';
      const maxIterations = typeof body.maxIterations === 'number' && body.maxIterations > 0
        ? body.maxIterations
        : undefined;

      if (rules.length === 0 && dataBlocks.length === 0) {
        return reply.status(400).send({ error: 'At least one rule or data block is required' });
      }

      const errors: string[] = [];
      /*
       * The ephemeral rule set these parts hang off. `mintId` already returns
       * `urn:sqlib:ruleset:<uuid>`, so prefixing it again gave every part of a
       * playground run a doubled URN — and those ids are what a result is
       * attributed to on screen. The parts are named under it positionally;
       * a rule the SRL names carries its own IRI on the execution record
       * (`RuleExecutionRecord.ruleIri`), which is what the reader is shown.
       */
      const ruleSetId = mintId('ruleset');
      const now = new Date().toISOString();

      const dataBlockVersions: LdkitDataBlockVersion[] = dataBlocks.map((source, idx) => {
        const payload = buildValidationPayload(source);
        if (!payload.grammarValid) {
          errors.push(`Data block ${idx + 1} invalid: ${payload.error ?? 'Unknown error'}`);
        }
        return {
          $id: `${ruleSetId}:data-${idx + 1}`,
          '@type': 'DataBlockVersion',
          isPartOf: ruleSetId,
          version: idx + 1,
          dataString: source ?? '',
          normalizedInsertData: payload.normalized ?? null,
          grammarValid: payload.grammarValid,
          grammarType: payload.grammarType ?? null,
          grammarValidations: payload.grammarValidations ?? null,
          validationError: payload.error ?? null,
          dateCreated: now,
          dateModified: now,
        };
      });

      const ruleVersions: LdkitRuleVersion[] = rules.map((source, idx) => {
        const payload = buildValidationPayload(source);
        if (!payload.grammarValid) {
          errors.push(`Rule ${idx + 1} invalid: ${payload.error ?? 'Unknown error'}`);
        }
        return {
          $id: `${ruleSetId}:rule-${idx + 1}`,
          '@type': 'RuleVersion',
          isPartOf: ruleSetId,
          version: idx + 1,
          ruleString: source ?? '',
          normalizedInsert: payload.normalized ?? null,
          grammarValid: payload.grammarValid,
          grammarType: payload.grammarType ?? null,
          grammarValidations: payload.grammarValidations ?? null,
          validationError: payload.error ?? null,
          dateCreated: now,
          dateModified: now,
        };
      });

      if (errors.length > 0) {
        return reply.status(400).send({ error: errors.join('; ') });
      }

      const ruleSetVersion: LdkitRuleSetVersion = {
        $id: `${ruleSetId}:version-1`,
        '@type': 'RuleSetVersion',
        isPartOf: ruleSetId,
        version: 1,
        hasRule: ruleVersions.map((rv) => rv.$id),
        hasDataBlock: dataBlockVersions.map((db) => db.$id),
        tupleSeeds: tupleSeeds || undefined,
        tuplesEnabled: useTuples,
        dateCreated: now,
        dateModified: now,
      };

      // Compute stratification for the prepared rules
      try {
        const stratifier = new RuleStratifier();
        const report = stratifier.analyzeRuleVersions(ruleVersions);
        ruleSetVersion.stratificationReport = JSON.stringify(report);
      } catch (error) {
        request.log.warn({ err: error }, '[Playground] Stratification analysis failed; proceeding without persisted report');
      }

      // The data graph: the base graph these rules run against. Resolved
      // before anything ephemeral is registered so a bad input is a clean 400
      // rather than a 400 with a half-populated cache behind it.
      let dataGraph: ResolvedDataGraph | null = null;
      try {
        dataGraph = resolveDataGraphInput(body);
      } catch (error) {
        if (error instanceof DataGraphContentError) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }

      const ephemeralIds: string[] = [];
      try {
        dataBlockVersions.forEach((db) => {
          cacheCoordinator.addEphemeral(db, 'DataBlockVersion');
          ephemeralIds.push(db.$id);
        });
        ruleVersions.forEach((rv) => {
          cacheCoordinator.addEphemeral(rv, 'RuleVersion');
          ephemeralIds.push(rv.$id);
        });

        const executor = new RuleSetExecutor();
        const result = await executor.execute(ruleSetVersion, {
          maxIterations,
          inferenceFormat,
          initialGraph: dataGraph?.content ?? null,
          initialGraphFormat: dataGraph?.format ?? null,
        });
        // Named from the document where there is one, so results say
        // `rule-2-ancestorOf` rather than a position in a list the author
        // never made.
        const ruleNames = Object.fromEntries(
          ruleVersions.map((rv, idx) => [rv.$id, ruleLabels?.[idx] ?? `Rule ${idx + 1}`]),
        );
        return reply.send({ ...result, ruleNames });
      } catch (error__u: unknown) {
      const error = toError(error__u);
        request.log.error({ err: error }, 'Failed to execute playground rules');
        const message = error?.message || 'Failed to execute playground rules';
        return reply.status(500).send({ error: message });
      } finally {
        ephemeralIds.forEach((id) => cacheCoordinator.removeEphemeral(id));
      }
    },
  );

  fastify.post('/etl/execute', ...typedRoute({
      tags: ['ETL'],
      summary: 'Execute ETL in playground (inline SQL + template + mapping)',
      body: {
        type: 'object',
        required: ['sql', 'sparqlTemplate', 'backendId', 'columns'],
        properties: {
          sql: { type: 'string' },
          sparqlTemplate: { type: 'string' },
          backendId: { type: 'string' },
          columns: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['columnName', 'targetVariable', 'termType', 'nullPolicy'],
              properties: {
                columnName: { type: 'string' },
                targetVariable: { type: 'string' },
                termType: { type: 'string', enum: ['uri', 'literal'] },
                datatypeIri: { type: 'string' },
                lang: { type: 'string' },
                iriTemplate: { type: 'string' },
                nullPolicy: { type: 'string', enum: ['undef', 'skipRow'] },
              },
              additionalProperties: false,
            },
          },
          chunkSize: { type: 'integer' },
          maxRows: { type: 'integer' },
          dryRun: { type: 'boolean' },
          outputFormat: { type: 'string' },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string' },
            rdfOutput: { type: 'string' },
            contentType: { type: 'string' },
            errorMessage: { type: 'string' },
            totalChunks: { type: 'integer' },
            completedChunks: { type: 'integer' },
            totalRows: { type: 'integer' },
            timing: {
              type: 'object',
              properties: {
                totalMs: { type: 'integer' },
                sqlMs: { type: 'integer' },
                sqlInitMs: { type: 'integer' },
                sqlConnectionMs: { type: 'integer' },
                sqlQueryMs: { type: 'integer' },
                sqlSerializeMs: { type: 'integer' },
                bindingMs: { type: 'integer' },
                sparqlMs: { type: 'integer' },
              },
            },
          },
        },
        400: responseErrorSchema,
        404: responseErrorSchema,
      },
  }, async (request, reply) => {
    const flags = getFeatureFlags();
    if (!flags.playgroundEtl) {
      return reply.status(404).send({ error: 'ETL playground feature is disabled' });
    }

    /*
     * The other playground routes take a query or a rule set and run it against
     * a backend the caller may already reach. This one takes arbitrary DuckDB
     * SQL, which is a host filesystem read primitive and — with httpfs granted —
     * an outbound request one, so "authenticated" is the wrong bar for it: it is
     * administrator-only, the same as `/etl-jobs/preview`. Under
     * SQLIB_AUTH_MODE=disabled the context carries full access and this is a
     * no-op, which is why the ETL feature flag ships off. Issue #132 §4d.
     */
    requireAdmin(request, 'executing ETL SQL');

    const body = request.body;
    const sql = String(body.sql ?? '');
    const sparqlTemplate = String(body.sparqlTemplate ?? '');
    const backendId = String(body.backendId ?? '');
    const columns = Array.isArray(body.columns) ? body.columns : [];

    if (!sql.trim() || !sparqlTemplate.trim() || !backendId.trim()) {
      return reply.status(400).send({ error: 'sql, sparqlTemplate, and backendId are required' });
    }
    if (!Array.isArray(columns) || columns.length === 0) {
      return reply.status(400).send({ error: 'At least one column mapping is required' });
    }

    const columnDefs = normalizeColumnDefinitions(columns as ColumnDefinition[]);
    const backendUrn = toUrn('backend', backendId);

    // Ephemeral IDs (dummy entities for observability / parity with rules playground)
    const etlJobId = `urn:sqlib:playground:etl-job:${mintId('etlJob')}`;
    const etlJobVersionId = `${etlJobId}:version:1`;
    const mappingId = `${etlJobVersionId}:mapping`;
    const mappingVersionId = `${mappingId}:version:1`;

    const now = new Date().toISOString();
    const ephemeralIds: string[] = [];
    let ephemeralStoreId: string | null = null;

    try {
      const etlJob: LdkitEtlJob = {
        $id: etlJobId,
        '@type': 'EtlJob',
        name: 'Playground ETL Job',
        description: null,
        isPartOf: [],
        currentVersion: etlJobVersionId,
        dateCreated: now,
        dateModified: now,
      };

      const etlJobVersion: LdkitEtlJobVersion = {
        $id: etlJobVersionId,
        '@type': 'EtlJobVersion',
        isPartOf: etlJobId,
        version: 1,
        sql,
        sparqlTemplate,
        backendId: backendUrn,
        currentColumnMappingVersion: mappingVersionId,
        chunkSize: typeof body.chunkSize === 'number' ? body.chunkSize : undefined,
        dateCreated: now,
        dateModified: now,
      };

      const mappingVersion: LdkitEtlColumnMappingVersion = {
        $id: mappingVersionId,
        '@type': 'EtlColumnMappingVersion',
        isPartOf: mappingId,
        version: 1,
        columns: JSON.stringify(columnDefs),
        dateCreated: now,
        dateModified: now,
      };

      cacheCoordinator.addEphemeral(etlJob, 'EtlJob');
      ephemeralIds.push(etlJobId);
      cacheCoordinator.addEphemeral(etlJobVersion, 'EtlJobVersion');
      ephemeralIds.push(etlJobVersionId);
      cacheCoordinator.addEphemeral(mappingVersion, 'EtlColumnMappingVersion');
      ephemeralIds.push(mappingVersionId);

      const parser = new SparqlQueryParser();
      // Playground runs caller-supplied definitions, so there is no curated
      // library to imply backend access: a real backend needs an explicit grant.
      const executorFactory = new ExecutorFactory({ request });

      const executor = backendUrn === EPHEMERAL_BACKEND_ID
        ? (() => {
          ephemeralStoreId = `ephemeral-etl-${crypto.randomUUID()}`;
          const store = oxigraphStoreManager.createEphemeralStore(ephemeralStoreId);
          return new OxigraphSparqlExecutor(store);
        })()
        : await executorFactory.getExecutorForBackendId(backendUrn);

      const chunkSize = typeof body.chunkSize === 'number' && body.chunkSize > 0 ? body.chunkSize : 1000;
      const maxRows = typeof body.maxRows === 'number' && body.maxRows > 0 ? body.maxRows : undefined;
      const dryRun = typeof body.dryRun === 'boolean' ? body.dryRun : false;
      const outputFormat = typeof body.outputFormat === 'string' && body.outputFormat.trim()
        ? body.outputFormat.trim()
        : 'text/turtle';

      // Timing information
      const timingStart = performance.now();
      let sqlTimeMs = 0;
      let sqlInitMs = 0;
      let sqlConnectionMs = 0;
      let sqlQueryMs = 0;
      let sqlSerializeMs = 0;
      let bindingTimeMs = 0;
      let sparqlTimeMs = 0;

      const rdfOutputs: string[] = [];
      let completedChunks = 0;
      let totalRows = 0;
      let contentType = outputFormat; // Use requested format

      // One streamed execution of the SQL, re-batched to chunkSize (#201).
      for await (const { rows, timing: sqlTiming } of duckDbService.streamChunks(sql, chunkSize)) {
        sqlTimeMs += sqlTiming.totalMs;
        sqlInitMs += sqlTiming.initMs;
        sqlConnectionMs += sqlTiming.connectionMs;
        sqlQueryMs += sqlTiming.queryMs;
        sqlSerializeMs += sqlTiming.serializeMs;

        totalRows += rows.length;

        const bindingStart = performance.now();
        const bindings = etlService.convertRowsToBindings(rows, columnDefs);
        bindingTimeMs += performance.now() - bindingStart;

        if (bindings.length > 0) {
          const argSet = bindingsToArgumentSet(bindings, columnDefs);
          const query = parser.applyArguments(sparqlTemplate, [argSet]);

          const sparqlStart = performance.now();
          // Request output in the specified format
          const { result, contentType: ct } = await executor.constructQueryParsed(query, {
            acceptHeader: outputFormat,
          });
          sparqlTimeMs += performance.now() - sparqlStart;

          if (ct) {
            contentType = ct;
          }
          if (typeof result === 'string') {
            rdfOutputs.push(result);
          }
        }

        completedChunks++;

        if (dryRun) break;

        if (maxRows && totalRows >= maxRows) break;
      }

      const totalTimeMs = performance.now() - timingStart;
      const chunks = completedChunks;

      // Log timing breakdown
      request.log.info({
        etlTiming: {
          totalMs: Math.round(totalTimeMs),
          sqlMs: Math.round(sqlTimeMs),
          sqlInitMs: Math.round(sqlInitMs),
          sqlConnectionMs: Math.round(sqlConnectionMs),
          sqlQueryMs: Math.round(sqlQueryMs),
          sqlSerializeMs: Math.round(sqlSerializeMs),
          bindingMs: Math.round(bindingTimeMs),
          sparqlMs: Math.round(sparqlTimeMs),
          overheadMs: Math.round(totalTimeMs - sqlTimeMs - bindingTimeMs - sparqlTimeMs),
          sqlOverheadMs: Math.round(sqlTimeMs - sqlInitMs - sqlConnectionMs - sqlQueryMs - sqlSerializeMs),
          rows: totalRows,
          chunks,
        },
      }, '[ETL Playground] Execution timing breakdown');

      return reply.send({
        status: 'completed',
        rdfOutput: rdfOutputs.join('\n'),
        contentType,
        totalChunks: chunks,
        completedChunks: chunks,
        totalRows,
        timing: {
          totalMs: Math.round(totalTimeMs),
          sqlMs: Math.round(sqlTimeMs),
          sqlInitMs: Math.round(sqlInitMs),
          sqlConnectionMs: Math.round(sqlConnectionMs),
          sqlQueryMs: Math.round(sqlQueryMs),
          sqlSerializeMs: Math.round(sqlSerializeMs),
          bindingMs: Math.round(bindingTimeMs),
          sparqlMs: Math.round(sparqlTimeMs),
        },
      });

    } catch (error__u: unknown) {
      const error = toError(error__u);
      return reply.send({
        status: 'failed',
        errorMessage: error?.message || 'ETL execution failed',
      });
    } finally {
      if (ephemeralStoreId) {
        oxigraphStoreManager.destroyEphemeralStore(ephemeralStoreId);
      }
      // reverse order just to be safe
      [...ephemeralIds].reverse().forEach((id) => cacheCoordinator.removeEphemeral(id));
    }
  }));
}
