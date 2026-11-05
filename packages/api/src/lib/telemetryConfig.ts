/**
 * Telemetry settings, read from the environment.
 *
 * Pure functions with no OpenTelemetry imports, so `otel-setup.ts`, `log.ts`
 * and the slow query log can all ask the same questions before (or without)
 * loading the SDK.
 *
 * Telemetry is off unless something says where to send it. The SDK reads the
 * standard `OTEL_*` variables itself; this module only decides whether to start
 * it at all, so a deployment that configures nothing pays nothing.
 */

type Env = Record<string, string | undefined>;

const ENDPOINT_VARIABLES = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
] as const;

const EXPORTER_VARIABLES = [
  'OTEL_TRACES_EXPORTER',
  'OTEL_METRICS_EXPORTER',
  'OTEL_LOGS_EXPORTER',
] as const;

function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function exporterList(value: string | undefined): string[] {
  return isSet(value) ? value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) : [];
}

/**
 * Whether to start the OpenTelemetry SDK.
 *
 * 1. `OTEL_ENABLED=false` or `OTEL_SDK_DISABLED=true`: off.
 * 2. `OTEL_ENABLED=true`: on. With no endpoint the SDK sends OTLP to
 *    `http://localhost:4318`, the OTLP default.
 * 3. Any OTLP endpoint variable set: on. This is what the Azure Container Apps
 *    managed agent injects.
 * 4. Any `OTEL_*_EXPORTER` set to something other than `none`: on, so
 *    `OTEL_TRACES_EXPORTER=console` still works for a quick look.
 * 5. Otherwise off.
 */
export function telemetryEnabled(env: Env = process.env): boolean {
  if (env.OTEL_ENABLED?.trim().toLowerCase() === 'false') return false;
  if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === 'true') return false;
  if (env.OTEL_ENABLED?.trim().toLowerCase() === 'true') return true;
  if (ENDPOINT_VARIABLES.some((name) => isSet(env[name]))) return true;
  return EXPORTER_VARIABLES.some((name) => exporterList(env[name]).some((exporter) => exporter !== 'none'));
}

/**
 * Whether pino lines also go out as OpenTelemetry log records. The SDK's own
 * default for `OTEL_LOGS_EXPORTER` is `otlp`, so this is on whenever telemetry
 * is, unless the logs exporter is `none`.
 */
export function logsExportEnabled(env: Env = process.env): boolean {
  if (!telemetryEnabled(env)) return false;
  return !exporterList(env.OTEL_LOGS_EXPORTER).includes('none');
}

/** How much of a run goes into spans and the slow query log. */
export type TelemetryDetail = 'ids' | 'text' | 'text+args';

const DETAIL_LEVELS: readonly TelemetryDetail[] = ['ids', 'text', 'text+args'];

/**
 * `SQLIB_TELEMETRY_DETAIL`: `ids` (default) records ids only; `text` adds the
 * saved query text; `text+args` also adds the arguments the caller sent, which
 * can hold private values. An unknown value falls back to `ids`.
 */
export function telemetryDetail(env: Env = process.env): TelemetryDetail {
  const raw = env.SQLIB_TELEMETRY_DETAIL?.trim().toLowerCase();
  return DETAIL_LEVELS.find((level) => level === raw) ?? 'ids';
}

export const DEFAULT_SLOW_QUERY_MS = 1000;

/**
 * `SQLIB_SLOW_QUERY_MS`: a run that takes at least this many milliseconds
 * writes one `sqlib.query.slow` log line. `off` turns the line off; `0` logs
 * every run. An unparseable value keeps the default.
 */
export function slowQueryThresholdMs(env: Env = process.env): number | null {
  const raw = env.SQLIB_SLOW_QUERY_MS?.trim().toLowerCase();
  if (!raw) return DEFAULT_SLOW_QUERY_MS;
  if (raw === 'off' || raw === 'false' || raw === 'none') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SLOW_QUERY_MS;
}

/**
 * The service name to give the SDK, or undefined when the environment already
 * names one (`OTEL_SERVICE_NAME`, or `service.name` in
 * `OTEL_RESOURCE_ATTRIBUTES`) and the SDK should keep it.
 */
export function defaultServiceName(env: Env = process.env): string | undefined {
  if (isSet(env.OTEL_SERVICE_NAME)) return undefined;
  const attributes = env.OTEL_RESOURCE_ATTRIBUTES ?? '';
  if (attributes.split(',').some((pair) => pair.split('=')[0]?.trim() === 'service.name')) return undefined;
  return 'sqlib';
}
