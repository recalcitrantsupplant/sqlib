/**
 * The `sqlib` command line, as a function of its arguments and streams.
 *
 * `cli.ts` binds it to the process. Tests call it directly with strings, so
 * every command is exercised end to end without a child process.
 */
import { CHECK_HELP, checkCommand } from './commands/check.js';
import { ETL_HELP, etlCommand } from './commands/etl.js';
import { PULL_HELP, pullCommand } from './commands/pull.js';
import { QUERY_HELP, queryCommand } from './commands/query.js';
import { RULES_HELP, rulesCommand } from './commands/rules.js';
import { CliError, type Io } from './io.js';

export const HELP = `sqlib: run sqlib queries, ETL jobs and rule sets with no server

Usage:
  sqlib query --file <q.rq> [--arg v=term]… [--endpoint <url> | --data <file>…]
  sqlib etl run --job <job.json> [--out <file>]
  sqlib rules run --srl <rules.srl> --data <file>… [--out <file>]
  sqlib check <file>…
  sqlib pull --from <api-url> --library <iri> [--out <bundle.json>]

query, etl run and rules run also take --bundle <bundle.json> with
--query, --job or --rule-set <key>, to run what 'sqlib pull' fetched.

Run 'sqlib <command> --help' for a command's options. A path of '-' means
standard input or output.
`;

const COMMANDS: Record<string, { run: (io: Io, argv: string[]) => Promise<number>; help: string }> = {
  query: { run: queryCommand, help: QUERY_HELP },
  etl: { run: etlCommand, help: ETL_HELP },
  rules: { run: rulesCommand, help: RULES_HELP },
  check: { run: checkCommand, help: CHECK_HELP },
  pull: { run: pullCommand, help: PULL_HELP },
};

/** Run one command line. Resolves to the exit status; never throws. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    io.stdout(HELP);
    return name ? 0 : 1;
  }
  const command = COMMANDS[name];
  if (!command) {
    io.stderr(`Unknown command '${name}'.\n\n${HELP}`);
    return 1;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    io.stdout(command.help);
    return 0;
  }
  try {
    return await command.run(io, rest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A parseArgs refusal names the bad option; the command's help says the rest.
    const isUsage = (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS');
    io.stderr(`sqlib ${name}: ${message}\n${isUsage ? `\n${command.help}` : ''}`);
    return error instanceof CliError ? error.exitCode : 1;
  }
}
