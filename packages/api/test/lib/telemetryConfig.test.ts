import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SLOW_QUERY_MS,
  defaultServiceName,
  logsExportEnabled,
  slowQueryThresholdMs,
  telemetryDetail,
  telemetryEnabled,
} from '../../src/lib/telemetryConfig.js';

describe('telemetryEnabled', () => {
  it.each([
    [{}, false],
    [{ OTEL_ENABLED: 'true' }, true],
    [{ OTEL_ENABLED: 'TRUE' }, true],
    [{ OTEL_ENABLED: 'false', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318' }, false],
    [{ OTEL_SDK_DISABLED: 'true', OTEL_ENABLED: 'true' }, false],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318' }, true],
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: '  ' }, false],
    [{ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://c:4318/v1/traces' }, true],
    [{ OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://c:4318/v1/logs' }, true],
    [{ OTEL_TRACES_EXPORTER: 'console' }, true],
    [{ OTEL_TRACES_EXPORTER: 'none', OTEL_METRICS_EXPORTER: 'none' }, false],
    // Unknown OTEL_ENABLED values fall through to the other rules.
    [{ OTEL_ENABLED: 'yes' }, false],
  ])('%j → %s', (env, expected) => {
    expect(telemetryEnabled(env)).toBe(expected);
  });
});

describe('logsExportEnabled', () => {
  it('follows telemetry, unless the logs exporter is none', () => {
    expect(logsExportEnabled({})).toBe(false);
    expect(logsExportEnabled({ OTEL_ENABLED: 'true' })).toBe(true);
    expect(logsExportEnabled({ OTEL_ENABLED: 'true', OTEL_LOGS_EXPORTER: 'none' })).toBe(false);
    expect(logsExportEnabled({ OTEL_ENABLED: 'true', OTEL_LOGS_EXPORTER: 'otlp,console' })).toBe(true);
  });
});

describe('telemetryDetail', () => {
  it('defaults to ids and accepts the three levels', () => {
    expect(telemetryDetail({})).toBe('ids');
    expect(telemetryDetail({ SQLIB_TELEMETRY_DETAIL: 'text' })).toBe('text');
    expect(telemetryDetail({ SQLIB_TELEMETRY_DETAIL: ' TEXT+ARGS ' })).toBe('text+args');
    expect(telemetryDetail({ SQLIB_TELEMETRY_DETAIL: 'everything' })).toBe('ids');
  });
});

describe('slowQueryThresholdMs', () => {
  it('defaults, parses, and turns off', () => {
    expect(slowQueryThresholdMs({})).toBe(DEFAULT_SLOW_QUERY_MS);
    expect(slowQueryThresholdMs({ SQLIB_SLOW_QUERY_MS: '250' })).toBe(250);
    expect(slowQueryThresholdMs({ SQLIB_SLOW_QUERY_MS: '0' })).toBe(0);
    expect(slowQueryThresholdMs({ SQLIB_SLOW_QUERY_MS: 'off' })).toBeNull();
    expect(slowQueryThresholdMs({ SQLIB_SLOW_QUERY_MS: '-5' })).toBe(DEFAULT_SLOW_QUERY_MS);
    expect(slowQueryThresholdMs({ SQLIB_SLOW_QUERY_MS: 'soon' })).toBe(DEFAULT_SLOW_QUERY_MS);
  });
});

describe('defaultServiceName', () => {
  it('is sqlib unless the environment names the service', () => {
    expect(defaultServiceName({})).toBe('sqlib');
    expect(defaultServiceName({ OTEL_SERVICE_NAME: 'gswa' })).toBeUndefined();
    expect(defaultServiceName({ OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=prod,service.name=gswa' })).toBeUndefined();
    expect(defaultServiceName({ OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=prod' })).toBe('sqlib');
  });
});
