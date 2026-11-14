import 'dotenv/config';
import Fastify from 'fastify';
import { startStreamableHttpMcpServer } from './http-server.js';
import { trustProxyFromEnv } from './deployment.js';

type ConfigureAppFn = (
  app: ReturnType<typeof Fastify>,
  options?: { enableCacheMonitoring?: boolean; registerSwagger?: boolean },
) => Promise<{ teardown: () => Promise<void> }>;

interface ApiModule {
  configureApp: ConfigureAppFn;
  /** Absent from an API build older than this server. */
  fastifyLoggerOptions?: () => Record<string, unknown>;
}

async function loadApiModule(): Promise<ApiModule> {
  const devModulePath = new URL('../../api/src/index.ts', import.meta.url).href;

  // Outside production, prefer the API's TypeScript source. `packages/api/dist`
  // usually exists but is whatever was last built, so preferring the published
  // entrypoint here would quietly serve stale routes to anyone running the dual
  // server from a dev runner (`just run-local-memory`).
  if (process.env.NODE_ENV !== 'production') {
    try {
      return (await import(devModulePath)) as ApiModule;
    } catch (error) {
      // Installed as a package, with no source checkout beside us. Said out
      // loud rather than swallowed: when the source *is* there, a failure here
      // is a broken dev tree, and falling through in silence is what made a
      // stale `dist` look like a working server. No Fastify instance, and so no
      // logger, exists yet.
      // eslint-disable-next-line no-console
      console.warn(
        `[dual-http-server] Could not load the API source at ${devModulePath} ` +
          `(${error instanceof Error ? error.message : String(error)}); ` +
          'falling back to the published entrypoint, which may be stale.',
      );
    }
  }

  try {
    return (await import('@sparql-query-lib/api')) as ApiModule;
  } catch {
    return (await import(devModulePath)) as ApiModule;
  }
}

export async function startDualHttpServer(options: { host?: string; port?: number } = {}) {
  // The API module first: its bootstrap starts OpenTelemetry when `cli.ts` has
  // not already, and the Fastify instrumentation only sees instances built
  // after that.
  const { configureApp, fastifyLoggerOptions } = await loadApiModule();
  const app = Fastify({
    logger: fastifyLoggerOptions ? fastifyLoggerOptions() : true,
    bodyLimit: 100 * 1024 * 1024,
    // `SQLIB_TRUST_PROXY`: off unless the operator turns it on.
    trustProxy: trustProxyFromEnv(),
  });

  const { teardown: apiTeardown } = await configureApp(app, {
    enableCacheMonitoring: true,
    registerSwagger: true,
  });

  const host = options.host ?? process.env.HTTP_HOST ?? process.env.MCP_HTTP_HOST ?? '0.0.0.0';
  const port = options.port ?? (process.env.HTTP_PORT ? Number(process.env.HTTP_PORT) : 3000);

  const { shutdown: mcpShutdown } = await startStreamableHttpMcpServer({
    fastifyInstance: app,
    host,
    port,
    bootstrapApiApp: false,
    mcpOptions: {
      fastifyInstance: app,
      skipAppSetup: true,
      fastifyLogger: true,
    },
  });

  const shutdown = async () => {
    await mcpShutdown();
    // mcpShutdown will close transport sessions but does not own app teardown in dual mode.
    await apiTeardown();
  };

  return { app, shutdown, host, port };
}
