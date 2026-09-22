/**
 * OpenTelemetry bootstrap.
 *
 * Imported for its side effect, and imported *early* — before `fastify` and
 * before anything touches `node:http` — because `HttpInstrumentation` patches
 * the http module as it loads and `FastifyOtelInstrumentation` hooks fastify
 * instances as they are constructed.
 *
 * The SDK is pulled in with dynamic `import()` inside the enabled branch rather
 * than with static imports at the top of the file. Statically, the whole
 * OpenTelemetry SDK — the node SDK, two OTLP exporters, the http and fastify
 * instrumentations, the metrics SDK — was loaded and compiled on every boot
 * *including* boots with `OTEL_ENABLED=false`, which cost ~220ms of a ~2.8s
 * cold start for code that was then never used. A deployment with telemetry on
 * pays exactly what it did before; one with it off pays nothing.
 *
 * The `await` here is a top-level await, so any module importing this one still
 * waits for the SDK to be started before its own body runs — the ordering the
 * instrumentations depend on is unchanged. It does mean this module can no
 * longer be loaded with `node --require`, which requires a module without
 * top-level await; nothing needs to, since importing it is what starts it.
 */

// Check if OpenTelemetry should be enabled (defaults to true)
const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';

// Configuration for OTLP endpoint (Jaeger)
const OTEL_EXPORTER_OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
const USE_OTLP = process.env.NODE_ENV === 'development' && OTEL_EXPORTER_OTLP_ENDPOINT;

if (OTEL_ENABLED) {
  const [
    { NodeSDK },
    { ConsoleSpanExporter },
    { OTLPTraceExporter },
    { OTLPMetricExporter },
    { HttpInstrumentation },
    { FastifyOtelInstrumentation },
    { PeriodicExportingMetricReader, ConsoleMetricExporter },
    { diag, DiagConsoleLogger, DiagLogLevel },
  ] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/sdk-trace-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/exporter-metrics-otlp-http'),
    import('@opentelemetry/instrumentation-http'),
    import('@fastify/otel'),
    import('@opentelemetry/sdk-metrics'),
    import('@opentelemetry/api'),
  ]);

  // Optional: Configure OpenTelemetry diagnostic logger
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

  // --- SDK Configuration ---

  // Note: We configure the LoggerProvider here, but the SDK doesn't automatically
  // integrate it like it does for traces and metrics. We still need to manage
  // the LoggerProvider instance separately or ensure it's set globally if needed elsewhere.
  // For simplicity, we'll keep the logger setup in logger.ts for now,
  // but be aware NodeSDK primarily focuses on traces and metrics initialization.

  // Configure exporters based on environment
  const traceExporter = USE_OTLP
    ? new OTLPTraceExporter({ url: `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` })
    : new ConsoleSpanExporter();

  const metricExporter = USE_OTLP
    ? new OTLPMetricExporter({ url: `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics` })
    : new ConsoleMetricExporter();

  const sdk = new NodeSDK({
    // Configure Trace Exporter
    traceExporter,

    // Configure Metric Exporter
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 30000, // More frequent for development
    }),

    // Enable Automatic Instrumentations (e.g., for http)
    instrumentations: [
      new HttpInstrumentation(),
      // @opentelemetry/instrumentation-fastify is deprecated upstream in favor of
      // this Fastify-maintained replacement (issue #203). `registerOnInitialization`
      // lets it hook every fastify instance as it's constructed, since this module
      // runs before the app instance exists and so cannot register it as a plugin
      // directly.
      new FastifyOtelInstrumentation({ registerOnInitialization: true }),
      // Add other instrumentations here if needed, excluding V8
    ],

    // Note: sdk-logs integration with NodeSDK is less direct.
    // LoggerProvider needs separate setup (as we have in logger.ts).
  });

  // --- Start the SDK ---
  sdk.start();
  console.log(`OpenTelemetry SDK started ${USE_OTLP ? `with OTLP export to ${OTEL_EXPORTER_OTLP_ENDPOINT}` : 'with console export'}`);

  // --- Graceful Shutdown ---
  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('OpenTelemetry SDK terminated.'))
      .catch((error) => console.error('Error terminating OpenTelemetry SDK', error))
      .finally(() => process.exit(0));
  });
}

export {};
