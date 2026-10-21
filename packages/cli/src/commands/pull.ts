/**
 * `sqlib pull --from <api> --library <iri> [--out queries.json]`
 *
 * Fetch a library's export bundle from a sqlib server and write it to a file,
 * so later runs need no server. The bundle is validated and its hashes
 * verified before it is written; what the export left out is reported.
 *
 * A bearer token, when the server needs one, comes from the environment
 * variable `--token-env` names (SQLIB_TOKEN by default), never from the
 * command line, where it would land in shell history and process lists.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  InvalidBundleError,
  assertValidBundle,
  verifyBundleIntegrity,
  type ExportBundle,
} from '@sparql-query-lib/runtime';
import { CliError, type Io } from '../io.js';

export const PULL_HELP = `sqlib pull --from <api-url> --library <iri> [options]

Fetch a library's export bundle from a sqlib server: its queries, ETL jobs
and rule sets, compiled. Run them later with --bundle, with no server.

  --from <url>              the sqlib API, e.g. https://sqlib.example.org/api
  --library <iri>           the library to export
  --out <path>              write the bundle here (default queries.json; - for stdout)
  --tag <iri>[,<iri>]       only what carries these tags; repeatable
  --match any|all           a tag filter keeps any (default) or all matches
  --no-etl                  leave the ETL jobs out
  --no-rule-sets            leave the rule sets out
  --token-env <name>        the variable holding a bearer token (default SQLIB_TOKEN)
`;

interface ExportResponse {
  bundle: ExportBundle;
  skipped?: Array<{ name: string; reason: string }>;
}

export async function pullCommand(io: Io, argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: 'string' },
      library: { type: 'string' },
      out: { type: 'string', default: 'queries.json' },
      tag: { type: 'string', multiple: true },
      match: { type: 'string', default: 'any' },
      etl: { type: 'boolean', default: true },
      'rule-sets': { type: 'boolean', default: true },
      'token-env': { type: 'string', default: 'SQLIB_TOKEN' },
    },
    allowNegative: true,
    strict: true,
  });
  if (!values.from) throw new CliError('pull needs --from <api-url>.');
  if (!values.library) throw new CliError('pull needs --library <iri>.');
  if (values.match !== 'any' && values.match !== 'all') throw new CliError("--match takes 'any' or 'all'.");

  const search = new URLSearchParams({ examples: 'none' });
  const tags = (values.tag ?? []).flatMap(tag => tag.split(',')).map(tag => tag.trim()).filter(Boolean);
  if (tags.length > 0) search.set('tag', tags.join(','));
  if (values.match !== 'any') search.set('match', values.match);
  if (!values.etl) search.set('etl', 'false');
  if (!values['rule-sets']) search.set('ruleSets', 'false');
  const base = values.from.endsWith('/') ? values.from : `${values.from}/`;
  const url = new URL(`libraries/${encodeURIComponent(values.library)}/export-bundle?${search}`, base);

  const token = process.env[values['token-env']!];
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
  } catch (error) {
    throw new CliError(`Cannot reach ${url.origin}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const hint = response.status === 401 ? ` Set ${values['token-env']} to a bearer token.` : '';
    throw new CliError(`${url.origin} answered ${response.status} ${response.statusText}.${hint}${body ? `\n${body.slice(0, 500)}` : ''}`);
  }

  let body: ExportResponse;
  try {
    body = await response.json() as ExportResponse;
    assertValidBundle(body.bundle);
    await verifyBundleIntegrity(body.bundle);
  } catch (error) {
    const reason = error instanceof InvalidBundleError ? error.message : `not a bundle: ${(error as Error).message}`;
    throw new CliError(`${url.origin} sent a bundle sqlib cannot use; ${reason}`);
  }

  const json = `${JSON.stringify(body.bundle, null, 2)}\n`;
  if (values.out === '-') io.stdout(json);
  else await writeFile(path.resolve(io.cwd, values.out!), json, 'utf8');

  const { bundle } = body;
  const count = (map: Record<string, unknown> | undefined) => Object.keys(map ?? {}).length;
  io.stderr(
    `pulled ${count(bundle.queries)} queries, ${count(bundle.etlJobs)} ETL jobs and ${count(bundle.ruleSets)} rule sets`
    + `${values.out === '-' ? '' : ` to ${values.out}`}\n`,
  );
  for (const entry of body.skipped ?? []) io.stderr(`skipped '${entry.name}': ${entry.reason}\n`);
  return 0;
}
