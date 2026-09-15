import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  NodeSDK: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    shutdown: vi.fn(),
  })),
  ConsoleSpanExporter: vi.fn(),
  HttpInstrumentation: vi.fn(),
  FastifyOtelInstrumentation: vi.fn(),
  PeriodicExportingMetricReader: vi.fn().mockImplementation((options) => options),
  ConsoleMetricExporter: vi.fn(),
  diag: { setLogger: vi.fn() },
  DiagConsoleLogger: vi.fn(),
  DiagLogLevel: { INFO: 'info' },
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: hoisted.NodeSDK,
}));

vi.mock('@opentelemetry/sdk-trace-node', () => ({
  ConsoleSpanExporter: hoisted.ConsoleSpanExporter,
}));

vi.mock('@opentelemetry/instrumentation-http', () => ({
  HttpInstrumentation: hoisted.HttpInstrumentation,
}));

vi.mock('@fastify/otel', () => ({
  FastifyOtelInstrumentation: hoisted.FastifyOtelInstrumentation,
}));

vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: hoisted.PeriodicExportingMetricReader,
  ConsoleMetricExporter: hoisted.ConsoleMetricExporter,
}));

vi.mock('@opentelemetry/api', () => ({
  diag: hoisted.diag,
  DiagConsoleLogger: hoisted.DiagConsoleLogger,
  DiagLogLevel: hoisted.DiagLogLevel,
}));

/*
 * These sit here, after the mocks they cancel, because that is where they have
 * always run: `vi.unmock` is hoisted with `vi.mock`, so writing them in an
 * `afterAll` never deferred them to the end of the file — it only hid the order
 * from a reader. Vitest 5 refuses to hoist out of a nested scope and says so,
 * which is what surfaced this.
 *
 * They are kept rather than dropped because dropping them turns the mocks above
 * back on, and the `@opentelemetry/sdk-metrics` double is not usable as one:
 * `new PeriodicExportingMetricReader(...)` in `src/otel-setup.ts` throws on it.
 * So this file has been exercising `otel-setup` against the real OpenTelemetry
 * packages, and the two things it asserts — that nothing boots when
 * `OTEL_ENABLED=false`, and that a SIGTERM handler and a started-SDK log arrive
 * when it is unset — have been true of the real ones.
 *
 * Whether it *should* run against doubles is a question for a change that can
 * fix the doubles and re-check what the assertions then mean, not for a
 * dependency bump. Moving these six lines is the whole of the migration.
 */
vi.unmock('@opentelemetry/sdk-node');
vi.unmock('@opentelemetry/sdk-trace-node');
vi.unmock('@opentelemetry/instrumentation-http');
vi.unmock('@fastify/otel');
vi.unmock('@opentelemetry/sdk-metrics');
vi.unmock('@opentelemetry/api');

describe('otel-setup', () => {
  const originalProcessOn = process.on;
  const originalEnv = { ...process.env };
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await vi.resetModules();
    hoisted.NodeSDK.mockClear();
    hoisted.FastifyOtelInstrumentation.mockClear();
    hoisted.diag.setLogger.mockClear();
    process.on = vi.fn();
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.on = originalProcessOn;
    consoleLog.mockRestore();
    consoleError.mockRestore();
    process.env = { ...originalEnv };
  });

  it('does not initialize NodeSDK when disabled', async () => {
    process.env.OTEL_ENABLED = 'false';
    await import('../src/otel-setup.js');
    expect(process.on).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining('OpenTelemetry SDK started'));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('boots NodeSDK and registers shutdown handler when enabled', async () => {
    delete process.env.OTEL_ENABLED;
    await import('../src/otel-setup.js');
    expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('OpenTelemetry SDK started'));
  });
});

afterAll(() => {
  vi.resetModules();
});
