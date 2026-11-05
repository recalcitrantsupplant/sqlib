/**
 * OpenTelemetry bootstrap.
 *
 * Imported for its side effect, and imported *early* — before `fastify` and
 * before anything touches `node:http` — because `HttpInstrumentation` patches
 * the http module as it loads and `FastifyOtelInstrumentation` hooks fastify
 * instances as they are constructed. `index.ts` imports it through
 * `server/bootstrap.ts`; the MCP server's `cli.ts` imports it before it loads
 * any server module, which matters for `dual-http`, where the Fastify instance
 * is built outside this package.
 *
 * Whether it starts is `telemetryEnabled()` in `lib/telemetryConfig.ts`: off
 * unless an OTLP endpoint, an exporter or `OTEL_ENABLED=true` is set. Where the
 * data goes is left to the SDK, which reads the standard `OTEL_*` variables
 * (endpoint, protocol, headers, sampler, exporters per signal). No exporter is
 * passed in here, so any OTLP receiver works with configuration alone.
 *
 * The SDK is pulled in with dynamic `import()` inside the enabled branch rather
 * than with static imports: loading it costs ~220ms of a ~2.8s cold start, and
 * a deployment with telemetry off pays nothing. The `await` is a top-level
 * await, so a module importing this one waits for the SDK to start before its
 * own body runs. It does mean this module cannot be loaded with
 * `node --require`; nothing needs to, since importing it is what starts it.
 */

// pino does not touch node:http, so loading it ahead of the SDK leaves the
// instrumentation ordering above intact.
import { log } from './lib/log.js';
import { defaultServiceName, telemetryEnabled } from './lib/telemetryConfig.js';
import { stopOtelLogBridge } from './lib/otelLogBridge.js';

interface TelemetryHandle {
  shutdown(): Promise<void>;
}

// One SDK per process. The MCP server's `cli.ts` and the API's bootstrap both
// import this module; when they resolve to the same file that is one module
// instance anyway, and this guard covers the case where they do not.
const HANDLE_KEY = Symbol.for('sqlib.telemetry');
const globalStore = globalThis as typeof globalThis & { [HANDLE_KEY]?: TelemetryHandle | null };

async function startTelemetry(): Promise<TelemetryHandle | null> {
  if (!telemetryEnabled()) return null;

  const [
    { NodeSDK },
    { HttpInstrumentation },
    { UndiciInstrumentation },
    { FastifyOtelInstrumentation },
    { diag, DiagLogLevel },
  ] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/instrumentation-http'),
    import('@opentelemetry/instrumentation-undici'),
    import('@fastify/otel'),
    import('@opentelemetry/api'),
  ]);

  // The SDK's own warnings (an endpoint that refuses, a bad protocol value) go
  // to the service log. `otel_diag` marks them so the log bridge does not send
  // an export failure back through the exporter that failed. With
  // OTEL_LOG_LEVEL set, the SDK installs its own console logger instead.
  if (!process.env.OTEL_LOG_LEVEL) {
    const diagLog = log.child({ otel_diag: true });
    diag.setLogger(
      {
        error: (message, ...args) => diagLog.error({ args }, message),
        warn: (message, ...args) => diagLog.warn({ args }, message),
        info: (message, ...args) => diagLog.info({ args }, message),
        debug: (message, ...args) => diagLog.debug({ args }, message),
        verbose: (message, ...args) => diagLog.trace({ args }, message),
      },
      DiagLogLevel.WARN,
    );
  }

  const serviceName = defaultServiceName();
  const sdk = new NodeSDK({
    ...(serviceName ? { serviceName } : {}),
    instrumentations: [
      new HttpInstrumentation(),
      // SPARQL backends are called with undici, which `node:http`
      // instrumentation does not see. This one listens on undici's
      // diagnostics channels, so it needs no load-order care.
      new UndiciInstrumentation(),
      // @opentelemetry/instrumentation-fastify is deprecated upstream in favor of
      // this Fastify-maintained replacement (issue #203). `registerOnInitialization`
      // lets it hook every fastify instance as it's constructed, since this module
      // runs before the app instance exists and so cannot register it as a plugin
      // directly.
      new FastifyOtelInstrumentation({ registerOnInitialization: true }),
    ],
  });

  sdk.start();
  log.info(
    {
      serviceName: serviceName ?? process.env.OTEL_SERVICE_NAME ?? null,
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null,
      protocol: process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? 'http/protobuf',
    },
    'OpenTelemetry SDK started',
  );
  return sdk;
}

if (globalStore[HANDLE_KEY] === undefined) {
  globalStore[HANDLE_KEY] = await startTelemetry();
}

/**
 * Flush and stop telemetry. Called last in the API's teardown, after the
 * server has closed, so the spans and log lines of the final requests are sent.
 * Safe to call when telemetry is off, and more than once.
 */
export async function shutdownTelemetry(): Promise<void> {
  const handle = globalStore[HANDLE_KEY];
  if (!handle) return;
  globalStore[HANDLE_KEY] = null;
  try {
    await handle.shutdown();
    stopOtelLogBridge();
    log.info('OpenTelemetry SDK terminated');
  } catch (error) {
    stopOtelLogBridge();
    log.error({ err: error, otel_diag: true }, 'Error terminating OpenTelemetry SDK');
  }
}
