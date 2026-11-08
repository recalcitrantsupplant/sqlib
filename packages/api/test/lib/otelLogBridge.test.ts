import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pino } from 'pino';
import { logs, trace, SeverityNumber } from '@opentelemetry/api';
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { createOtelLogStream, emitPinoLine } from '../../src/lib/otelLogBridge.js';
import { traceMixin } from '../../src/lib/log.js';

describe('otelLogBridge', () => {
  let exporter: InMemoryLogRecordExporter;
  let provider: LoggerProvider;

  beforeEach(() => {
    exporter = new InMemoryLogRecordExporter();
    provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    logs.setGlobalLoggerProvider(provider);
  });

  afterEach(async () => {
    await provider.shutdown();
    logs.disable();
    vi.restoreAllMocks();
  });

  it('maps a pino line to a log record', () => {
    emitPinoLine({
      level: 40,
      time: 1_700_000_000_000,
      pid: 1,
      hostname: 'h',
      msg: 'Slow query run',
      event: 'sqlib.query.slow',
      durationMs: 1200,
      trace_id: 'abc',
      err: { message: 'boom' },
      tags: ['a', 'b'],
    });

    const [record] = exporter.getFinishedLogRecords();
    expect(record.severityNumber).toBe(SeverityNumber.WARN);
    expect(record.severityText).toBe('WARN');
    expect(record.body).toBe('Slow query run');
    expect(record.eventName).toBe('sqlib.query.slow');
    expect(record.attributes).toEqual({
      event: 'sqlib.query.slow',
      durationMs: 1200,
      // Nested objects travel as JSON text; flat arrays stay arrays.
      err: '{"message":"boom"}',
      tags: ['a', 'b'],
    });
    // pino's own fields and the trace ids are not repeated as attributes.
    expect(record.attributes).not.toHaveProperty('pid');
    expect(record.attributes).not.toHaveProperty('trace_id');
  });

  it('skips the SDK diagnostics, so an export failure is not exported', () => {
    emitPinoLine({ level: 40, msg: 'export failed', otel_diag: true });
    expect(exporter.getFinishedLogRecords()).toHaveLength(0);
  });

  it('receives lines from pino through a multistream, ignoring non-JSON text', () => {
    const stream = createOtelLogStream();
    const logger = pino({ level: 'debug' }, pino.multistream([{ level: 'trace', stream }]));
    logger.debug({ backendId: 'urn:b' }, 'first');
    logger.error('second');
    stream.write('not json\n');

    const records = exporter.getFinishedLogRecords();
    expect(records.map((record) => [record.body, record.severityText])).toEqual([
      ['first', 'DEBUG'],
      ['second', 'ERROR'],
    ]);
    expect(records[0].attributes).toEqual({ backendId: 'urn:b' });
  });
});

describe('traceMixin', () => {
  afterEach(() => vi.restoreAllMocks());

  it('adds nothing outside a span', () => {
    expect(traceMixin()).toEqual({});
  });

  it('adds the active span ids', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      spanContext: () => ({ traceId: 't'.repeat(32), spanId: 's'.repeat(16), traceFlags: 1 }),
    } as never);
    expect(traceMixin()).toEqual({ trace_id: 't'.repeat(32), span_id: 's'.repeat(16), trace_flags: '01' });
  });
});
