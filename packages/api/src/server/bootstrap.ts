/**
 * Process-level setup, imported first by `index.ts` so it runs before any other
 * module's side effects: the crash handlers, `.env`, and OpenTelemetry (whose
 * instrumentation has to patch modules before they are loaded).
 */

// `log` rather than `app.log`: these can fire before the Fastify instance
// exists. pino's default destination writes synchronously, so the fatal line is
// out before `process.exit`. `keys` is kept for throwables that are not Errors.
import { log } from '../lib/log.js';

process.on('uncaughtException', (e) => {
  log.fatal({ err: e, keys: Object.keys(e ?? {}) }, 'Uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  log.error({ err: e }, 'Unhandled promise rejection');
});

import 'dotenv/config';
import '../otel-setup.js';
