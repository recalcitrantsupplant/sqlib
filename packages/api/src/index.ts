process.on('uncaughtException', (e) => {
  console.error('Uncaught:', e);
  console.error('proto:', Object.getPrototypeOf(e));
  console.error('keys:', Object.keys(e ?? {}));
  console.error('stack:', (e)?.stack);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('UnhandledRejection:', e);
});

import { toError } from './lib/toError.js';
import './otel-setup.js';

// app.ts - Main application file
import 'dotenv/config'; // Load .env file variables
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyCors from '@fastify/cors';
import { serializerOpts, setupValidator } from './lib/validator-setup.js';
import { memoryCacheManager } from './lib/MemoryCacheManager.js';
import path from 'node:path';
import { cacheMonitoringService } from './lib/CacheMonitoringService.js';
import { oxigraphStoreManager } from './lib/OxigraphStoreManager.js';
import { getFeatureFlags, resetFeatureFlags } from './config/featureFlags.js';
import { config } from './server/config.js';
import { registerAuthPlugin } from './auth/plugin.js';
import { initializeAuth } from './auth/bootstrap.js';
import { getAuthConfig, resetAuthConfig } from './auth/config.js';
import {
  isReadOnlyDeployment,
  registerReadOnlyPlugin,
  resetReadOnly,
} from './config/readOnly.js';
import {
  MAX_DATA_GRAPH_LIBRARY_BYTES,
  MAX_DATA_GRAPH_VERSION_BYTES,
} from './lib/dataGraphContent.js';
import {
  MAX_TUPLE_SET_LIBRARY_BYTES,
  MAX_TUPLE_SET_VERSION_BYTES,
} from './lib/TupleSetVersionWriter.js';
import { requireAdmin } from './auth/enforce.js';
import authRoutes from './routes/auth.js';
import backendRoutes from './routes/backends.js';
import queryRoutes from './routes/queries.js';
import detectionRoutes from './routes/detection.js';
import queryGroupRoutes from './routes/query-groups.js';
import libraryRoutes from './routes/libraries.js';
import eventRoutes from './routes/events.js';
import { registerChangeFeedHook } from './lib/changeEvents.js';
import { registerNoStoreHook } from './lib/httpCaching.js';
import argumentSetRoutes from './routes/argument-sets.js';
import playgroundRoutes from './routes/playground.js';
import benchmarkRoutes from './routes/benchmarks.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

// Create the Fastify instance outside the start function
const app = Fastify({
  logger: true,
  bodyLimit: 100 * 1024 * 1024, // 100MB limit
  // Teaches the response serialiser the `iri` format the contracts emit; without
  // it fast-json-stringify logs `unknown format "iri" ignored` for every such
  // field and then skips it. See lib/validator-setup.ts.
  serializerOpts,
});

async function prepareOxigraphStores(fastifyApp: typeof app): Promise<void> {
  const backendConfig = config.internalBackend;
  const enableFlag = process.env.ENABLE_OXIGRAPH === 'true';
  const shouldInitManager = enableFlag || backendConfig.type === 'oxigraph-persistent';

  if (!shouldInitManager) {
    fastifyApp.log.info('Oxigraph store manager disabled (set ENABLE_OXIGRAPH=true to enable)');
    return;
  }

  const storageDir = backendConfig.type === 'oxigraph-persistent'
    ? backendConfig.storageDir
    : path.resolve(process.env.OXIGRAPH_STORAGE_DIR || './storage/oxigraph');

  fastifyApp.log.info({ storageDir }, 'Initializing Oxigraph store manager');
  await oxigraphStoreManager.initialize(storageDir);
  fastifyApp.log.info('Oxigraph store manager initialization complete.');

  if (backendConfig.type === 'oxigraph-persistent') {
    await oxigraphStoreManager.createPersistentStore(backendConfig.storeId, {
      storeType: 'persistent',
      loadMethod: backendConfig.loadMethod,
      sourceConfig: backendConfig.sourceConfig,
      persistPath: backendConfig.persistPath,
    });
    
    if (backendConfig.checkpointIntervalMs && backendConfig.checkpointIntervalMs > 0) {
      oxigraphStoreManager.startCheckpointing(backendConfig.checkpointIntervalMs);
    }

    fastifyApp.log.info({
      storeId: backendConfig.storeId,
      persistPath: backendConfig.persistPath,
    }, 'Library Oxigraph store ready for LDKit persistence');
  }
}

/**
 * Optionally load the W3C SHACL 1.2 Rules test suite into a library, as Tests.
 *
 * Off unless asked for, and asked for by the *deployment* rather than a user:
 * it writes 166 tests and their rule sets into the store, which is a fine thing
 * for a conformance or demo instance and an odd thing to find in somebody's own
 * library. `just run-local-rules-tests` is what asks.
 *
 * Never fatal. A store that already has the suite, a snapshot that is not on
 * disk, a document the library cannot express — none of those are reasons for
 * the server not to come up, so each is logged and passed over.
 */
async function seedRulesConformanceSuite(
  fastifyApp: typeof app,
  featureFlags: ReturnType<typeof getFeatureFlags>,
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
    const { seedW3cRulesSuiteIfAvailable } = await import('./lib/w3cRulesSuite/seed.js');
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
 * Off unless asked for, and asked for by the deployment rather than a user, for
 * the reason the rules suite gives: seeded example entities are a fine thing in
 * a demo instance and an odd thing to find in somebody's own library.
 * `just run-local-patch-demo` is what asks.
 *
 * Never fatal. The demo is the point of that recipe and nothing else, so a
 * failure to seed it is logged and the server comes up regardless.
 */
async function seedPatchDemoLibrary(
  fastifyApp: typeof app,
  featureFlags: ReturnType<typeof getFeatureFlags>,
): Promise<void> {
  if (process.env.SEED_PATCH_DEMO !== 'true') return;

  if (!featureFlags.queries) {
    fastifyApp.log.warn('SEED_PATCH_DEMO is set but the queries feature is off; nothing seeded.');
    return;
  }

  try {
    const { seedPatchDemo } = await import('./lib/patchDemo/seed.js');
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

type ConfigureOptions = {
  enableCacheMonitoring?: boolean;
  registerSwagger?: boolean;
};

function buildExternalPath(basePath: string, routePath: string): string {
  return basePath ? `${basePath}${routePath}` : routePath;
}

function normalizeBasePath(input: string | undefined): string {
  if (!input) {
    return '';
  }

  const trimmed = input.trim();
  if (trimmed === '' || trimmed === '/') {
    return '';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutTrailingSlashes = withLeadingSlash.replace(/\/+$/, '');

  return withoutTrailingSlashes === '/' ? '' : withoutTrailingSlashes;
}

function getHealthPayload() {
  const cacheStats = memoryCacheManager.getStats();
  const ready = memoryCacheManager.isReady();

  return {
    status: ready ? 'ok' : 'not_ready',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    // Clients feature-detect from here: the SPA skips its login flow entirely
    // when auth is disabled, so it works unchanged on both sides of the flip.
    auth: {
      mode: getAuthConfig().mode,
    },
    /*
     * Feature-detected the same way, and for the same reason: the SPA turns
     * Save into "keep in this browser" when this is true, so a build pointed at
     * a read-only deployment must not offer a button the server will refuse.
     */
    readOnly: isReadOnlyDeployment(),
    cache: {
      ready,
      totalEntities: cacheStats.totalEntities,
      estimatedMemoryBytes: cacheStats.estimatedMemoryBytes,
    },
    /*
     * What the server will accept, so a client can say so before it asks. Both
     * caps are environment-tunable, which is exactly why they are reported: the
     * SPA used to state a figure of its own, and a deployment that raised the
     * server's had a UI still refusing uploads at the old one.
     */
    limits: {
      dataGraphVersionBytes: MAX_DATA_GRAPH_VERSION_BYTES,
      dataGraphLibraryBytes: MAX_DATA_GRAPH_LIBRARY_BYTES,
      tupleSetVersionBytes: MAX_TUPLE_SET_VERSION_BYTES,
      tupleSetLibraryBytes: MAX_TUPLE_SET_LIBRARY_BYTES,
    },
  };
}

function getMetricsPayload() {
  const cacheStats = memoryCacheManager.getStats();
  const storeStats = Object.fromEntries(
    Array.from(oxigraphStoreManager.getAllStoreStats().entries())
      .sort(([left], [right]) => left.localeCompare(right))
  );

  const oxigraphSummary = Object.values(storeStats).reduce(
    (summary, stats) => {
      summary.totalStores += 1;
      summary.totalTriples += stats.tripleCount;
      summary.totalMemoryBytes += stats.memoryUsage;
      return summary;
    },
    {
      totalStores: 0,
      totalTriples: 0,
      totalMemoryBytes: 0,
    }
  );

  return {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
    },
    cache: cacheStats,
    oxigraph: {
      stores: storeStats,
      summary: oxigraphSummary,
    },
  };
}

async function registerApplicationRoutes(
  fastifyApp: typeof app,
  options: {
    featureFlags: ReturnType<typeof getFeatureFlags>;
    registerSwagger: boolean;
    publicBasePath: string;
  }
) {
  const { featureFlags, registerSwagger, publicBasePath } = options;

  if (registerSwagger) {
    const swaggerTags = [
      { name: 'Library', description: 'Routes for managing Query Libraries' },
    ];

    if (featureFlags.backends) {
      swaggerTags.push({ name: 'Backend', description: 'Routes for managing SPARQL backends' });
    }

    if (featureFlags.queries) {
      swaggerTags.push({ name: 'Query', description: 'Routes for managing SPARQL queries' });
      swaggerTags.push({ name: 'Execution', description: 'Routes for executing queries' });
    }

    if (featureFlags.rulesSuite) {
      swaggerTags.push({ name: 'Rule', description: 'Routes for managing SHACL rules' });
      swaggerTags.push({ name: 'DataBlock', description: 'Routes for managing data blocks' });
      swaggerTags.push({ name: 'RuleSet', description: 'Routes for managing rule sets' });
    }

    if (featureFlags.queryGroups) {
      swaggerTags.push({ name: 'QueryGroup', description: 'Routes for managing Query Groups' });
    }

    if (featureFlags.benchmarks) {
      swaggerTags.push({ name: 'Benchmark', description: 'Routes for managing benchmarks' });
    }

    swaggerTags.push({ name: 'Utility', description: 'Utility routes for query analysis' });

    await fastifyApp.register(fastifySwagger as unknown as Parameters<typeof fastifyApp.register>[0], {
      routePrefix: '/docs',
      openapi: {
        info: {
          title: 'SPARQL Query Library API',
          description: 'API for managing and running SPARQL queries',
          version: '1.0.0'
        },
        externalDocs: {
          url: 'https://swagger.io',
          description: 'Find more info here'
        },
        tags: swaggerTags,
        servers: [{ url: publicBasePath || '/' }]
      },
      // hide the routes from swagger documentation
      hideUntagged: true,
      stripBasePath: true,
    });

    await fastifyApp.register(fastifySwaggerUi, {
      routePrefix: '/docs',
      staticCSP: false,
      indexPrefix: publicBasePath
    });
  }

  // Redirect the scoped root to the scoped docs UI.
  fastifyApp.get('/', (_request, reply) => {
    reply.redirect(buildExternalPath(publicBasePath, '/docs/'));
  });

  fastifyApp.get(
    '/health',
    {
      schema: {
        tags: ['Utility'],
        summary: 'Health check',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              uptimeSeconds: { type: 'integer' },
              auth: {
                type: 'object',
                properties: {
                  mode: { type: 'string' },
                },
                required: ['mode'],
              },
              // Declared, or Fastify's serialiser drops it and the SPA reads a
              // read-only deployment as writable — see `useDeploymentMode`.
              readOnly: { type: 'boolean' },
              cache: {
                type: 'object',
                properties: {
                  ready: { type: 'boolean' },
                  totalEntities: { type: 'integer' },
                  estimatedMemoryBytes: { type: 'integer' },
                },
                required: ['ready', 'totalEntities', 'estimatedMemoryBytes'],
              },
              limits: {
                type: 'object',
                properties: {
                  dataGraphVersionBytes: { type: 'integer' },
                  dataGraphLibraryBytes: { type: 'integer' },
                  tupleSetVersionBytes: { type: 'integer' },
                  tupleSetLibraryBytes: { type: 'integer' },
                },
                required: [
                  'dataGraphVersionBytes',
                  'dataGraphLibraryBytes',
                  'tupleSetVersionBytes',
                  'tupleSetLibraryBytes',
                ],
              },
            },
            required: ['status', 'timestamp', 'uptimeSeconds', 'auth', 'readOnly', 'cache', 'limits'],
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              uptimeSeconds: { type: 'integer' },
              auth: {
                type: 'object',
                properties: {
                  mode: { type: 'string' },
                },
                required: ['mode'],
              },
              // Declared, or Fastify's serialiser drops it and the SPA reads a
              // read-only deployment as writable — see `useDeploymentMode`.
              readOnly: { type: 'boolean' },
              cache: {
                type: 'object',
                properties: {
                  ready: { type: 'boolean' },
                  totalEntities: { type: 'integer' },
                  estimatedMemoryBytes: { type: 'integer' },
                },
                required: ['ready', 'totalEntities', 'estimatedMemoryBytes'],
              },
              limits: {
                type: 'object',
                properties: {
                  dataGraphVersionBytes: { type: 'integer' },
                  dataGraphLibraryBytes: { type: 'integer' },
                  tupleSetVersionBytes: { type: 'integer' },
                  tupleSetLibraryBytes: { type: 'integer' },
                },
                required: [
                  'dataGraphVersionBytes',
                  'dataGraphLibraryBytes',
                  'tupleSetVersionBytes',
                  'tupleSetLibraryBytes',
                ],
              },
            },
            required: ['status', 'timestamp', 'uptimeSeconds', 'auth', 'readOnly', 'cache', 'limits'],
          },
        },
      },
    },
    async (_request, reply) => {
      const payload = getHealthPayload();
      const statusCode = payload.cache.ready ? 200 : 503;
      return reply.status(statusCode).send(payload);
    }
  );

  fastifyApp.get(
    '/metrics',
    {
      schema: {
        tags: ['Utility'],
        summary: 'Runtime metrics snapshot',
        response: {
          200: {
            type: 'object',
            properties: {
              timestamp: { type: 'string' },
              uptimeSeconds: { type: 'integer' },
              process: {
                type: 'object',
                properties: {
                  pid: { type: 'integer' },
                  nodeVersion: { type: 'string' },
                  memoryUsage: {
                    type: 'object',
                    additionalProperties: { type: 'integer' },
                  },
                },
                required: ['pid', 'nodeVersion', 'memoryUsage'],
              },
              cache: {
                type: 'object',
                properties: {
                  totalEntities: { type: 'integer' },
                  isLoaded: { type: 'boolean' },
                  estimatedMemoryBytes: { type: 'integer' },
                  entityTypes: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        count: { type: 'integer' },
                        memoryBytes: { type: 'integer' },
                      },
                      required: ['count', 'memoryBytes'],
                    },
                  },
                },
                required: ['totalEntities', 'isLoaded', 'estimatedMemoryBytes', 'entityTypes'],
              },
              oxigraph: {
                type: 'object',
                properties: {
                  stores: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        tripleCount: { type: 'integer' },
                        memoryUsage: { type: 'integer' },
                      },
                      required: ['tripleCount', 'memoryUsage'],
                    },
                  },
                  summary: {
                    type: 'object',
                    properties: {
                      totalStores: { type: 'integer' },
                      totalTriples: { type: 'integer' },
                      totalMemoryBytes: { type: 'integer' },
                    },
                    required: ['totalStores', 'totalTriples', 'totalMemoryBytes'],
                  },
                },
                required: ['stores', 'summary'],
              },
            },
            required: ['timestamp', 'uptimeSeconds', 'process', 'cache', 'oxigraph'],
          },
        },
      },
    },
    async (request, reply) => {
      // Exposes store contents and process internals — admin-only.
      requireAdmin(request, 'reading runtime metrics');
      return reply.send(getMetricsPayload());
    }
  );

  await fastifyApp.register(eventRoutes, { prefix: '/events' });
  await fastifyApp.register(authRoutes, { prefix: '/auth' });
  await fastifyApp.register(backendRoutes, { prefix: '/backends' });
  await fastifyApp.register(libraryRoutes, { prefix: '/libraries' });

  // Unflagged, like libraries themselves. Tags are not a section's feature —
  // every library-scoped section filters by them — so gating them on any one
  // flag would leave entities carrying tags nothing could resolve.
  const tagRoutes = (await import('./routes/tags.js')).default;
  await fastifyApp.register(tagRoutes, { prefix: '/tags' });

  // Also unflagged, and for the same reason as tags: a tuple set feeds a query's
  // VALUES clause and a ruleset's TUPLE declaration alike, so it is not any one
  // section's feature. Gating it would leave argument sets referencing versions
  // nothing could resolve.
  const tupleSetRoutes = (await import('./routes/tuple-sets.js')).default;
  await fastifyApp.register(tupleSetRoutes, { prefix: '/tuple-sets' });

  // Unflagged for the third time and for the same reason. Data graphs shipped
  // with the rules suite because a rule set was the only thing that could run
  // against one; a query test now runs hermetically against one too, so gating
  // them on the rules flag would make a query test's own input unreachable
  // wherever rules are off.
  const dataGraphRoutes = (await import('./routes/data-graphs.js')).default;
  await fastifyApp.register(dataGraphRoutes, { prefix: '/data-graphs' });

  // Unflagged again, and for a reason of its own: a patch is not a library
  // feature but a *backend* one. Preview is how an agent-driven write is made
  // reviewable, and the log is how any write is made auditable, so gating it on
  // whichever section happened to issue the update would leave the same
  // backend's history visible from one screen and missing from another.
  const patchRoutes = (await import('./routes/patches.js')).default;
  await fastifyApp.register(patchRoutes, { prefix: '/patches' });

  if (featureFlags.queries) {
    await fastifyApp.register(queryRoutes, { prefix: '/queries' });
    const executeRoutes = (await import('./routes/execute.js')).default;
    await fastifyApp.register(executeRoutes, { prefix: '/execute' });
  } else {
    fastifyApp.log.warn('Queries feature disabled; /queries and /execute routes not registered.');
  }

  if (featureFlags.rulesSuite) {
    const rulesRoutes = (await import('./routes/rules.js')).default;
    await fastifyApp.register(rulesRoutes, { prefix: '/rules' });
    const dataBlockRoutes = (await import('./routes/data-blocks.js')).default;
    await fastifyApp.register(dataBlockRoutes, { prefix: '/data-blocks' });
    const ruleSetRoutes = (await import('./routes/rule-sets.js')).default;
    await fastifyApp.register(ruleSetRoutes, { prefix: '/rule-sets' });
  } else {
    fastifyApp.log.warn('Rules feature disabled; /rules, /data-blocks, and /rule-sets routes not registered.');
  }

  if (featureFlags.playgroundQueries || featureFlags.playgroundRules) {
    await fastifyApp.register(playgroundRoutes, { prefix: '/playground' });
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

  if (featureFlags.queries || featureFlags.queryGroups) {
    await fastifyApp.register(argumentSetRoutes, { prefix: '/argument-sets' });
  }

  // Tests are not a rules feature: a test of a query is the same entity as a
  // test of a rule set. So they get their own flag, and register only when
  // there is something callable to test.
  if (featureFlags.tests && (featureFlags.queries || featureFlags.queryGroups || featureFlags.rulesSuite)) {
    const testRoutes = (await import('./routes/tests.js')).default;
    await fastifyApp.register(testRoutes, { prefix: '/tests' });
  }

  if (featureFlags.etl) {
    const etlJobRoutes = (await import('./routes/etl-jobs.js')).default;
    await fastifyApp.register(etlJobRoutes, { prefix: '/etl-jobs' });

    // Before the first job, not after it: the ETL output directory being
    // unwritable is a deployment fault (a root-owned volume under a process
    // running as uid 1000, issue #466), and left unchecked it surfaces as an
    // EACCES partway through somebody's first execution.
    const { checkEtlOutputDir } = await import('./lib/EtlService.js');
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
    const { default: assistantRoutes, configureAssistant } = await import('./routes/assistant.js');
    const { aiSdkModelClientFactory } = await import('./assistant/ai-sdk-client.js');
    // The provider integration is one module behind the ModelClient seam; this
    // is the whole of wiring it up.
    configureAssistant({ modelClientFactory: aiSdkModelClientFactory });
    await fastifyApp.register(assistantRoutes, { prefix: '/assistant' });
  }

  await fastifyApp.register(detectionRoutes, { prefix: '' });
  const sparqlRoutes = (await import('./routes/sparql.js')).default;
  await fastifyApp.register(sparqlRoutes, { prefix: '' }); // Register SPARQL proxy routes at root
}

async function configureApp(fastifyApp: typeof app, options: ConfigureOptions = {}) {
  const { enableCacheMonitoring = true, registerSwagger = true } = options;

  // Register CORS plugin
  await fastifyApp.register(fastifyCors, {
    // During development, allow all origins
    origin: "*",
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    /*
     * `Accept` is listed because the SPA negotiates a report format with it:
     * `POST /tests/:id/run` with `Accept: application/rdf+xml` returns EARL
     * rather than JSON. The header is only CORS-safelisted for a handful of
     * values, so any other media type preflights — and a preflight that does
     * not list it fails the whole request, which is why exporting a run failed
     * from the browser while every other call succeeded.
     */
    allowedHeaders: ['Accept', 'Content-Type', 'Authorization', 'If-Match', 'mcp-session-id', 'X-Sqlib-Client-Id'],
    exposedHeaders: ['ETag', 'Last-Modified', 'Server-Timing', 'mcp-session-id'],
    credentials: true
  });

  // Register multipart plugin
  await fastifyApp.register(fastifyMultipart);

  resetFeatureFlags();
  const featureFlags = getFeatureFlags();
  fastifyApp.log.info({ featureFlags }, 'Feature flags resolved');

  // Registered before any route so every request carries an AuthContext, in all
  // three modes. Grants load later (they need the entity cache); the plugin only
  // validates tokens here.
  resetAuthConfig();
  await registerAuthPlugin(fastifyApp);

  // After auth so a refusal is logged against a request that already carries a
  // context, and before every route so no write route can be reached without
  // passing it. Registering it is a no-op unless SQLIB_READ_ONLY=true.
  resetReadOnly();
  if (isReadOnlyDeployment()) {
    fastifyApp.log.info('SQLIB_READ_ONLY=true: refusing writes to sqlib\'s own state');
  }
  await registerReadOnlyPlugin(fastifyApp);

  // Set up IRI format validation BEFORE registering schemas
  setupValidator(fastifyApp);
  fastifyApp.log.info('Added format validators including IRI support');

  // Register all schemas
  for (const [_id, schema] of Object.entries(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) {
      fastifyApp.addSchema(schema);
    }
  }
  fastifyApp.log.info('Added shared schemas to Fastify instance.');

  // Global Error Handler
  fastifyApp.setErrorHandler((error: FastifyError, request, reply) => {
    // Enhanced error logging with structured data
    const errorContext = {
      route: `${request.method} ${request.url}`,
      requestId: request.id,
      statusCode: error.statusCode || 500,
      errorType: error.constructor.name,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
      query: request.query,
      params: request.params,
      replySent: reply.sent
    };

    console.error('🚨 Global error handler triggered:');
    console.error('📍 Context:', errorContext);
    console.error('💥 Error:', error.message);
    console.error('📊 Stack trace:', error.stack);

    // Use structured logging for better monitoring
    request.log.error({
      err: error,
      context: errorContext
    }, 'Global error handler triggered');

    // Don't send response if already sent
    if (reply.sent) {
      return;
    }

    const statusCode = error.statusCode || 500;

    // Handle validation errors with enhanced details
    if (error.validation && Array.isArray(error.validation)) {
      const validationErrors = error.validation.map((err: { instancePath?: string; dataPath?: string; params?: { missingProperty?: string; type?: string; format?: string }; keyword?: string; message?: string }) => {
        const fieldPath = err.instancePath || err.dataPath || '';
        const field = err.params?.missingProperty || fieldPath.replace(/^\//, '') || 'Field';

        if (err.keyword === 'required') {
          return `"${field}" is required`;
        }
        if (err.keyword === 'type') {
          return `"${field}" must be of type ${err.params?.type}`;
        }
        if (err.keyword === 'format') {
          return `"${field}" has invalid format (expected: ${err.params?.format})`;
        }

        return err.message || 'Validation error';
      });

      const errorMessage = validationErrors.length > 0 ? validationErrors[0] : 'Validation failed';
      return reply.status(statusCode).send({
        error: errorMessage,
        validation: validationErrors,
        route: errorContext.route,
        requestId: request.id,
        timestamp: new Date().toISOString()
      });
    }

    // Determine error message based on environment and status code
    let message = error.message || 'An unexpected error occurred';
    let details: unknown = undefined;

    // In development, provide full error details
    if (process.env.NODE_ENV === 'development') {
      details = {
        stack: error.stack,
        type: error.constructor.name,
        code: error.code,
        context: errorContext
      };
    } else if (statusCode >= 500) {
      // In production, mask server errors but preserve client errors
      message = 'Internal Server Error';
    }

    const errorResponse: { error: string; route: string; requestId: string; timestamp: string; details?: unknown } = {
      error: message,
      route: errorContext.route,
      requestId: request.id,
      timestamp: new Date().toISOString()
    };

    if (details) {
      errorResponse.details = details;
    }

    reply.status(statusCode).send(errorResponse);
  });

  // Initialize local storage for LDKit persistence before hitting lenses
  await prepareOxigraphStores(fastifyApp);

  // Initialize memory cache manager - load all entities from SPARQL into memory
  console.log('Initializing memory cache...');
  await memoryCacheManager.loadAll();
  console.log('Memory cache initialization complete.');
  console.log('Cache stats:', memoryCacheManager.getStats());

  // Grants load after the entity cache: resolving a library grant needs the
  // library, and an enforcing mode must not serve a request before the store is
  // indexed.
  await initializeAuth(fastifyApp.log);

  // After the cache, because seeding writes entities through it; before the
  // routes, so the first request already sees the suite.
  await seedRulesConformanceSuite(fastifyApp, featureFlags);
  await seedPatchDemoLibrary(fastifyApp, featureFlags);

  // Start cache monitoring with OpenTelemetry metrics
  if (enableCacheMonitoring) {
    console.log('Starting cache monitoring...');
    cacheMonitoringService.start();
  }

  // One hook, before any route: MCP writes arrive through `app.inject` and so
  // pass here exactly as the web app's own HTTP writes do.
  registerChangeFeedHook(fastifyApp);

  // Also before any route: entity reads carry validators, and a validator with
  // no `Cache-Control` is what let a browser serve a saved-over query from its
  // own cache. See `registerNoStoreHook`.
  registerNoStoreHook(fastifyApp);

  const basePath = normalizeBasePath(process.env.APP_BASE_PATH);
  const publicBasePath = normalizeBasePath(process.env.APP_PUBLIC_BASE_PATH) || basePath;

  if (basePath) {
    await fastifyApp.register(
      async (scopedApp) => {
        await registerApplicationRoutes(scopedApp as typeof app, {
          featureFlags,
          registerSwagger,
          publicBasePath,
        });
      },
      { prefix: basePath }
    );
  } else {
    await registerApplicationRoutes(fastifyApp, {
      featureFlags,
      registerSwagger,
      publicBasePath,
    });
  }

  fastifyApp.log.info('Server setup complete with feature flag configuration applied.');

  const teardown = async () => {
    if (enableCacheMonitoring) {
      cacheMonitoringService.stop();
    }
    await oxigraphStoreManager.shutdown();
    await fastifyApp.close();
  };

  return { featureFlags, teardown };
}

// Define the start function, accepting the app instance
const start = async (fastifyApp: typeof app) => {
  try {
    const { teardown } = await configureApp(fastifyApp);

    // Setup graceful shutdown for oxigraph stores and cache monitoring
    const gracefulShutdown = async () => {
      console.log('Graceful shutdown initiated...');
      try {
        await teardown();
        console.log('Server shutdown complete.');
        process.exit(0);
      } catch (error__u: unknown) {
      const error = toError(error__u);
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    const port = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;
    const host = process.env.FASTIFY_ADDRESS ?? '0.0.0.0';

    try {
      await fastifyApp.listen({ port, host });
      console.log(`Server listening on http://localhost:${port}`);
    } catch (err__u: unknown) {
      const err = toError(err__u);
      fastifyApp.log.error(err);
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Please use a different port.`);
      }
      process.exit(1);
    }
  } catch (err) {
    fastifyApp.log.error(err);
    process.exit(1);
  }
}

// Export the app instance and the start function
export { app, start, configureApp, normalizeBasePath };
// Re-exported for in-process consumers that must validate exactly as this server
// does — `packages/mcp-server` compiles its tool schemas with it (Phase C2,
// issue #65). `coerceTypes`/`useDefaults` change what a handler receives, so a
// caller building its own ajv would be a second configuration free to drift.
export { createValidatorAjv } from './lib/validator-setup.js';
export type { ConfigureOptions };

// Start the server only if this script is run directly
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const modulePath = fileURLToPath(import.meta.url);
const mainPath = process.argv[1] ? resolve(process.argv[1]) : '';

if (modulePath === mainPath) {
  start(app);
}
