/**
 * Sends pino lines to OpenTelemetry as log records.
 *
 * pino is loaded before the SDK starts (see `otel-setup.ts`), so the pino
 * instrumentation cannot patch it. Instead `log.ts` writes each line to stdout
 * and to this stream. The stream parses the line and emits one log record
 * through the global logger provider, which the SDK sets when it starts. Before
 * that, or with telemetry off, the API's no-op logger takes the record.
 *
 * pino writes to a multistream synchronously, inside the call that logged, so
 * the active context here is the caller's and the record carries its trace.
 */
import { Writable } from 'node:stream';
import { logs, SeverityNumber, type Attributes, type AttributeValue } from '@opentelemetry/api';

const SCOPE = 'sqlib';

// pino's numeric levels.
const SEVERITY_BY_LEVEL: Record<number, { number: SeverityNumber; text: string }> = {
  10: { number: SeverityNumber.TRACE, text: 'TRACE' },
  20: { number: SeverityNumber.DEBUG, text: 'DEBUG' },
  30: { number: SeverityNumber.INFO, text: 'INFO' },
  40: { number: SeverityNumber.WARN, text: 'WARN' },
  50: { number: SeverityNumber.ERROR, text: 'ERROR' },
  60: { number: SeverityNumber.FATAL, text: 'FATAL' },
};

// Fields pino adds to every line, and the ids the mixin adds: the record has
// its own places for time, level and trace context.
const OMITTED_FIELDS = new Set(['level', 'time', 'msg', 'pid', 'hostname', 'trace_id', 'span_id', 'trace_flags']);

// Set once telemetry has shut down: the logger provider then refuses new
// loggers, and each line would only produce an SDK warning.
let stopped = false;

/** Stop emitting. Called by `shutdownTelemetry` in otel-setup.ts. */
export function stopOtelLogBridge(): void {
  stopped = true;
}

export interface PinoLine {
  level?: number;
  time?: number;
  msg?: unknown;
  otel_diag?: boolean;
  [key: string]: unknown;
}

// Attribute values are primitives or flat arrays of one primitive type. A
// nested object (an `err`, a request summary) is kept as its JSON text, which
// Loki and App Insights can still search and parse.
function toAttributeValue(value: unknown): AttributeValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value as string[];
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) return value as number[];
  return JSON.stringify(value);
}

/**
 * Turn one parsed pino line into a log record and emit it. Lines from the SDK's
 * own diagnostics (`otel_diag`) are skipped: an export failure sent back through
 * the exporter that failed would only fail again.
 */
export function emitPinoLine(line: PinoLine): void {
  if (stopped || line.otel_diag) return;
  const severity = SEVERITY_BY_LEVEL[line.level ?? 30] ?? SEVERITY_BY_LEVEL[30];
  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(line)) {
    if (OMITTED_FIELDS.has(key) || value === undefined || value === null) continue;
    attributes[key] = toAttributeValue(value);
  }
  logs.getLogger(SCOPE).emit({
    ...(typeof line.event === 'string' ? { eventName: line.event } : {}),
    severityNumber: severity.number,
    severityText: severity.text,
    ...(typeof line.time === 'number' ? { timestamp: line.time } : {}),
    body: typeof line.msg === 'string' ? line.msg : line.msg === undefined ? '' : JSON.stringify(line.msg),
    attributes,
  });
}

/** A writable stream for `pino.multistream` that emits each line it receives. */
export function createOtelLogStream(): Writable {
  return new Writable({
    decodeStrings: false,
    write(chunk: string | Buffer, _encoding, callback) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const raw of text.split('\n')) {
        if (!raw) continue;
        try {
          emitPinoLine(JSON.parse(raw) as PinoLine);
        } catch {
          // Not a JSON line; stdout still has it.
        }
      }
      callback();
    },
  });
}
