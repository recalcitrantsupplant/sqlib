import { pino, type LoggerOptions, type DestinationStream } from 'pino';
import { trace } from '@opentelemetry/api';
import { createOtelLogStream } from './otelLogBridge.js';
import { logsExportEnabled } from './telemetryConfig.js';

// One pino logger for code that has no Fastify request or instance at hand
// (services, persistence utils, executors, process-level handlers). Route
// handlers with `request.log` / `fastify.log` in scope should use those instead,
// so their lines carry the request id.
//
// Level comes from LOG_LEVEL (trace | debug | info | warn | error | fatal | silent).
// Under vitest it defaults to silent. Tests that assert on a log line spy on
// `log` directly.
//
// Telemetry (see otel-setup.ts):
// - Every line logged inside a span carries `trace_id` and `span_id`, so a log
//   line can be found from a trace and the other way round.
// - When OTLP log export is on, each line also goes to OpenTelemetry through
//   `otelLogBridge.ts`. stdout keeps every line either way.

/**
 * Adds the active span's ids to a line. With telemetry off there is never an
 * active span, so this adds nothing.
 */
export function traceMixin(): Record<string, string> {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext) return {};
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: `0${spanContext.traceFlags.toString(16)}`.slice(-2),
  };
}

/**
 * Where lines go: stdout alone, or stdout and OpenTelemetry. stdout is written
 * synchronously, as pino's default destination is, so a fatal line is out
 * before `process.exit` (see server/bootstrap.ts). Each stream accepts every
 * level; the logger's own level does the filtering.
 */
export function logDestination(): DestinationStream | undefined {
  if (!logsExportEnabled()) return undefined;
  return pino.multistream([
    { level: 'trace', stream: pino.destination({ dest: 1, sync: true }) },
    { level: 'trace', stream: createOtelLogStream() },
  ]);
}

/**
 * Logger options for a Fastify instance, so request logs get the same trace ids
 * and the same destination as `log`. Fastify's own default level (info) is kept.
 */
export function fastifyLoggerOptions(): LoggerOptions & { stream?: DestinationStream } {
  const stream = logDestination();
  return {
    mixin: traceMixin,
    ...(stream ? { stream } : {}),
  };
}

const logOptions: LoggerOptions = {
  name: 'sqlib',
  level:
    process.env.LOG_LEVEL ??
    (process.env.VITEST || process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  mixin: traceMixin,
};
const logStream = logDestination();

export const log = logStream ? pino(logOptions, logStream) : pino(logOptions);
