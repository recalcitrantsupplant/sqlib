/**
 * `node dist/replication/main.js <server command...>`
 *
 * The image's entrypoint script runs this when `SQLIB_SQLITE_REPLICA_URL` or
 * `SQLIB_LITESTREAM_CONFIG` is set. See `supervisor.ts`.
 */
import { jsonLogger, runSupervisor } from './supervisor.js';

runSupervisor(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    jsonLogger.error((error as Error).message, {});
    process.exit(1);
  }
);
