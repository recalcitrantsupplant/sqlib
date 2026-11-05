import { metrics } from '@opentelemetry/api';

// The application meter. With telemetry off (see otel-setup.ts) the global
// meter provider is the API's no-op one, so recording costs next to nothing.
//
// Log lines go through pino (`lib/log.ts`), which forwards them to
// OpenTelemetry when log export is on; there is no separate OTel logger here.
export const meter = metrics.getMeter('sparql-query-lib', '1.0.0');
