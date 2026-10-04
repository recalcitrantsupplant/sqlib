import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  // Function expressions, not arrows: otel-setup constructs both of these with
  // `new`, and an arrow function cannot be used as a constructor.
  NodeSDK: vi.fn(function () {
    return { start: vi.fn(), shutdown: vi.fn() };
  }),
  ConsoleSpanExporter: vi.fn(),
  HttpInstrumentation: vi.fn(),
  FastifyOtelInstrumentation: vi.fn(),
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
  let logInfo: ReturnType<typeof vi.spyOn>;
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await vi.resetModules();
    hoisted.NodeSDK.mockClear();
    hoisted.FastifyOtelInstrumentation.mockClear();
    hoisted.diag.setLogger.mockClear();
    // After resetModules, so this is the same `log` instance otel-setup imports;
    // before stubbing process.on, because pino registers its own exit hook and
    // the assertions below are about otel-setup's handlers only.
    const { log } = await import('../src/lib/log.js');
    logInfo = vi.spyOn(log, 'info');
    logError = vi.spyOn(log, 'error');
    process.on = vi.fn();
  });

  afterEach(() => {
    process.on = originalProcessOn;
    logInfo.mockRestore();
    logError.mockRestore();
    process.env = { ...originalEnv };
  });

  it('does not initialize NodeSDK when disabled', async () => {
    process.env.OTEL_ENABLED = 'false';
    await import('../src/otel-setup.js');
    expect(hoisted.NodeSDK).not.toHaveBeenCalled();
    expect(process.on).not.toHaveBeenCalled();
    expect(logInfo).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('boots NodeSDK and registers shutdown handler when enabled', async () => {
    delete process.env.OTEL_ENABLED;
    await import('../src/otel-setup.js');
    // Asserting on the double keeps it load-bearing: if these mocks are ever
    // cancelled again, this fails instead of silently booting a real SDK.
    expect(hoisted.NodeSDK).toHaveBeenCalledTimes(1);
    expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(logInfo).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('OpenTelemetry SDK started'));
  });
});

afterAll(() => {
  vi.resetModules();
});
