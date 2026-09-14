import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  NodeSDK: vi.fn(function () {
    return { start: vi.fn(), shutdown: vi.fn() };
  }),
  ConsoleSpanExporter: vi.fn(),
  HttpInstrumentation: vi.fn(),
  FastifyOtelInstrumentation: vi.fn(),
  // A function expression, not an arrow: otel-setup constructs this with `new`,
  // and an arrow function cannot be used as a constructor.
  PeriodicExportingMetricReader: vi.fn(function (options: unknown) { return options; }),
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
    expect(hoisted.NodeSDK).not.toHaveBeenCalled();
    expect(process.on).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining('OpenTelemetry SDK started'));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('boots NodeSDK and registers shutdown handler when enabled', async () => {
    delete process.env.OTEL_ENABLED;
    await import('../src/otel-setup.js');
    // Asserting on the mock keeps the module doubles load-bearing: if they are
    // ever disabled again this fails instead of silently booting a real SDK.
    expect(hoisted.NodeSDK).toHaveBeenCalledTimes(1);
    expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('OpenTelemetry SDK started'));
  });
});

afterAll(() => {
  vi.resetModules();
});
