import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import {
  sparqlQuerystringJsonSchema,
  sparqlRecordQuerystringJsonSchema,
  sparqlRequestJsonSchema,
} from '@sparql-query-lib/contracts/schema/routes';
import { HttpSparqlExecutor } from '../server/HttpSparqlExecutor.js';
import type { ISparqlExecutor } from '../server/ISparqlExecutor.js';
import { toError } from '../lib/toError.js';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import { ReadOnlySparqlExecutor } from '../server/ReadOnlySparqlExecutor.js';
import { Backends } from '../persistence/utils/BackendUtils.js';
import { backendTypeIriToKey, queryMethodIriToKey, resolveOxigraphConfig } from '../persistence/schemas/BackendSchema.js';
import { resolveBackendEnvAuth } from '../lib/backendAuth.js';
import { detectSparqlOperation } from '../lib/queryTypeDetector.js';
import type { SparqlOperation } from '../lib/queryTypeDetector.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import { getQueryTypeKeyFromIri } from '../lib/queryTypes.js';
import { EPHEMERAL_BACKEND_ID, LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import { oxigraphStoreManager } from '../lib/OxigraphStoreManager.js';
import * as crypto from 'crypto';
import { typedRoute } from './route-helpers.js';
import { AuthorizationError, isAdmin, requireBackendMode } from '../auth/enforce.js';
import { applyExecutionArguments } from '../lib/executionArguments.js';
import { ArgumentSetService } from '../lib/ArgumentSetService.js';
import { describeParameterKey, scalarParameterKey, tableParameterKey } from '@sparql-query-lib/types';
import { recordPassthroughUpdate } from '../lib/patchService.js';
import { UnsupportedUpdateError } from '@sparql-query-lib/rdf-delta';
import { clientId, toPatchView } from './patches.js';

const errorResponseSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
} as const;

/**
 * The SPARQL request shape, shared by POST (body) and GET (querystring).
 *
 * Declared in `packages/contracts` beside the other request bodies with no
 * entity behind them (issue #65 Phase B), rather than as the module-local
 * literal it used to be. The MCP server's `sparql.proxyQuery` tool imports the
 * same object, so the document the tool publishes and the one this route
 * enforces are the same object rather than two that a test has to keep equal.
 *
 * Re-exported because `test/contracts/web-leaf-parity.test.ts` reads it from
 * here, as the document this route registers.
 */
export { sparqlRequestJsonSchema as sparqlRequestSchema } from '@sparql-query-lib/contracts/schema/routes';

const sparqlResponses = {
  200: {},
  400: errorResponseSchema,
  404: errorResponseSchema,
  500: errorResponseSchema,
} as const;

const sparqlPostSchema = {
  tags: ['SPARQL'],
  summary: 'Execute raw SPARQL query (POST)',
  body: sparqlRequestJsonSchema,
  // `?record=patch` is a query-string switch on both verbs; see the schema.
  querystring: sparqlRecordQuerystringJsonSchema,
  response: sparqlResponses,
} as const;

const sparqlGetSchema = {
  tags: ['SPARQL'],
  summary: 'Execute raw SPARQL query (GET)',
  querystring: sparqlQuerystringJsonSchema,
  response: sparqlResponses,
} as const;

// Simple SPARQL proxy endpoint
export default async function (
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {

  const resolveContentType = (explicit: string | undefined | null, fallback: string | undefined, defaultType: string) => {
    if (explicit && explicit.trim().length > 0) return explicit;
    if (fallback && fallback.trim().length > 0 && fallback !== '*/*') return fallback;
    return defaultType;
  };

  const setTimingHeader = (reply: FastifyReply, duration?: number) => {
    if (duration === undefined) return;
    reply.header('Server-Timing', `db;dur=${duration.toFixed(2)}`);
  };

  const resolveExecutor = async (params: {
    backendId?: string | null;
    endpoint?: string | null;
    queryMethod?: 'post' | 'get' | null;
    request: FastifyRequest;
    isUpdate: boolean;
  }): Promise<{ executor: ISparqlExecutor; ephemeralStoreId: string | null }> => {
    const { backendId, endpoint, queryMethod, request, isUpdate } = params;

    // Raw SPARQL is ad-hoc by definition: no saved entity, so no library can
    // imply access here. Every real backend needs an explicit grant.
    const mode = isUpdate ? 'write' : 'use';

    if (endpoint) {
      // An arbitrary endpoint bypasses the backend registry — and every grant
      // attached to it — and reaches whatever network sqlib sits in.
      if (!isAdmin(request)) {
        throw new AuthorizationError(
          'Executing against an arbitrary endpoint requires administrator access; use a registered backendId.'
        );
      }
      const method: 'post' | 'get' = queryMethod === 'get' ? 'get' : 'post';
      return {
        executor: new HttpSparqlExecutor({
          queryUrl: endpoint,
          updateUrl: endpoint,
          queryMethod: method,
        }),
        ephemeralStoreId: null,
      };
    }

    if (backendId === LIBRARY_STORAGE_BACKEND_ID) {
      // Holds the auth graph and every entity; reachable only through the
      // entity layer, never as a raw SPARQL target.
      if (!isAdmin(request)) {
        throw new AuthorizationError('The library storage backend is reserved for administrators.');
      }
    } else if (backendId) {
      requireBackendMode(request, backendId, mode);
    }

    if (backendId === EPHEMERAL_BACKEND_ID) {
      const ephemeralStoreId = `ephemeral-sparql-${crypto.randomUUID()}`;
      const store = oxigraphStoreManager.createEphemeralStore(ephemeralStoreId);
      return {
        executor: new OxigraphSparqlExecutor(store),
        ephemeralStoreId,
      };
    }

    const backend = await Backends.findByIri(backendId!);
    if (!backend) {
      throw Object.assign(new Error(`Backend not found: ${backendId}`), { statusCode: 404 });
    }

    const backendTypeKey = backendTypeIriToKey(backend.backendType);
    if (!backendTypeKey) {
      throw Object.assign(new Error(`Unsupported backend type: ${backend.backendType}`), { statusCode: 400 });
    }

    if (backendTypeKey === 'http') {
      const backendEndpoint = backend.endpoint;
      if (!backendEndpoint) {
        throw Object.assign(new Error('HTTP backend missing endpoint'), { statusCode: 400 });
      }
      const envAuth = resolveBackendEnvAuth(backend.authEnvKey);
      const queryMethodKey = backend.queryMethod
        ? queryMethodIriToKey(backend.queryMethod)
        : 'post';
      return {
        executor: new HttpSparqlExecutor({
          queryUrl: backendEndpoint,
          updateUrl: backendEndpoint,
          username: envAuth.username,
          password: envAuth.password,
          authHeader: envAuth.authHeader,
          queryMethod: queryMethodKey,
        }),
        ephemeralStoreId: null,
      };
    }

    if (backendTypeKey === 'oxigraphEphemeral') {
      const store = oxigraphStoreManager.getEphemeralStore(backend.$id) ??
        oxigraphStoreManager.createEphemeralStore(backend.$id);
      return {
        executor: new OxigraphSparqlExecutor(store),
        ephemeralStoreId: null,
      };
    }

    if (backendTypeKey === 'oxigraphMemory') {
      const oxigraphConfig = resolveOxigraphConfig(backend.oxigraphConfig, backend.$id)
        ?? { storeType: 'ephemeral' as const, mode: 'readOnly' as const };
      const store = oxigraphStoreManager.getMemoryStore(backend.$id)
        ?? await oxigraphStoreManager.createMemoryStore(backend.$id, oxigraphConfig);
      const executor = new OxigraphSparqlExecutor(store);
      // Same guard the executor factory applies, and for the same reason: the
      // store has no read-only flag of its own, so an unguarded handle here
      // would accept updates that the next reload discards.
      const mode = oxigraphConfig.mode ?? 'readOnly';
      return {
        executor: mode === 'readOnly' ? new ReadOnlySparqlExecutor(executor, backend.$id) : executor,
        ephemeralStoreId: null,
      };
    }

    throw Object.assign(new Error(`Unsupported backend type: ${backend.backendType}`), { statusCode: 400 });
  };

  /**
   * Run an update the caller asked to have recorded.
   *
   * The proxy keeps executing the update itself — same executor, same grants,
   * same string — and `recordPassthroughUpdate` wraps that call with the
   * derivation before it and the record after it. What changes for the caller
   * is only the answer: a recorded update returns the patch (and its id in a
   * header) instead of `204`, because a caller that asked for a record wants to
   * be told which one it got.
   */
  const runRecordedUpdate = async (params: {
    request: FastifyRequest;
    reply: FastifyReply;
    executor: ISparqlExecutor;
    backendId: string;
    updateString: string;
  }) => {
    const { request, reply, executor, backendId, updateString } = params;
    let duration: number | undefined;

    const patch = await recordPassthroughUpdate({
      backendId,
      updateString,
      origin: clientId(request),
      run: async () => {
        ({ duration } = await executor.update(updateString));
      },
    });

    setTimingHeader(reply, duration);
    reply.header('X-Sqlib-Patch-Id', patch.$id);
    return reply.send(toPatchView(patch));
  };

  /**
   * Whether this request may be recorded at all, answered before anything runs.
   *
   * Both refusals are the same refusal: a patch belongs to a registered
   * backend. An arbitrary `endpoint` has no entity to hang a log off, and a read
   * has no diff to record — and since `record=patch` is a request not to lose
   * the write, neither case is quietly ignored.
   */
  const rejectUnrecordableRequest = (params: {
    operation: SparqlOperation;
    backendId?: string | null;
    endpoint?: string | null;
  }): string | null => {
    if (params.operation !== QueryTypeIri.update) {
      return 'record=patch applies to updates only; a read changes nothing there is a patch of.';
    }
    if (params.endpoint || !params.backendId) {
      return 'record=patch requires a registered backendId: a patch log belongs to a backend, and an ad-hoc endpoint has none.';
    }
    return null;
  };

  // POST /sparql - Direct SPARQL proxy
  fastify.post('/sparql', ...typedRoute(sparqlPostSchema, async (request, reply) => {
    const { query, backendId, endpoint, queryMethod, arguments: inlineArguments, limits, offsets, argumentSetIds } = request.body;
    const acceptHeader = request.headers.accept;
    const recordPatch = request.query.record === 'patch';

    let ephemeralStoreId: string | null = null;
    try {
      // Detect before resolving: reads and updates need different grants, so the
      // operation has to be known before an executor is handed out.
      let operation: SparqlOperation;
      try {
        operation = detectSparqlOperation(query);
      } catch (error__u: unknown) {
      const error = toError(error__u);
        return reply.code(400).send({ error: error?.message || 'Invalid SPARQL query' });
      }

      /*
       * The query as it will actually run.
       *
       * Detection reads the query the caller wrote — substituting VALUES rows
       * cannot turn a SELECT into anything else, and the grant a raw query
       * needs must not depend on the arguments attached to it.
       *
       * `ArgumentApplicationError` carries a 400, which the catch below reads,
       * so a payload that does not fit the query is answered as the caller's
       * mistake rather than a proxy failure.
       */
      /*
       * A stored set may be named here too, and completed by inline values for
       * whatever it leaves open — the same rule `/execute` applies. Without it
       * a raw run of an edited query had to flatten its set client-side, which
       * is the one place the two paths disagreed about what an argument set is.
       */
      let argumentSets = inlineArguments;
      let effectiveLimits = limits;
      let effectiveOffsets = offsets;
      if (Array.isArray(argumentSetIds) && argumentSetIds.length > 0) {
        const stored = await new ArgumentSetService().exportRuntimePayload(argumentSetIds);
        const filled = stored.filledParameters;
        const conflicts: string[] = [];
        for (const argSet of inlineArguments ?? []) {
          const vars = Array.isArray(argSet?.head?.vars) ? argSet.head.vars : [];
          if (vars.length && filled.has(tableParameterKey(vars))) {
            conflicts.push(describeParameterKey(tableParameterKey(vars)));
          }
        }
        for (const limit of limits ?? []) {
          if (filled.has(scalarParameterKey('limit', limit.name))) {
            conflicts.push(describeParameterKey(scalarParameterKey('limit', limit.name)));
          }
        }
        for (const offset of offsets ?? []) {
          if (filled.has(scalarParameterKey('offset', offset.name))) {
            conflicts.push(describeParameterKey(scalarParameterKey('offset', offset.name)));
          }
        }
        if (conflicts.length) {
          return reply.code(400).send({
            error: `The named argument set already fills ${conflicts.join(', ')}; `
              + 'supply a value only for a parameter it leaves open.',
          });
        }
        argumentSets = [...stored.tupleList, ...(inlineArguments ?? [])];
        effectiveLimits = [...stored.limits, ...(limits ?? [])];
        effectiveOffsets = [...stored.offsets, ...(offsets ?? [])];
      }

      const executedQuery = applyExecutionArguments(query, {
        argumentSets,
        limits: effectiveLimits,
        offsets: effectiveOffsets,
      });

      if (recordPatch) {
        const refusal = rejectUnrecordableRequest({ operation, backendId, endpoint });
        if (refusal) return reply.code(400).send({ error: refusal });
      }

      const resolved = await resolveExecutor({
        backendId,
        endpoint,
        queryMethod,
        request,
        isUpdate: operation === QueryTypeIri.update,
      });
      const executor = resolved.executor;
      ephemeralStoreId = resolved.ephemeralStoreId;

      switch (operation) {
        case QueryTypeIri.select: {
          const { result: selectResult, duration: selectDuration, contentType: selectContentType } =
            await executor.selectQueryParsed(executedQuery, { acceptHeader });
          reply.header('Content-Type', resolveContentType(selectContentType, acceptHeader, 'application/sparql-results+json'));
          setTimingHeader(reply, selectDuration);
          return reply.send(selectResult);
        }
        case QueryTypeIri.construct:
        case QueryTypeIri.describe: {
          const { result: constructResult, duration: constructDuration, contentType: constructContentType } =
            await executor.constructQueryParsed(executedQuery, { acceptHeader });
          reply.header('Content-Type', resolveContentType(constructContentType, acceptHeader, 'application/n-triples'));
          setTimingHeader(reply, constructDuration);
          return reply.send(constructResult);
        }
        case QueryTypeIri.ask: {
          const { result: askResult, duration: askDuration, contentType: askContentType } =
            await executor.askQuery(executedQuery, { acceptHeader });
          reply.header('Content-Type', resolveContentType(askContentType, acceptHeader, 'application/sparql-results+json'));
          setTimingHeader(reply, askDuration);
          if (typeof askResult === 'boolean') {
            return reply.send({ head: {}, boolean: askResult });
          }
          return reply.send(askResult);
        }
        case QueryTypeIri.update: {
          if (recordPatch) {
            return await runRecordedUpdate({
              request,
              reply,
              executor,
              backendId: backendId!,
              updateString: executedQuery,
            });
          }
          const { duration: updateDuration } = await executor.update(executedQuery);
          setTimingHeader(reply, updateDuration);
          return reply.code(204).send();
        }
        default:
          return reply.code(400).send({ error: `Unsupported SPARQL query type: ${getQueryTypeKeyFromIri(operation) || operation}` });
      }

    } catch (error__u: unknown) {
      const error = toError(error__u);
      fastify.log.error({
        err: error,
        message: error?.message,
        stack: error?.stack,
      }, 'SPARQL proxy error');
      const statusCode = typeof error?.statusCode === 'number'
        ? error.statusCode
        // An update form the derivation cannot express is the caller's SPARQL,
        // not a proxy failure — and with `record=patch` it stops the write.
        : error instanceof UnsupportedUpdateError ? 400 : 500;
      return reply.code(statusCode).send({ error: error?.message || 'Internal server error' });
    } finally {
      if (ephemeralStoreId) {
        oxigraphStoreManager.destroyEphemeralStore(ephemeralStoreId);
      }
    }
  }));

  // GET /sparql - Direct SPARQL proxy with query parameters
  fastify.get('/sparql', ...typedRoute(sparqlGetSchema, async (request, reply) => {
    const { query, backendId, endpoint, queryMethod, record } = request.query;
    const acceptHeader = request.headers.accept;
    const recordPatch = record === 'patch';

    let ephemeralStoreId: string | null = null;
    try {
      // Detect before resolving: reads and updates need different grants, so the
      // operation has to be known before an executor is handed out.
      let operation: SparqlOperation;
      try {
        operation = detectSparqlOperation(query);
      } catch (error__u: unknown) {
      const error = toError(error__u);
        return reply.code(400).send({ error: error?.message || 'Invalid SPARQL query' });
      }

      if (recordPatch) {
        const refusal = rejectUnrecordableRequest({ operation, backendId, endpoint });
        if (refusal) return reply.code(400).send({ error: refusal });
      }

      const resolved = await resolveExecutor({
        backendId,
        endpoint,
        queryMethod,
        request,
        isUpdate: operation === QueryTypeIri.update,
      });
      const executor = resolved.executor;
      ephemeralStoreId = resolved.ephemeralStoreId;

      switch (operation) {
        case QueryTypeIri.select: {
          const { result: selectResult, duration: selectDuration, contentType: selectContentType } =
            await executor.selectQueryParsed(query, { acceptHeader });
          reply.header('Content-Type', resolveContentType(selectContentType, acceptHeader, 'application/sparql-results+json'));
          setTimingHeader(reply, selectDuration);
          return reply.send(selectResult);
        }
        case QueryTypeIri.construct:
        case QueryTypeIri.describe: {
          const { result: constructResult, duration: constructDuration, contentType: constructContentType } =
            await executor.constructQueryParsed(query, { acceptHeader });
          reply.header('Content-Type', resolveContentType(constructContentType, acceptHeader, 'application/n-triples'));
          setTimingHeader(reply, constructDuration);
          return reply.send(constructResult);
        }
        case QueryTypeIri.ask: {
          const { result: askResult, duration: askDuration, contentType: askContentType } =
            await executor.askQuery(query, { acceptHeader });
          reply.header('Content-Type', resolveContentType(askContentType, acceptHeader, 'application/sparql-results+json'));
          setTimingHeader(reply, askDuration);
          if (typeof askResult === 'boolean') {
            return reply.send({ head: {}, boolean: askResult });
          }
          return reply.send(askResult);
        }
        case QueryTypeIri.update: {
          if (recordPatch) {
            return await runRecordedUpdate({
              request,
              reply,
              executor,
              backendId: backendId!,
              updateString: query,
            });
          }
          const { duration: updateDuration } = await executor.update(query);
          setTimingHeader(reply, updateDuration);
          return reply.code(204).send();
        }
        default:
          return reply.code(400).send({ error: `Unsupported SPARQL query type: ${getQueryTypeKeyFromIri(operation) || operation}` });
      }

    } catch (error__u: unknown) {
      const error = toError(error__u);
      fastify.log.error({
        err: error,
        message: error?.message,
        stack: error?.stack,
      }, 'SPARQL proxy error');
      const statusCode = typeof error?.statusCode === 'number'
        ? error.statusCode
        // An update form the derivation cannot express is the caller's SPARQL,
        // not a proxy failure — and with `record=patch` it stops the write.
        : error instanceof UnsupportedUpdateError ? 400 : 500;
      return reply.code(statusCode).send({ error: error?.message || 'Internal server error' });
    } finally {
      if (ephemeralStoreId) {
        oxigraphStoreManager.destroyEphemeralStore(ephemeralStoreId);
      }
    }
  }));
}
