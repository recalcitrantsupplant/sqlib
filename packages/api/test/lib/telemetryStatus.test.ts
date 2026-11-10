import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EXPORT_FAILURE_WINDOW_MS,
  TELEMETRY_HANDLE_KEY,
  dashboardUrl,
  noteExportError,
  noteSlowRun,
  resetTelemetryStatus,
  telemetryStatus,
  traceUrlFor,
} from '../../src/lib/telemetryStatus.js';

const slot = globalThis as Record<symbol, unknown>;

describe('telemetryStatus', () => {
  beforeEach(() => {
    resetTelemetryStatus();
    delete slot[TELEMETRY_HANDLE_KEY];
  });
  afterEach(() => {
    delete slot[TELEMETRY_HANDLE_KEY];
  });

  it('is off, with no endpoint or service, when no SDK is running', () => {
    const status = telemetryStatus({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' });
    expect(status.state).toBe('off');
    expect(status.serviceName).toBeNull();
    expect(status.endpoint).toBeNull();
    expect(status.protocol).toBeNull();
    expect(status.traceLinks).toBe(false);
  });

  it('reports exporting, the service, endpoint host and protocol when running', () => {
    slot[TELEMETRY_HANDLE_KEY] = {};
    const status = telemetryStatus({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://user:secret@collector.example:4318/v1',
      OTEL_SERVICE_NAME: 'sqlib-dev',
    });
    expect(status.state).toBe('exporting');
    expect(status.serviceName).toBe('sqlib-dev');
    // Host and port only: no credentials or path.
    expect(status.endpoint).toBe('collector.example:4318');
    expect(status.protocol).toBe('http/protobuf');
  });

  it('reads the service name from OTEL_RESOURCE_ATTRIBUTES', () => {
    slot[TELEMETRY_HANDLE_KEY] = {};
    expect(telemetryStatus({ OTEL_RESOURCE_ATTRIBUTES: 'a=b,service.name=sq%20lib' }).serviceName).toBe('sq lib');
  });

  it('is failing for a recent export error, and exporting again once it is old', () => {
    slot[TELEMETRY_HANDLE_KEY] = {};
    const at = Date.parse('2026-01-01T00:00:00Z');
    noteExportError('connect ECONNREFUSED', at);
    expect(telemetryStatus({}, at + 1000).state).toBe('failing');
    const later = telemetryStatus({}, at + EXPORT_FAILURE_WINDOW_MS + 1);
    expect(later.state).toBe('exporting');
    expect(later.lastExportError).toEqual({ at: '2026-01-01T00:00:00.000Z', message: 'connect ECONNREFUSED' });
  });

  it('keeps at most 500 characters of an error', () => {
    noteExportError('x'.repeat(2000));
    expect(telemetryStatus({}).lastExportError?.message).toHaveLength(500);
  });

  it('counts slow runs, with the time of the last one and the threshold', () => {
    noteSlowRun(Date.parse('2026-01-01T00:00:00Z'));
    noteSlowRun(Date.parse('2026-01-01T00:01:00Z'));
    const { slowRuns } = telemetryStatus({ SQLIB_SLOW_QUERY_MS: '250' });
    expect(slowRuns).toEqual({ count: 2, lastAt: '2026-01-01T00:01:00.000Z', thresholdMs: 250 });
    expect(telemetryStatus({ SQLIB_SLOW_QUERY_MS: 'off' }).slowRuns.thresholdMs).toBeNull();
  });

  it('serves the dashboard URL only when it is http(s)', () => {
    expect(dashboardUrl({ SQLIB_OBSERVABILITY_URL: 'https://grafana.example/d/sqlib' })).toBe(
      'https://grafana.example/d/sqlib',
    );
    expect(dashboardUrl({ SQLIB_OBSERVABILITY_URL: 'javascript:alert(1)' })).toBeNull();
    expect(dashboardUrl({ SQLIB_OBSERVABILITY_URL: 'not a url' })).toBeNull();
    expect(dashboardUrl({})).toBeNull();
  });

  describe('traceUrlFor', () => {
    it('fills {traceId}, encoded', () => {
      const env = { SQLIB_TRACE_URL_TEMPLATE: 'https://t.example/trace/{traceId}?again={traceId}' };
      expect(traceUrlFor('abc', env)).toBe('https://t.example/trace/abc?again=abc');
      expect(traceUrlFor('a/b', env)).toBe('https://t.example/trace/a%2Fb?again=a%2Fb');
    });

    it('is null without a template, without {traceId}, or for a non-http URL', () => {
      expect(traceUrlFor('abc', {})).toBeNull();
      expect(traceUrlFor('abc', { SQLIB_TRACE_URL_TEMPLATE: 'https://t.example/' })).toBeNull();
      expect(traceUrlFor('abc', { SQLIB_TRACE_URL_TEMPLATE: 'javascript:{traceId}' })).toBeNull();
    });

    it('turns trace links on only while telemetry runs', () => {
      const env = { SQLIB_TRACE_URL_TEMPLATE: 'https://t.example/{traceId}' };
      expect(telemetryStatus(env).traceLinks).toBe(false);
      slot[TELEMETRY_HANDLE_KEY] = {};
      expect(telemetryStatus(env).traceLinks).toBe(true);
    });
  });
});
