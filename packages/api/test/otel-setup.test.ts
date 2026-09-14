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
  vi.unmock('@opentelemetry/sdk-node');
  vi.unmock('@opentelemetry/sdk-trace-node');
  vi.unmock('@opentelemetry/instrumentation-http');
  vi.unmock('@fastify/otel');
  vi.unmock('@opentelemetry/sdk-metrics');
  vi.unmock('@opentelemetry/api');
  vi.resetModules();
});
