import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import {
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics';

import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Check if OpenTelemetry should be enabled (defaults to true)
const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';

// Configuration for OTLP endpoint (Jaeger)
const OTEL_EXPORTER_OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
const USE_OTLP = process.env.NODE_ENV === 'development' && OTEL_EXPORTER_OTLP_ENDPOINT;

if (!OTEL_ENABLED) {
  // OpenTelemetry disabled, do not initialize SDK
} else {

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
  console.log(`OpenTelemetry SDK started ${USE_OTLP ? `with OTLP export to ${OTEL_EXPORTER_OTLP_ENDPOINT}` : 'with console export'}`);;

  // --- Graceful Shutdown ---
  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('OpenTelemetry SDK terminated.'))
      .catch((error) => console.error('Error terminating OpenTelemetry SDK', error))
      .finally(() => process.exit(0));
  });

  // Export the initialized SDK instance if needed elsewhere (optional)
  // export default sdk;
}
