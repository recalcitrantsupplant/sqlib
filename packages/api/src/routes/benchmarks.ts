import type { FastifyInstance } from 'fastify';
import {
  benchmarkRunResponseJsonSchema,
  benchmarkRouteSchemas,
} from '@sparql-query-lib/contracts/schema/routes';
// The entity documents these routes `$ref` come from the entity model now, not
// from the C1 snapshot that used to carry the same `$id`s (issue #65). See
// `ensureBenchmarkSchemasRegistered`.
import {
  benchmarkexperimentSchema as benchmarkExperimentJsonSchema,
  benchmarkexperimentversionSchema as benchmarkExperimentVersionJsonSchema,
  benchmarkiterationobservationSchema as benchmarkIterationObservationJsonSchema,
  benchmarknodeobservationSchema as benchmarkNodeObservationJsonSchema,
  benchmarkobservationSchema as benchmarkObservationJsonSchema,
  benchmarkrunSchema as benchmarkRunJsonSchema,
} from '@sparql-query-lib/contracts/schema';
import { BenchmarkExperimentService, assertBenchmarkVersionDependencies } from '../lib/BenchmarkExperimentService.js';
import { BenchmarkRunner } from '../lib/BenchmarkRunner.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import { findAllBenchmarkRuns, findBenchmarkRunById } from '../persistence/utils/BenchmarkRunUtils.js';
import { findAllBenchmarkObservations } from '../persistence/utils/BenchmarkObservationUtils.js';
import { findAllBenchmarkNodeObservations } from '../persistence/utils/BenchmarkNodeObservationUtils.js';
import { findAllBenchmarkNodeRuns } from '../persistence/utils/BenchmarkNodeRunUtils.js';
import { findAllBenchmarkIterationObservations } from '../persistence/utils/BenchmarkIterationObservationUtils.js';
import { findAllBenchmarkIterationRuns } from '../persistence/utils/BenchmarkIterationRunUtils.js';
import { reposRoute, withReposHandler, setEntityConcurrencyHeaders, validateIfMatch } from './route-helpers.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';

const experimentService = new BenchmarkExperimentService();
const runner = new BenchmarkRunner();

type ErrorResponse = { error: string; [key: string]: unknown };

/**
 * Register the documents every benchmark response `$ref`s.
 *
 * These were the last four duplicate `$id`s in the codebase: `benchmarkrun`,
 * `benchmarkexperiment`, `benchmarkobservation` and `benchmarknodeobservation`
 * existed both in the C1 snapshot and in the entity model. Phase B2 removed the
 * fifth (`backend`) the same way; this is the rest.
 *
 * **Which one was winning, and why nothing was broken.** `index.ts` registers
 * every document in the hub barrel — the entity-model ones — before any route
 * plugin loads, and the loop below skips an `$id` that is already registered.
 * So the entity-model documents were already what every `$ref: 'benchmarkrun#'`
 * resolved to, and the snapshot exports were dead. Verified rather than
 * assumed: a run response carries `structure` today, although the snapshot
 * declares no such property and closes its property list.
 *
 * That is a good outcome and a fragile one. Nothing enforced the ordering, and
 * the two documents disagree materially — the snapshot's `benchmarkrun` has no
 * `structure`, `name` or `description` — so a plugin that happened to register
 * first would have silently truncated every benchmark run response. Importing
 * the entity documents directly makes the resolution explicit instead of a
 * consequence of boot order.
 *
 * Every `$ref` is in a response, never a request body, so `required`, `format`
 * and `readOnly` are annotations here. The wire is unchanged.
 *
 * `benchmarkiterationobservation` joined later and never had a snapshot twin —
 * it is listed here for the same reason as the rest, so the document a
 * `$ref` resolves to is chosen rather than inherited from boot order.
 */
function ensureBenchmarkSchemasRegistered(fastify: FastifyInstance) {
  const schemas = [
    benchmarkExperimentJsonSchema,
    benchmarkExperimentVersionJsonSchema,
    benchmarkRunJsonSchema,
    benchmarkObservationJsonSchema,
    benchmarkNodeObservationJsonSchema,
    benchmarkIterationObservationJsonSchema,
    benchmarkRunResponseJsonSchema,
  ] as const;
  const registered = fastify.getSchemas();
  for (const schema of schemas) {
    const schemaId = (schema as { $id?: string }).$id;
    if (schemaId && !(schemaId in registered)) {
      const { $schema, ...rest } = schema as Record<string, unknown>;
      fastify.addSchema(rest);
    }
  }
}

function stripSchemaMeta<T>(schema: T): T {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) {
    return schema.map((item) => stripSchemaMeta(item)) as unknown as T;
  }
  const cloned = { ...(schema as Record<string, unknown>) };
  delete (cloned as Record<string, unknown>).$schema;
  for (const [key, value] of Object.entries(cloned)) {
    cloned[key] = stripSchemaMeta(value);
  }
  return cloned as T;
}

export default async function benchmarkRoutes(fastify: FastifyInstance) {
  registerEntityAuthGuard(fastify, { executeSuffixes: ['/execute', '/execute/stream', '/run'], exemptSuffixes: ['/preview'] });

  ensureBenchmarkSchemasRegistered(fastify);

  fastify.get('/', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.list), async ({ reply }) => {
    return reply.send(experimentService.listExperiments());
  }));

  fastify.post('/', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.create), async ({ request, reply }) => {
    const payload = request.body;
    const created = await experimentService.createExperiment(payload);
    reply.code(201);
    return reply.send(created);
  }));

  fastify.get('/:id', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.get), async ({ request, reply }) => {
    const { id } = request.params;
    const detail = experimentService.getExperiment(id);
    if (!detail) {
      return reply.code(404).send({ error: `Benchmark experiment ${id} not found` });
    }
    setEntityConcurrencyHeaders(reply, detail);
    return reply.send(detail);
  }));

  fastify.put('/:id', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.update), async ({ request, reply }) => {
    const { id } = request.params;
    const existing = experimentService.getExperiment(id);
    if (!existing) {
      return reply.code(404).send({ error: `Benchmark experiment ${id} not found` });
    }
    const { valid, currentTag } = validateIfMatch(request, { dateModified: existing.dateModified });
    if (!valid) {
      return reply.code(412).send({ error: 'If-Match header does not match current entity tag' });
    }
    const payload = request.body;
    const updated = await experimentService.updateExperiment(id, payload);
    if (!updated) {
      return reply.code(404).send({ error: `Benchmark experiment ${id} not found` });
    }
    if (currentTag) reply.header('ETag', `"${currentTag.replace(/\"/g, '')}"`);
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(updated);
  }));

  fastify.delete('/:id', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.delete), async ({ request, reply }) => {
    const { id } = request.params;
    const existing = experimentService.getExperiment(id);
    if (!existing) {
      return reply.code(404).send({ error: `Benchmark experiment ${id} not found` });
    }
    await experimentService.deleteExperiment(id);
    return reply.code(204).send();
  }));

  fastify.get('/:id/v', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.listVersions), async ({ request, reply }) => {
    const { id } = request.params;
    return reply.send(experimentService.listVersions(id));
  }));

  fastify.post('/:id/v', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.createVersion), async ({ request, reply }) => {
    const { id } = request.params;
    const existing = experimentService.getExperiment(id);
    if (!existing) {
      return reply.code(404).send({ error: `Benchmark experiment ${id} not found` });
    }
    const payload = request.body;
    const created = await experimentService.createVersion(id, payload);
    reply.code(201);
    return reply.send(created);
  }));

  fastify.get('/:id/v/:version', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.getVersion), async ({ request, reply }) => {
    const { id, version } = request.params;
    const parsed = Number.parseInt(version, 10);
    const detail = experimentService.getVersion(id, parsed);
    if (!detail) {
      return reply.code(404).send({ error: `Benchmark experiment version ${id} v${version} not found` });
    }
    setEntityConcurrencyHeaders(reply, detail);
    return reply.send(detail);
  }));

  fastify.patch('/:id/v/:version', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.updateVersion), async ({ request, reply }) => {
    const { id, version } = request.params;
    const parsed = Number.parseInt(version, 10);
    const existing = experimentService.getVersion(id, parsed);
    if (!existing) {
      return reply.code(404).send({ error: `Benchmark experiment version ${id} v${version} not found` });
    }
    const { valid, currentTag } = validateIfMatch(request, { dateModified: existing.dateModified });
    if (!valid) {
      return reply.code(412).send({ error: 'If-Match header does not match current entity tag' });
    }
    try {
      const payload = request.body;
      const updated = await experimentService.updateVersion(id, parsed, payload);
      if (!updated) {
        return reply.code(404).send({ error: `Benchmark experiment version ${id} v${version} not found` });
      }
      if (currentTag) reply.header('ETag', `"${currentTag.replace(/\"/g, '')}"`);
      setEntityConcurrencyHeaders(reply, updated);
      return reply.send(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(409).send({ error: message });
    }
  }));

  fastify.get('/:id/v/:version/runs', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.listRuns), async ({ request, reply }) => {
    const { id, version } = request.params;
    const parsed = Number.parseInt(version, 10);
    const detail = experimentService.getVersion(id, parsed);
    if (!detail) {
      return reply.code(404).send({ error: `Benchmark experiment version ${id} v${version} not found` });
    }
    const runs = await findAllBenchmarkRuns();
    const filtered = runs
      .filter((run) => run.definedBy === detail.id)
      .sort((a, b) => (b.startedAt ?? b.dateCreated ?? '').localeCompare(a.startedAt ?? a.dateCreated ?? ''))
      .map((run) => toRestApi(run));
    return reply.send(filtered);
  }));

  fastify.post('/:id/v/:version/freeze', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.freezeVersion), async ({ request, reply }) => {
    const { id, version } = request.params;
    const parsed = Number.parseInt(version, 10);
    try {
      const detail = experimentService.getVersion(id, parsed);
      if (!detail) {
        return reply.code(404).send({ error: `Benchmark experiment version ${id} v${version} not found` });
      }
      assertBenchmarkVersionDependencies(detail.id, detail.subjectSpecs);
      const updated = await experimentService.updateVersion(id, parsed, { immutable: true });
      if (!updated) {
        return reply.code(404).send({ error: `Benchmark experiment version ${id} v${version} not found` });
      }
      setEntityConcurrencyHeaders(reply, updated);
      return reply.send(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(409).send({ error: message });
    }
  }));

  fastify.post('/:id/v/:version/run', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.runVersion), async ({ request, reply }) => {
    const { id, version } = request.params;
    const parsed = Number.parseInt(version, 10);
    const detail = experimentService.getVersion(id, parsed);
    if (!detail) {
      return reply.code(404).send({ error: `Benchmark experiment version ${id} v${version} not found` });
    }
    try {
      const result = await runner.runExperimentVersion(detail.id);
      const normalized = {
        ...result,
        run: toRestApi(result.run),
        nodeRun: result.nodeRun ? toRestApi(result.nodeRun) : null,
        iterationRun: result.iterationRun ? toRestApi(result.iterationRun) : null,
        observations: result.observations.map((obs) => toRestApi(obs)),
        nodeObservations: result.nodeObservations.map((obs) => toRestApi(obs)),
        iterationObservations: result.iterationObservations.map((obs) => toRestApi(obs)),
      };
      return reply.send(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(409).send({ error: message });
    }
  }));

  fastify.get('/runs/:id', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.getRun), async ({ request, reply }) => {
    const { id } = request.params;
    const run = await findBenchmarkRunById(id);
    if (!run) {
      return reply.code(404).send({ error: `Benchmark run ${id} not found` });
    }
    return reply.send(toRestApi(run));
  }));

  fastify.get('/runs/:id/observations', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.listRunObservations), async ({ request, reply }) => {
    const { id } = request.params;
    const run = await findBenchmarkRunById(id);
    if (!run) {
      return reply.code(404).send({ error: `Benchmark run ${id} not found` });
    }
    const observations = await findAllBenchmarkObservations();
    const filtered = observations
      .filter((obs) => obs.dataSet === id)
      .map((obs) => toRestApi(obs));
    return reply.send(filtered);
  }));

  fastify.get('/runs/:id/node-observations', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.listRunNodeObservations), async ({ request, reply }) => {
    const { id } = request.params;
    const run = await findBenchmarkRunById(id);
    if (!run) {
      return reply.code(404).send({ error: `Benchmark run ${id} not found` });
    }
    const nodeRuns = await findAllBenchmarkNodeRuns();
    const nodeRunIds = nodeRuns.filter((nodeRun) => nodeRun.isPartOf === id).map((nodeRun) => nodeRun.$id);
    if (!nodeRunIds.length) {
      return reply.send([]);
    }
    const nodeObservations = await findAllBenchmarkNodeObservations();
    const filtered = nodeObservations
      .filter((obs) => nodeRunIds.includes(obs.dataSet))
      .map((obs) => toRestApi(obs));
    return reply.send(filtered);
  }));

  /*
   * Where the time went inside a rule-set request, one row per pass of the
   * fixpoint loop. Sorted rather than returned in insertion order: a run's
   * passes are an ordered sequence, and every reader of them wants that order.
   */
  fastify.get('/runs/:id/iteration-observations', ...reposRoute(stripSchemaMeta(benchmarkRouteSchemas.listRunIterationObservations), async ({ request, reply }) => {
    const { id } = request.params;
    const run = await findBenchmarkRunById(id);
    if (!run) {
      return reply.code(404).send({ error: `Benchmark run ${id} not found` });
    }
    const iterationRuns = await findAllBenchmarkIterationRuns();
    const iterationRunIds = iterationRuns.filter((iterationRun) => iterationRun.isPartOf === id).map((iterationRun) => iterationRun.$id);
    if (!iterationRunIds.length) {
      return reply.send([]);
    }
    const iterationObservations = await findAllBenchmarkIterationObservations();
    const filtered = iterationObservations
      .filter((obs) => iterationRunIds.includes(obs.dataSet))
      .sort((a, b) => (a.subjectObservation === b.subjectObservation
        ? a.iterationIndex - b.iterationIndex
        : a.subjectObservation.localeCompare(b.subjectObservation)))
      .map((obs) => toRestApi(obs));
    return reply.send(filtered);
  }));
}
