import { metrics } from '@opentelemetry/api'; // Import metrics API
import { SeverityNumber } from '@opentelemetry/api-logs';
import { LoggerProvider, SimpleLogRecordProcessor, ConsoleLogRecordExporter } from '@opentelemetry/sdk-logs';

export const meter = metrics.getMeter('sparql-query-lib', '1.0.0'); // Application name, version

// Same switch otel-setup.ts uses, plus an off-by-default under vitest: the console
// exporter dumps ~28 lines per log record, which is 2.7k records / 77k lines of
// stdout for one api test run. That buries real failures in the CI log.
const OTEL_LOGGING_ENABLED =
  process.env.OTEL_ENABLED !== 'false' && !process.env.VITEST && process.env.NODE_ENV !== 'test';

// @opentelemetry/sdk-logs 0.221 removed `addLogRecordProcessor`: processors are
// supplied to the constructor, and SimpleLogRecordProcessor now takes an options
// object rather than a bare exporter.
const loggerProvider = new LoggerProvider({
  processors: OTEL_LOGGING_ENABLED
    ? [new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() })]
    : [],
});

// Set the global logger provider (optional, but allows getting logger via logs.getLogger globally)
// Note: The @opentelemetry/api 'logs' object for direct logging is not the standard way for sdk-logs.
// Instead, we get a logger instance from the provider.
// logs.setGlobalLoggerProvider(loggerProvider); // This line might be unnecessary/incorrect with sdk-logs

// Get a logger instance for the application
// We export this instance for use in other modules.
export const logger = loggerProvider.getLogger('sparql-query-lib', '1.0.0'); // Application name, version

// Export SeverityNumber for use elsewhere
export { SeverityNumber };

// Optional: Graceful shutdown for logging
// NodeSDK in otel-setup.ts handles shutdown for metrics and traces.
process.on('SIGTERM', () => {
  loggerProvider.shutdown()
    .then(() => console.log('OTEL Logging terminated'))
    .catch((error) => console.error('Error terminating OTEL logging', error))
    // Let the SDK shutdown handle process exit
    // .finally(() => process.exit(0));
});
