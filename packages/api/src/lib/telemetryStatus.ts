/**
 * What an admin sees about telemetry: is it on, is it exporting, where to, and
 * how many slow runs since start. Served by `GET /telemetry`
 * (server/metrics.ts) and shown in the web app's Settings.
 *
 * Kept in memory, per process, from start. Nothing here loads the SDK: the
 * SDK's handle is read from the global slot `otel-setup.ts` fills, and export
 * failures arrive through the diagnostic logger it installs.
 */
import { serviceName, slowQueryThresholdMs, telemetryDetail, type TelemetryDetail } from './telemetryConfig.js';

/** Where `otel-setup.ts` keeps the running SDK, or null once it is stopped. */
export const TELEMETRY_HANDLE_KEY = Symbol.for('sqlib.telemetry');

/**
 * How long an export failure keeps the state at `failing`. Batches go out every
 * few seconds and metrics every minute, so a failure older than this with none
 * since means exports have recovered.
 */
export const EXPORT_FAILURE_WINDOW_MS = 5 * 60_000;

type Env = Record<string, string | undefined>;

export type TelemetryState = 'off' | 'exporting' | 'failing';

export interface TelemetryStatus {
  state: TelemetryState;
  serviceName: string | null;
  /** Host and port of the OTLP endpoint, when one is set. */
  endpoint: string | null;
  protocol: string | null;
  lastExportError: { at: string; message: string } | null;
  slowRuns: { count: number; lastAt: string | null; thresholdMs: number | null };
  detail: TelemetryDetail;
  /** `SQLIB_OBSERVABILITY_URL`: where people look at the data. */
  dashboardUrl: string | null;
  /** Whether runs answer with a link to their trace (`SQLIB_TRACE_URL_TEMPLATE`). */
  traceLinks: boolean;
}

let lastExportError: { at: number; message: string } | null = null;
const slowRuns = { count: 0, lastAt: null as number | null };

/** Called by the SDK's diagnostic logger on an error. */
export function noteExportError(message: string, at: number = Date.now()): void {
  lastExportError = { at, message: message.slice(0, 500) };
}

/** Called by the slow query log each time it writes a line. */
export function noteSlowRun(at: number = Date.now()): void {
  slowRuns.count += 1;
  slowRuns.lastAt = at;
}

/** For tests. */
export function resetTelemetryStatus(): void {
  lastExportError = null;
  slowRuns.count = 0;
  slowRuns.lastAt = null;
}

function telemetryRunning(): boolean {
  return Boolean((globalThis as Record<symbol, unknown>)[TELEMETRY_HANDLE_KEY]);
}

function httpUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function endpointHost(env: Env): string | null {
  const raw = env.OTEL_EXPORTER_OTLP_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).host;
  } catch {
    return null;
  }
}

/** `SQLIB_OBSERVABILITY_URL`, when it is an http(s) URL. */
export function dashboardUrl(env: Env = process.env): string | null {
  return httpUrl(env.SQLIB_OBSERVABILITY_URL);
}

/**
 * The link to one trace: `SQLIB_TRACE_URL_TEMPLATE` with `{traceId}` replaced.
 * Null when the template is unset, has no `{traceId}`, or does not make an
 * http(s) URL.
 */
export function traceUrlFor(traceId: string, env: Env = process.env): string | null {
  const template = env.SQLIB_TRACE_URL_TEMPLATE?.trim();
  if (!template || !template.includes('{traceId}')) return null;
  return httpUrl(template.replaceAll('{traceId}', encodeURIComponent(traceId)));
}

export function telemetryStatus(env: Env = process.env, now: number = Date.now()): TelemetryStatus {
  const running = telemetryRunning();
  const recentFailure = lastExportError !== null && now - lastExportError.at < EXPORT_FAILURE_WINDOW_MS;
  return {
    state: !running ? 'off' : recentFailure ? 'failing' : 'exporting',
    serviceName: running ? serviceName(env) : null,
    endpoint: running ? endpointHost(env) : null,
    protocol: running ? env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim() || 'http/protobuf' : null,
    lastExportError: lastExportError
      ? { at: new Date(lastExportError.at).toISOString(), message: lastExportError.message }
      : null,
    slowRuns: {
      count: slowRuns.count,
      lastAt: slowRuns.lastAt === null ? null : new Date(slowRuns.lastAt).toISOString(),
      thresholdMs: slowQueryThresholdMs(env),
    },
    detail: telemetryDetail(env),
    dashboardUrl: dashboardUrl(env),
    traceLinks: running && traceUrlFor('0', env) !== null,
  };
}
