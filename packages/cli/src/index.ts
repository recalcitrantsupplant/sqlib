/**
 * `@sparql-query-lib/cli` — the `sqlib` command line.
 *
 * The binary is `dist/cli.js`. `main` is exported for a host that wants to run
 * a command line in process, as the tests do.
 */
export { main, HELP } from './main.js';
export { CliError, type Io } from './io.js';
