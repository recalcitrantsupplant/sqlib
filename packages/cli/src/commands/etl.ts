/**
 * `sqlib etl run --job job.json [--out out.nt]`
 *
 * A job file names the SQL, the CONSTRUCT template and the column mapping, as
 * a stored ETL job does. The SQL runs in a sandboxed DuckDB whose profile comes
 * from flags; its rows go through `runEtl`, the same loop the API runs, a chunk
 * at a time; each chunk's RDF is written out as soon as it exists.
 *
 * The template reads only its own VALUES rows, so an empty in-process store is
 * a complete backend for it. `--endpoint` sends the CONSTRUCT elsewhere.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { TemplateCompileError, compileQueryTemplate } from '@sparql-query-lib/compiler';
import { DuckDbService } from '@sparql-query-lib/runtime-duckdb';
import { runEtl, type ColumnDefinition } from '@sparql-query-lib/runtime-etl';
import { chooseExecutor } from '../executor.js';
import { DUCKDB_OPTIONS, describeProfile, duckDbProfile } from '../duckdb.js';
import { CliError, openOutput, rdfFormat, readInput, type Io } from '../io.js';

export const ETL_HELP = `sqlib etl run --job <job.json> [options]

Run an ETL job: SQL rows in, one CONSTRUCT per chunk, RDF out.

  --job <path>              the job file (see below)
  --out <path>              write the RDF here instead of standard output
  --format <format>         n-triples (default), n-quads or turtle
  --chunk-size <n>          rows per CONSTRUCT (default: the job's, else 1000)
  --max-rows <n>            stop at the first chunk boundary past n rows
  --dry-run                 run the first chunk only
  --endpoint <url>          run the CONSTRUCT on an endpoint instead of in process

DuckDB access, for the SQL:
  --no-allow-filesystem     refuse local files (on by default)
  --allow-http              allow http(s) reads; implies filesystem
  --allow-extension-install allow DuckDB to install extensions
  --unrestricted            no sandbox at all
  --memory-limit <size>     DuckDB memory_limit (default 1GB; empty for none)
  --query-timeout <ms>      per-chunk deadline (default 300000; 0 for none)

The job file is JSON:
  {
    "sql": "SELECT …"          or "sqlFile": "extract.sql",
    "template": "CONSTRUCT …"  or "templateFile": "construct.rq",
    "columns": [ { "columnName": "id", "targetVariable": "customer",
                   "termType": "uri", "iriTemplate": "http://ex/c/{value}",
                   "nullPolicy": "skipRow" }, … ],
    "chunkSize": 1000
  }
Paths in it are relative to the job file. SQL paths are relative to the
directory sqlib runs in.
`;

const OUTPUT_FORMATS = new Set(['application/n-triples', 'application/n-quads', 'text/turtle']);

interface JobFile {
  sql?: string;
  sqlFile?: string;
  template?: string;
  templateFile?: string;
  columns?: ColumnDefinition[];
  chunkSize?: number;
}

export async function etlCommand(io: Io, argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== 'run') throw new CliError(`etl has one subcommand, run.\n\n${ETL_HELP}`);
  const { values } = parseArgs({
    args: rest,
    options: {
      job: { type: 'string' },
      out: { type: 'string' },
      format: { type: 'string', default: 'n-triples' },
      'chunk-size': { type: 'string' },
      'max-rows': { type: 'string' },
      'dry-run': { type: 'boolean' },
      endpoint: { type: 'string' },
      ...DUCKDB_OPTIONS,
    },
    allowNegative: true,
    strict: true,
  });
  if (!values.job) throw new CliError('etl run needs --job.');

  const job = await readJob(io, values.job);
  const format = rdfFormat(values.format!);
  if (!OUTPUT_FORMATS.has(format)) throw new CliError('--format takes n-triples, n-quads or turtle.');
  const chunkSize = positive(values['chunk-size'], '--chunk-size') ?? job.chunkSize ?? 1000;
  const maxRows = positive(values['max-rows'], '--max-rows');

  const { capabilities, limits, notes } = duckDbProfile(values);
  for (const note of notes) io.stderr(`${note}\n`);
  io.stderr(`${describeProfile(capabilities, limits)}\n`);

  const duckdb = new DuckDbService(capabilities, limits);
  await duckdb.waitForInit();
  if (!duckdb.isAvailable()) throw new CliError('DuckDB could not be loaded. Is @duckdb/node-api installed beside sqlib?');

  const executor = await chooseExecutor(io, { endpoint: values.endpoint }, format);
  const out = openOutput(io, values.out);
  let result;
  try {
    result = await runEtl({
      source: duckdb.streamChunks(job.sql, chunkSize),
      query: job.template,
      columns: job.columns,
      executor,
      onOutput: async rdf => { await out.write(rdf.endsWith('\n') || rdf.length === 0 ? rdf : `${rdf}\n`); },
      ...(maxRows ? { maxRows } : {}),
      dryRun: values['dry-run'],
      warn: (message, context) => io.stderr(`warning: ${message} ${JSON.stringify(context)}\n`),
    });
  } finally {
    await out.close();
  }
  io.stderr(`${result.totalRows} rows in ${result.completedChunks} chunks\n`);
  return 0;
}

async function readJob(io: Io, file: string) {
  let job: JobFile;
  try {
    job = JSON.parse(await readInput(io, file)) as JobFile;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`${file} is not JSON: ${(error as Error).message}`);
  }
  const relative = (name: string) => path.join(path.dirname(file), name);
  const sql = job.sql ?? (job.sqlFile ? await readInput(io, relative(job.sqlFile)) : undefined);
  const text = job.template ?? (job.templateFile ? await readInput(io, relative(job.templateFile)) : undefined);
  if (!sql) throw new CliError(`${file} needs "sql" or "sqlFile".`);
  if (!text) throw new CliError(`${file} needs "template" or "templateFile".`);
  if (!Array.isArray(job.columns) || job.columns.length === 0) throw new CliError(`${file} needs "columns", a non-empty list.`);

  let compiled;
  try {
    compiled = compileQueryTemplate(text, { name: `${file} template` });
  } catch (error) {
    if (error instanceof TemplateCompileError) throw new CliError(error.message);
    throw error;
  }
  if (compiled.queryType !== 'CONSTRUCT') throw new CliError(`${file}: the template must be a CONSTRUCT, not a ${compiled.queryType}.`);
  if (compiled.template.slots.length !== 1) {
    throw new CliError(`${file}: the template needs exactly one VALUES … { UNDEF … } slot for the rows; it has ${compiled.template.slots.length}.`);
  }
  const slotVars = new Set(compiled.template.slots[0]!.vars);
  const unmapped = job.columns.map(column => column.targetVariable).filter(name => !slotVars.has(name));
  if (unmapped.length > 0) {
    throw new CliError(`${file}: the template's VALUES slot does not declare ${unmapped.map(name => `?${name}`).join(', ')}.`);
  }
  return { sql, template: compiled.template, columns: job.columns, chunkSize: job.chunkSize };
}

function positive(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new CliError(`${option} takes a positive integer; got '${value}'.`);
  return number;
}
