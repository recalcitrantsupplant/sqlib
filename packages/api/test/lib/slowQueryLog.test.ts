import { describe, it, expect, afterEach, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import { recordQueryRun, SLOW_QUERY_EVENT, type QueryRunRecord } from '../../src/lib/slowQueryLog.js';
import { resetTelemetryStatus, telemetryStatus } from '../../src/lib/telemetryStatus.js';

const run: QueryRunRecord = {
  targetId: 'urn:sqlib:query:q',
  targetType: 'Query',
  versionId: 'urn:sqlib:query-version:v1',
  environment: 'prod',
  backendId: 'urn:b',
  backendType: 'http',
  status: 'success',
  durationMs: 1500.456,
  backendDurationMs: 1400.111,
  rowCount: 12,
  queryText: 'SELECT * WHERE { VALUES ?s { UNDEF } ?s ?p ?o }',
  arguments: [{ head: { vars: ['s'] }, results: { bindings: [] } }],
  argumentSetIds: ['urn:sqlib:argument-set:a'],
};

function logger() {
  return { warn: vi.fn() };
}

describe('recordQueryRun', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes nothing under the threshold', () => {
    const log = logger();
    expect(recordQueryRun(log, { ...run, durationMs: 999 }, {})).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('counts each slow line for the status in Settings', () => {
    resetTelemetryStatus();
    recordQueryRun(logger(), { ...run, durationMs: 10 }, {});
    recordQueryRun(logger(), run, {});
    expect(telemetryStatus({}).slowRuns.count).toBe(1);
  });

  it('writes ids only by default', () => {
    const log = logger();
    expect(recordQueryRun(log, run, {})).toBe(true);
    const [line, message] = log.warn.mock.calls[0];
    expect(line).toMatchObject({
      event: SLOW_QUERY_EVENT,
      targetId: run.targetId,
      versionId: run.versionId,
      environment: 'prod',
      backendId: 'urn:b',
      status: 'success',
      durationMs: 1500.46,
      backendDurationMs: 1400.11,
      rowCount: 12,
      thresholdMs: 1000,
    });
    expect(line).not.toHaveProperty('queryText');
    expect(line).not.toHaveProperty('arguments');
    expect(message).toContain('took 1500 ms');
  });

  it('adds the text at text, and the arguments at text+args', () => {
    const textLog = logger();
    recordQueryRun(textLog, run, { SQLIB_TELEMETRY_DETAIL: 'text' });
    expect(textLog.warn.mock.calls[0][0]).toMatchObject({ queryText: run.queryText });
    expect(textLog.warn.mock.calls[0][0]).not.toHaveProperty('arguments');

    const argsLog = logger();
    recordQueryRun(argsLog, run, { SQLIB_TELEMETRY_DETAIL: 'text+args' });
    expect(argsLog.warn.mock.calls[0][0]).toMatchObject({
      queryText: run.queryText,
      arguments: run.arguments,
      argumentSetIds: run.argumentSetIds,
    });
  });

  it('can be turned off, and skips a run whose target was not found', () => {
    const log = logger();
    expect(recordQueryRun(log, run, { SQLIB_SLOW_QUERY_MS: 'off' })).toBe(false);
    expect(recordQueryRun(log, { ...run, targetType: undefined }, { SQLIB_SLOW_QUERY_MS: '0' })).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('names the environment latest when the run named none', () => {
    const log = logger();
    recordQueryRun(log, { ...run, environment: null }, { SQLIB_SLOW_QUERY_MS: '0' });
    expect(log.warn.mock.calls[0][0]).toMatchObject({ environment: 'latest' });
  });

  it('puts the run on the active span, slow or not', () => {
    const setAttributes = vi.fn();
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({ setAttributes } as never);
    recordQueryRun(logger(), { ...run, durationMs: 5 }, {});
    expect(setAttributes).toHaveBeenCalledWith({
      'sqlib.target.id': run.targetId,
      'sqlib.target.type': 'Query',
      'sqlib.version.id': run.versionId,
      'sqlib.environment': 'prod',
      'sqlib.backend.id': 'urn:b',
      'sqlib.backend.type': 'http',
      'sqlib.result.rows': 12,
      'sqlib.run.status': 'success',
    });
  });
});
