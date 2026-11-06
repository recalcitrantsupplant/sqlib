/**
 * What a run leaves behind for observability: attributes on the request span,
 * and one `sqlib.query.slow` log line when the run is slow.
 *
 * The slow line is meant to be read by a person or an LLM, in Loki, App
 * Insights or any log store: one filter (`event = sqlib.query.slow`) gives the
 * slow runs, each with the version that ran, the environment, the backend,
 * the duration and the trace id. With the version IRI, the query text can be
 * fetched from sqlib itself, so the line carries the text only when
 * `SQLIB_TELEMETRY_DETAIL` allows it (see lib/telemetryConfig.ts).
 */
import { trace, type Attributes } from '@opentelemetry/api';
import { slowQueryThresholdMs, telemetryDetail } from './telemetryConfig.js';
import { noteSlowRun } from './telemetryStatus.js';

export const SLOW_QUERY_EVENT = 'sqlib.query.slow';

export interface QueryRunRecord {
  /** The id the caller named: a query, version, group or group version. */
  targetId: string;
  /** The entity type of the target, such as `Query` or `QueryGroupVersion`. */
  targetType?: string;
  /** The version that ran, when there is one. */
  versionId?: string | null;
  /** The environment the version was resolved in; `latest` when none. */
  environment?: string | null;
  backendId?: string | null;
  backendType?: string | null;
  status: 'success' | 'failure';
  durationMs: number;
  /** Time spent waiting on the backend, when known. */
  backendDurationMs?: number;
  rowCount?: number;
  /** The saved query text, before arguments are bound. */
  queryText?: string;
  /** The arguments as the caller sent them. */
  arguments?: unknown;
  argumentSetIds?: string[];
}

interface WarnLogger {
  warn(object: Record<string, unknown>, message: string): void;
}

function spanAttributes(run: QueryRunRecord): Attributes {
  const attributes: Attributes = {
    'sqlib.target.id': run.targetId,
    'sqlib.run.status': run.status,
  };
  if (run.targetType) attributes['sqlib.target.type'] = run.targetType;
  if (run.versionId) attributes['sqlib.version.id'] = run.versionId;
  attributes['sqlib.environment'] = run.environment ?? 'latest';
  if (run.backendId) attributes['sqlib.backend.id'] = run.backendId;
  if (run.backendType) attributes['sqlib.backend.type'] = run.backendType;
  if (run.rowCount !== undefined) attributes['sqlib.result.rows'] = run.rowCount;
  return attributes;
}

/**
 * Record a finished run. Sets attributes on the active span (a no-op when
 * telemetry is off) and writes the slow line when the run took at least
 * `SQLIB_SLOW_QUERY_MS`. Returns whether the slow line was written.
 */
export function recordQueryRun(logger: WarnLogger, run: QueryRunRecord, env = process.env): boolean {
  trace.getActiveSpan()?.setAttributes(spanAttributes(run));

  // A run refused before its target was found (an unknown id) is not a query
  // run worth reading about, whatever it cost.
  if (!run.targetType) return false;
  const threshold = slowQueryThresholdMs(env);
  if (threshold === null || run.durationMs < threshold) return false;

  const detail = telemetryDetail(env);
  const line: Record<string, unknown> = {
    event: SLOW_QUERY_EVENT,
    targetId: run.targetId,
    targetType: run.targetType,
    versionId: run.versionId ?? undefined,
    environment: run.environment ?? 'latest',
    backendId: run.backendId ?? undefined,
    backendType: run.backendType ?? undefined,
    status: run.status,
    durationMs: Math.round(run.durationMs * 100) / 100,
    backendDurationMs:
      run.backendDurationMs !== undefined ? Math.round(run.backendDurationMs * 100) / 100 : undefined,
    rowCount: run.rowCount,
    thresholdMs: threshold,
  };
  if ((detail === 'text' || detail === 'text+args') && run.queryText) {
    line.queryText = run.queryText;
  }
  if (detail === 'text+args') {
    if (run.arguments !== undefined) line.arguments = run.arguments;
    if (run.argumentSetIds?.length) line.argumentSetIds = run.argumentSetIds;
  }
  noteSlowRun();
  logger.warn(line, `Slow query run: ${run.targetId} took ${Math.round(run.durationMs)} ms`);
  return true;
}
