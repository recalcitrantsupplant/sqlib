// First, so the crash handlers, `.env` and OpenTelemetry are in place before
// any other module runs. See `server/bootstrap.ts`.
import './server/bootstrap.js';

import { toError } from './lib/toError.js';
import Fastify from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifyCors from '@fastify/cors';
import { serializerOpts, setupLazySerializer, setupValidator } from './lib/validator-setup.js';
import { memoryCacheManager } from './lib/MemoryCacheManager.js';
import path from 'node:path';
import { cacheMonitoringService } from './lib/CacheMonitoringService.js';
import { oxigraphStoreManager } from './lib/OxigraphStoreManager.js';
import { getDuckDbService } from './lib/DuckDbService.js';
import { getFeatureFlags, resetFeatureFlags } from './config/featureFlags.js';
import { config } from './server/config.js';
import { registerAuthPlugin } from './auth/plugin.js';
import { initializeAuth } from './auth/bootstrap.js';
import { resetAuthConfig } from './auth/config.js';
import {
  isReadOnlyDeployment,
  registerReadOnlyPlugin,
  resetReadOnly,
} from './config/readOnly.js';
import { buildCorsOptions, resolveCorsPolicy } from './config/cors.js';
import { registerChangeFeedHook } from './lib/changeEvents.js';
import { registerNoStoreHook } from './lib/httpCaching.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { registerErrorHandler } from './server/errorHandler.js';
import { registerApplicationRoutes } from './server/registerRoutes.js';
import { seedPatchDemoLibrary, seedRulesConformanceSuite } from './server/seed.js';

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
    });
    
    if (backendConfig.checkpointIntervalMs && backendConfig.checkpointIntervalMs > 0) {
      oxigraphStoreManager.startCheckpointing(backendConfig.checkpointIntervalMs);
    }

    fastifyApp.log.info({
      storeId: backendConfig.storeId,
      storageDir: backendConfig.storageDir,
    }, 'Library Oxigraph store ready for LDKit persistence');
  }
}

type ConfigureOptions = {
  enableCacheMonitoring?: boolean;
  registerSwagger?: boolean;
  /**
   * Compile response serialisers at `ready()` instead of on each route's first
   * response. See `setupLazySerializer` for what that costs at startup.
   *
   * Defaults to lazy. `SQLIB_EAGER_SERIALIZERS=true` is the way back for a
   * deployment that would rather pay the whole bill up front — a long-lived
   * instance behind a load balancer gains nothing from deferring it.
   */
  eagerSerializers?: boolean;
};

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

async function configureApp(fastifyApp: typeof app, options: ConfigureOptions = {}) {
  const {
    enableCacheMonitoring = true,
    registerSwagger = true,
    eagerSerializers = process.env.SQLIB_EAGER_SERIALIZERS === 'true',
  } = options;

  // Before any route, and before the validator below, because both compilers
  // belong to the encapsulation context the routes are registered on.
  if (!eagerSerializers) {
    setupLazySerializer(fastifyApp);
  }

  /*
   * An allowlist from `SQLIB_CORS_ORIGINS` (see `config/cors.ts`), read the
   * same way the MCP transport reads it, since in `dual-http` both answer on
   * this instance. Unset, only the SPA's dev server is allowed, and only under
   * `NODE_ENV=development`: the SPA calls this API cross-origin from :3001.
   */
  const corsPolicy = resolveCorsPolicy();
  if (corsPolicy.any || corsPolicy.origins.size > 0) {
    fastifyApp.log.info(
      { corsOrigins: [...(corsPolicy.any ? ['*'] : []), ...corsPolicy.origins] },
      'CORS origins resolved'
    );
  }
  await fastifyApp.register(fastifyCors, buildCorsOptions(corsPolicy));

  // Register multipart plugin
  await fastifyApp.register(fastifyMultipart);

  resetFeatureFlags();
  const featureFlags = getFeatureFlags();
  fastifyApp.log.info({ featureFlags }, 'Feature flags resolved');

  // Registered before any route so every request carries an AuthContext, in all
  // three modes. Grants load later (they need the entity cache); the plugin only
  // validates tokens here. It matches its public routes by registered pattern,
  // which carries the base path whenever one is set.
  const basePath = normalizeBasePath(process.env.APP_BASE_PATH);
  resetAuthConfig();
  await registerAuthPlugin(fastifyApp, { basePath });

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

  registerErrorHandler(fastifyApp);

  // Initialize local storage for LDKit persistence before hitting lenses
  await prepareOxigraphStores(fastifyApp);

  // Initialize memory cache manager - load all entities from SPARQL into memory
  fastifyApp.log.info('Initializing memory cache');
  await memoryCacheManager.loadAll();
  fastifyApp.log.info({ cacheStats: memoryCacheManager.getStats() }, 'Memory cache initialization complete');

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
    fastifyApp.log.info('Starting cache monitoring');
    cacheMonitoringService.start();
  }

  /*
   * DuckDB builds itself on first use now (see `DuckDbService`), so a
   * deployment that serves ETL starts it here instead — deliberately not
   * awaited, so it warms alongside the rest of the boot rather than in front of
   * the first request. This is what the module-load singleton used to do; the
   * difference is that a deployment with ETL off no longer pays for it.
   */
  if (featureFlags.etl || featureFlags.playgroundEtl) {
    void getDuckDbService()
      .waitForInit()
      .catch((error: unknown) => {
        fastifyApp.log.warn({ err: error }, 'DuckDB warm-up failed; ETL routes will report it unavailable');
      });
  }

  // One hook, before any route: MCP writes arrive through `app.inject` and so
  // pass here exactly as the web app's own HTTP writes do.
  registerChangeFeedHook(fastifyApp);

  // Also before any route: entity reads carry validators, and a validator with
  // no `Cache-Control` is what let a browser serve a saved-over query from its
  // own cache. See `registerNoStoreHook`.
  registerNoStoreHook(fastifyApp);

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
      fastifyApp.log.info('Graceful shutdown initiated');
      try {
        await teardown();
        fastifyApp.log.info('Server shutdown complete');
        process.exit(0);
      } catch (error__u: unknown) {
      const error = toError(error__u);
        fastifyApp.log.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    const port = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;
    const host = process.env.FASTIFY_ADDRESS ?? '0.0.0.0';

    try {
      await fastifyApp.listen({ port, host });
      fastifyApp.log.info({ url: `http://localhost:${port}` }, 'Server listening');
    } catch (err__u: unknown) {
      const err = toError(err__u);
      fastifyApp.log.error(err);
      if (err.code === 'EADDRINUSE') {
        fastifyApp.log.error({ port }, 'Port is already in use. Please use a different port.');
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
