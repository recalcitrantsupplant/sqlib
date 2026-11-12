/**
 * Seeding a deployment asks for: example content written at boot, after the
 * entity cache is loaded (seeding writes through it) and before the routes, so
 * the first request already sees it. Never fatal — each failure is logged and
 * the server comes up regardless.
 */
import type { FastifyInstance } from 'fastify';
import type { FeatureFlags } from '@sparql-query-lib/types';

/**
 * Optionally load the W3C SHACL 1.2 Rules test suite into a library, as Tests.
 *
 * Off unless asked for, and asked for by the *deployment* rather than a user:
 * it writes 166 tests and their rule sets into the store, which is a fine thing
 * for a conformance or demo instance and an odd thing to find in somebody's own
 * library. `just run-local-rules-tests` is what asks.
 *
 * A store that already has the suite, a snapshot that is not on disk, a
 * document the library cannot express — none of those are reasons for the
 * server not to come up, so each is logged and passed over.
 */
export async function seedRulesConformanceSuite(
  fastifyApp: FastifyInstance,
  featureFlags: FeatureFlags,
): Promise<void> {
  if (process.env.SEED_W3C_RULES_SUITE !== 'true') return;

  if (!featureFlags.rulesSuite || !featureFlags.tests) {
    fastifyApp.log.warn(
      { rulesSuite: featureFlags.rulesSuite, tests: featureFlags.tests },
      'SEED_W3C_RULES_SUITE is set but the rules or tests feature is off; nothing seeded.',
    );
    return;
  }
  // Not fatal, because three quarters of the suite loads without it — but worth
  // saying plainly, since the missing quarter is every test that asserts a
  // document is rejected.
  if (!featureFlags.rulesAllowInvalidSave) {
    fastifyApp.log.warn(
      'FEATURE_RULES_ALLOW_INVALID_SAVE is off, so the suite\'s deliberately-invalid documents cannot be stored and will be skipped.',
    );
  }

  try {
    const { seedW3cRulesSuiteIfAvailable } = await import('../lib/w3cRulesSuite/seed.js');
    const result = await seedW3cRulesSuiteIfAvailable({
      log: message => fastifyApp.log.info(message),
    });
    if (result) {
      fastifyApp.log.info({
        libraryId: result.libraryId,
        suiteDir: result.suiteDir,
        created: result.testsCreated,
        alreadyPresent: result.testsExisting,
        skipped: result.skipped,
      }, 'W3C rules conformance suite loaded');
    }
  } catch (error) {
    fastifyApp.log.error({ err: error }, 'Failed to load the W3C rules suite; continuing without it');
  }
}

/**
 * Optionally load the RDF Patch demo library: a small catalogue, a writable
 * in-memory backend and the update queries worth previewing against it.
 *
 * Off unless asked for, for the reason the rules suite gives.
 * `just run-local-patch-demo` is what asks.
 */
export async function seedPatchDemoLibrary(
  fastifyApp: FastifyInstance,
  featureFlags: FeatureFlags,
): Promise<void> {
  if (process.env.SEED_PATCH_DEMO !== 'true') return;

  if (!featureFlags.queries) {
    fastifyApp.log.warn('SEED_PATCH_DEMO is set but the queries feature is off; nothing seeded.');
    return;
  }

  try {
    const { seedPatchDemo } = await import('../lib/patchDemo/seed.js');
    const result = await seedPatchDemo(message => fastifyApp.log.info(message));
    fastifyApp.log.info({
      libraryId: result.libraryId,
      backendId: result.backendId,
      created: result.queriesCreated,
      alreadyPresent: result.queriesExisting,
    }, 'RDF Patch demo library loaded');
  } catch (error) {
    fastifyApp.log.error({ err: error }, 'Failed to seed the RDF Patch demo; continuing without it');
  }
}

/**
 * Optionally load the ETL examples library: saved ETL jobs, each with SQL, a
 * column mapping and a template, that open in the ETL screen ready to run.
 *
 * Off unless asked for, for the reason the rules suite gives.
 * `just run-local-etl-demo` is what asks.
 */
export async function seedEtlDemoLibrary(
  fastifyApp: FastifyInstance,
  featureFlags: FeatureFlags,
): Promise<void> {
  if (process.env.SEED_ETL_DEMO !== 'true') return;

  if (!featureFlags.etl) {
    fastifyApp.log.warn('SEED_ETL_DEMO is set but the etl feature is off; nothing seeded.');
    return;
  }

  try {
    const { seedEtlDemo } = await import('../lib/etlDemo/seed.js');
    const result = await seedEtlDemo(message => fastifyApp.log.info(message));
    fastifyApp.log.info({
      libraryId: result.libraryId,
      created: result.jobsCreated,
      alreadyPresent: result.jobsExisting,
    }, 'ETL examples library loaded');
  } catch (error) {
    fastifyApp.log.error({ err: error }, 'Failed to seed the ETL examples; continuing without them');
  }
}

/**
 * Optionally load the graph access demo: company data in three named graphs,
 * an auth backend of access rules, a graph policy joining them, and grants.
 *
 * Off unless asked for, for the reason the rules suite gives.
 * `just demo-graph-access` is what asks.
 */
export async function seedGraphAccessDemoLibrary(
  fastifyApp: FastifyInstance,
  featureFlags: FeatureFlags,
): Promise<void> {
  if (process.env.SEED_GRAPH_ACCESS_DEMO !== 'true') return;

  if (!featureFlags.queries) {
    fastifyApp.log.warn('SEED_GRAPH_ACCESS_DEMO is set but the queries feature is off; nothing seeded.');
    return;
  }

  try {
    const { seedGraphAccessDemo } = await import('../lib/graphAccessDemo/seed.js');
    const result = await seedGraphAccessDemo(message => fastifyApp.log.info(message));
    fastifyApp.log.info(result, 'Graph access demo library loaded');
  } catch (error) {
    fastifyApp.log.error({ err: error }, 'Failed to seed the graph access demo; continuing without it');
  }
}
