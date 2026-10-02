import { pino } from 'pino';

// One pino logger for code that has no Fastify request or instance at hand
// (services, persistence utils, executors, process-level handlers). Route
// handlers with `request.log` / `fastify.log` in scope should use those instead,
// so their lines carry the request id.
//
// Level comes from LOG_LEVEL (trace | debug | info | warn | error | fatal | silent).
// Under vitest it defaults to silent, the same switch lib/logger.ts uses to keep
// its OTel console exporter quiet; that file is the OTel meter/logger and is a
// different thing. Tests that assert on a log line spy on `log` directly.
export const log = pino({
  name: 'sqlib',
  level:
    process.env.LOG_LEVEL ??
    (process.env.VITEST || process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
});
