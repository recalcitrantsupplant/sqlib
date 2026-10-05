/**
 * Every application route, registered under the feature flags that own it.
 *
 * A route belongs to the flag of the section that would be broken without it,
 * and is not registered at all when that flag is off: a 404 from the router,
 * rather than a handler that answers "feature disabled". The exceptions are
 * stated where they are made — libraries, tags, tuple sets, data graphs and
 * patches are unflagged because more than one section depends on them.
 * `test/server/registerRoutes.flags.test.ts` pins the route table per flag
 * combination.
 */
import type { FastifyInstance } from 'fastify';
import type { FeatureFlags } from '@sparql-query-lib/types';
import authRoutes from '../routes/auth.js';
import backendRoutes from '../routes/backends.js';
import queryRoutes from '../routes/queries.js';
import detectionRoutes from '../routes/detection.js';
import queryGroupRoutes from '../routes/query-groups.js';
import libraryRoutes from '../routes/libraries.js';
import eventRoutes from '../routes/events.js';
import argumentSetRoutes from '../routes/argument-sets.js';
import playgroundRoutes from '../routes/playground.js';
import benchmarkRoutes from '../routes/benchmarks.js';
import { registerSwaggerDocs } from './swagger.js';
import { registerHealthRoute } from './health.js';
import { registerMetricsRoute } from './metrics.js';

export interface RegisterRoutesOptions {
  featureFlags: FeatureFlags;
  registerSwagger: boolean;
  publicBasePath: string;
}

export function buildExternalPath(basePath: string, routePath: string): string {
  return basePath ? `${basePath}${routePath}` : routePath;
}

/** Whether `/tests` is registered: on, and with something callable to test. */
export function testsEnabled(flags: FeatureFlags): boolean {
  return flags.tests && (flags.queries || flags.queryGroups || flags.rulesSuite);
}

export async function registerApplicationRoutes(
  fastifyApp: FastifyInstance,
  options: RegisterRoutesOptions,
): Promise<void> {
  const { featureFlags, registerSwagger, publicBasePath } = options;

  if (registerSwagger) {
    await registerSwaggerDocs(fastifyApp, featureFlags, publicBasePath);
  }

  // Redirect the scoped root to the scoped docs UI.
  fastifyApp.get('/', (_request, reply) => {
    reply.redirect(buildExternalPath(publicBasePath, '/docs/'));
  });

  registerHealthRoute(fastifyApp);
  registerMetricsRoute(fastifyApp);

  await fastifyApp.register(eventRoutes, { prefix: '/events' });
  await fastifyApp.register(authRoutes, { prefix: '/auth' });
  await fastifyApp.register(backendRoutes, { prefix: '/backends' });
  await fastifyApp.register(libraryRoutes, { prefix: '/libraries' });

  // Unflagged, like libraries themselves. Tags are not a section's feature —
  // every library-scoped section filters by them — so gating them on any one
  // flag would leave entities carrying tags nothing could resolve.
  const tagRoutes = (await import('../routes/tags.js')).default;
  await fastifyApp.register(tagRoutes, { prefix: '/tags' });

  // Also unflagged, and for the same reason as tags: a tuple set feeds a query's
  // VALUES clause and a ruleset's TUPLE declaration alike, so it is not any one
  // section's feature. Gating it would leave argument sets referencing versions
  // nothing could resolve.
  const tupleSetRoutes = (await import('../routes/tuple-sets.js')).default;
  await fastifyApp.register(tupleSetRoutes, { prefix: '/tuple-sets' });

  // Unflagged for the third time and for the same reason. Data graphs shipped
  // with the rules suite because a rule set was the only thing that could run
  // against one; a query test now runs hermetically against one too, so gating
  // them on the rules flag would make a query test's own input unreachable
  // wherever rules are off.
  const dataGraphRoutes = (await import('../routes/data-graphs.js')).default;
  await fastifyApp.register(dataGraphRoutes, { prefix: '/data-graphs' });

  // Unflagged again, and for a reason of its own: a patch is not a library
  // feature but a *backend* one. Preview is how an agent-driven write is made
  // reviewable, and the log is how any write is made auditable, so gating it on
  // whichever section happened to issue the update would leave the same
  // backend's history visible from one screen and missing from another.
  const patchRoutes = (await import('../routes/patches.js')).default;
  await fastifyApp.register(patchRoutes, { prefix: '/patches' });

  if (featureFlags.queries) {
    await fastifyApp.register(queryRoutes, { prefix: '/queries' });
    const executeRoutes = (await import('../routes/execute.js')).default;
    await fastifyApp.register(executeRoutes, { prefix: '/execute' });
    // The SPARQL proxy is the queries section's tool: with queries off there
    // is no query to proxy.
    const sparqlRoutes = (await import('../routes/sparql.js')).default;
    await fastifyApp.register(sparqlRoutes, { prefix: '' });
  } else {
    fastifyApp.log.warn('Queries feature disabled; /queries, /execute, /sparql and /detect-* routes not registered.');
  }

  // At the root. `/detect-*` is registered only under queries (the plugin
  // decides); `/validate`, `/validate-rule-data`, `/format` and `/substitute`
  // serve the rules editor as well, so they stay.
  await fastifyApp.register(detectionRoutes, { prefix: '', featureFlags });

  if (featureFlags.rulesSuite) {
    const rulesRoutes = (await import('../routes/rules.js')).default;
    await fastifyApp.register(rulesRoutes, { prefix: '/rules' });
    const dataBlockRoutes = (await import('../routes/data-blocks.js')).default;
    await fastifyApp.register(dataBlockRoutes, { prefix: '/data-blocks' });
    const ruleSetRoutes = (await import('../routes/rule-sets.js')).default;
    await fastifyApp.register(ruleSetRoutes, { prefix: '/rule-sets' });
  } else {
    fastifyApp.log.warn('Rules feature disabled; /rules, /data-blocks, and /rule-sets routes not registered.');
  }

  // The plugin registers each playground route under its own flag.
  if (featureFlags.playgroundRules || featureFlags.playgroundEtl) {
    await fastifyApp.register(playgroundRoutes, { prefix: '/playground', featureFlags });
  }

  if (featureFlags.queryGroups) {
    await fastifyApp.register(queryGroupRoutes, { prefix: '/query-groups' });
  } else {
    fastifyApp.log.warn('Query Groups feature disabled; /query-groups routes not registered.');
  }

  if (featureFlags.benchmarks) {
    await fastifyApp.register(benchmarkRoutes, { prefix: '/benchmark-experiments' });
  } else {
    fastifyApp.log.warn('Benchmarks feature disabled; /benchmark-experiments routes not registered.');
  }

  // Tests are not a rules feature: a test of a query is the same entity as a
  // test of a rule set. So they get their own flag, and register only when
  // there is something callable to test.
  const tests = testsEnabled(featureFlags);

  // Argument sets are what a query, a group or a test case is called with, so
  // they are registered whenever any of those is: a test case pins an argument
  // set version, and tests can be on with queries and groups both off.
  if (featureFlags.queries || featureFlags.queryGroups || tests) {
    await fastifyApp.register(argumentSetRoutes, { prefix: '/argument-sets' });
  }

  if (tests) {
    const testRoutes = (await import('../routes/tests.js')).default;
    await fastifyApp.register(testRoutes, { prefix: '/tests' });
  }

  if (featureFlags.etl) {
    const etlJobRoutes = (await import('../routes/etl-jobs.js')).default;
    await fastifyApp.register(etlJobRoutes, { prefix: '/etl-jobs' });

    // Before the first job, not after it: the ETL output directory being
    // unwritable is a deployment fault (a root-owned volume under a process
    // running as uid 1000, issue #466), and left unchecked it surfaces as an
    // EACCES partway through somebody's first execution.
    const { checkEtlOutputDir } = await import('../lib/EtlService.js');
    const outputDir = await checkEtlOutputDir();
    if (outputDir.writable) {
      fastifyApp.log.info(`ETL output directory ready: ${outputDir.dir}`);
    } else {
      fastifyApp.log.error(
        `ETL output directory is not writable: ${outputDir.dir} (${outputDir.error}). `
        + `Job executions will fail until this is fixed.${outputDir.hint ? ` ${outputDir.hint}` : ''}`,
      );
    }
  } else {
    fastifyApp.log.warn('ETL feature disabled; /etl-jobs routes not registered.');
  }

  if (featureFlags.assistant) {
    // Door A. Off by default: unauthenticated, calls a paid provider, and can
    // reach a backend — see the flag's own note.
    const { default: assistantRoutes, configureAssistant } = await import('../routes/assistant.js');
    const { aiSdkModelClientFactory } = await import('../assistant/ai-sdk-client.js');
    // The provider integration is one module behind the ModelClient seam; this
    // is the whole of wiring it up.
    configureAssistant({ modelClientFactory: aiSdkModelClientFactory });
    await fastifyApp.register(assistantRoutes, { prefix: '/assistant' });
  }
}
