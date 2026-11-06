import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  // Function expressions, not arrows: otel-setup constructs these with `new`,
  // and an arrow function cannot be used as a constructor.
  NodeSDK: vi.fn(function () {
    return { start: hoisted.start, shutdown: hoisted.shutdown };
  }),
  start: vi.fn(),
  shutdown: vi.fn(async () => {}),
  HttpInstrumentation: vi.fn(function () { return { name: 'http' }; }),
  UndiciInstrumentation: vi.fn(function () { return { name: 'undici' }; }),
  FastifyOtelInstrumentation: vi.fn(function () { return { name: 'fastify' }; }),
  diag: { setLogger: vi.fn() },
  DiagLogLevel: { WARN: 'warn' },
}));

vi.mock('@opentelemetry/sdk-node', () => ({ NodeSDK: hoisted.NodeSDK }));
vi.mock('@opentelemetry/instrumentation-http', () => ({ HttpInstrumentation: hoisted.HttpInstrumentation }));
vi.mock('@opentelemetry/instrumentation-undici', () => ({ UndiciInstrumentation: hoisted.UndiciInstrumentation }));
vi.mock('@fastify/otel', () => ({ FastifyOtelInstrumentation: hoisted.FastifyOtelInstrumentation }));
vi.mock('@opentelemetry/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@opentelemetry/api')>()),
  diag: hoisted.diag,
  DiagLogLevel: hoisted.DiagLogLevel,
}));

const HANDLE_KEY = Symbol.for('sqlib.telemetry');
const OTEL_VARIABLES = [
  'OTEL_ENABLED',
  'OTEL_SDK_DISABLED',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_TRACES_EXPORTER',
  'OTEL_SERVICE_NAME',
  'OTEL_RESOURCE_ATTRIBUTES',
  'OTEL_LOG_LEVEL',
];

describe('otel-setup', () => {
  const originalProcessOn = process.on;
  const originalEnv = { ...process.env };
  let logInfo: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await vi.resetModules();
    vi.clearAllMocks();
    for (const name of OTEL_VARIABLES) delete process.env[name];
    // The SDK handle lives on globalThis so a second import cannot start a
    // second SDK; each test starts from no handle at all.
    delete (globalThis as Record<symbol, unknown>)[HANDLE_KEY];
    // After resetModules, so this is the same `log` instance otel-setup imports.
    const { log } = await import('../src/lib/log.js');
    logInfo = vi.spyOn(log, 'info');
    process.on = vi.fn();
  });

  afterEach(() => {
    process.on = originalProcessOn;
    logInfo.mockRestore();
    process.env = { ...originalEnv };
    delete (globalThis as Record<symbol, unknown>)[HANDLE_KEY];
  });

  it('does not start when nothing says where to send telemetry', async () => {
    await import('../src/otel-setup.js');
    expect(hoisted.NodeSDK).not.toHaveBeenCalled();
    expect(logInfo).not.toHaveBeenCalled();
  });

  it('does not start with OTEL_ENABLED=false, even with an endpoint', async () => {
    process.env.OTEL_ENABLED = 'false';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    await import('../src/otel-setup.js');
    expect(hoisted.NodeSDK).not.toHaveBeenCalled();
  });

  it('starts with an endpoint, leaving exporters to the SDK environment', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    await import('../src/otel-setup.js');

    expect(hoisted.NodeSDK).toHaveBeenCalledTimes(1);
    expect(hoisted.start).toHaveBeenCalledTimes(1);
    const options = hoisted.NodeSDK.mock.calls[0][0] as Record<string, unknown>;
    // No exporter or reader is passed: the SDK reads OTEL_* itself, so any
    // protocol, header and per-signal setting works.
    expect(options).not.toHaveProperty('traceExporter');
    expect(options).not.toHaveProperty('metricReaders');
    expect(options).not.toHaveProperty('logRecordProcessors');
    expect(options.serviceName).toBe('sqlib');
    expect(options.instrumentations).toEqual([{ name: 'http' }, { name: 'undici' }, { name: 'fastify' }]);
    expect(hoisted.FastifyOtelInstrumentation).toHaveBeenCalledWith({ registerOnInitialization: true });
    expect(logInfo).toHaveBeenCalledWith(expect.anything(), 'OpenTelemetry SDK started');
  });

  it('keeps a service name the environment already gives', async () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_SERVICE_NAME = 'sqlib-prod';
    await import('../src/otel-setup.js');
    const options = hoisted.NodeSDK.mock.calls[0][0] as Record<string, unknown>;
    expect(options).not.toHaveProperty('serviceName');
  });

  it('sends SDK diagnostics to the service log, unless OTEL_LOG_LEVEL is set', async () => {
    process.env.OTEL_ENABLED = 'true';
    await import('../src/otel-setup.js');
    expect(hoisted.diag.setLogger).toHaveBeenCalledWith(expect.any(Object), 'warn');

    await vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as Record<symbol, unknown>)[HANDLE_KEY];
    process.env.OTEL_LOG_LEVEL = 'debug';
    await import('../src/otel-setup.js');
    expect(hoisted.diag.setLogger).not.toHaveBeenCalled();
  });

  it('notes an SDK error as the last export error, for the status in Settings', async () => {
    process.env.OTEL_ENABLED = 'true';
    await import('../src/otel-setup.js');
    const { telemetryStatus, resetTelemetryStatus } = await import('../src/lib/telemetryStatus.js');
    resetTelemetryStatus();
    const logger = hoisted.diag.setLogger.mock.calls[0][0] as { error: (m: string, ...a: unknown[]) => void };
    logger.error('{"message":"connect ECONNREFUSED 127.0.0.1:4318","code":"ECONNREFUSED"}');
    const status = telemetryStatus();
    expect(status.state).toBe('failing');
    expect(status.lastExportError?.message).toBe('connect ECONNREFUSED 127.0.0.1:4318');
  });

  it('diagMessage reads the message out of a serialised error, and adds an Error argument', async () => {
    const { diagMessage } = await import('../src/otel-setup.js');
    expect(diagMessage('{"message":"timeout"}')).toBe('timeout');
    expect(diagMessage('export failed', [new Error('socket hang up')])).toBe('export failed: socket hang up');
    expect(diagMessage('plain text', ['not an error'])).toBe('plain text');
  });

  it('registers no signal handler of its own, and shutdownTelemetry flushes once', async () => {
    process.env.OTEL_ENABLED = 'true';
    const { shutdownTelemetry } = await import('../src/otel-setup.js');
    // The API's teardown (index.ts) owns shutdown; a second SIGTERM handler
    // that exits would cut the server's own graceful close short.
    expect(process.on).not.toHaveBeenCalled();

    await shutdownTelemetry();
    await shutdownTelemetry();
    expect(hoisted.shutdown).toHaveBeenCalledTimes(1);
  });

  it('starts one SDK per process, even when loaded twice', async () => {
    process.env.OTEL_ENABLED = 'true';
    await import('../src/otel-setup.js');
    await vi.resetModules();
    await import('../src/otel-setup.js');
    expect(hoisted.NodeSDK).toHaveBeenCalledTimes(1);
  });

  it('shutdownTelemetry is a no-op when telemetry is off', async () => {
    const { shutdownTelemetry } = await import('../src/otel-setup.js');
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
    expect(hoisted.shutdown).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  vi.resetModules();
});
