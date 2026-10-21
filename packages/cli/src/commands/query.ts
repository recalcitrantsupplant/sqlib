/**
 * `sqlib query --file q.rq [--arg v=term]… [--endpoint URL | --data file…]`
 * `sqlib query --bundle b.json --query <key> …`
 *
 * The file is compiled with the compiler into a one-query bundle, and run by
 * the runtime exactly as an exported query is: the same splice, the same
 * argument and LIMIT/OFFSET handling. A query from a bundle was compiled by
 * the server's export, and runs the same way. SELECT and ASK print SPARQL Results
 * JSON; CONSTRUCT and DESCRIBE print RDF.
 */
import { parseArgs } from 'node:util';
import { TemplateCompileError, compileQueryTemplate } from '@sparql-query-lib/compiler';
import { fromBundle, hashTemplateText, type ExportBundle } from '@sparql-query-lib/runtime';
import { pick, readBundle } from '../bundle.js';
import { chooseExecutor } from '../executor.js';
import { CliError, openOutput, rdfFormat, readInput, type Io } from '../io.js';
import { argumentSetsFromArgs, argumentSetsFromJson, pageParameters } from '../terms.js';

export const QUERY_HELP = `sqlib query --file <query.rq> [options]
sqlib query --bundle <bundle.json> --query <key> [options]

Run a SPARQL query from a file or a bundle, parameters applied as sqlib applies them.

  --file <path|->           the query text
  --bundle <path>           an export bundle, from 'sqlib pull'
  --query <key>             the bundle's query to run
  --arg <var=term>          a row for a one-variable parameter; repeatable
  --args <file.json>        argument sets as SPARQL Results JSON
  --limit <name=n>          a LIMIT 000n parameter; repeatable
  --offset <name=n>         an OFFSET 000n parameter; repeatable
  --endpoint <url>          run against a SPARQL endpoint
  --data <file>             or load RDF into an in-process store; repeatable
  --data-format <format>    the format of --data files, when the name does not say
  --format <format>         RDF format for CONSTRUCT and DESCRIBE (default turtle)
  --text                    print the substituted query instead of running it
  --out <path>              write the result here instead of standard output
`;

export async function queryCommand(io: Io, argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      file: { type: 'string' },
      bundle: { type: 'string' },
      query: { type: 'string' },
      arg: { type: 'string', multiple: true },
      args: { type: 'string' },
      limit: { type: 'string', multiple: true },
      offset: { type: 'string', multiple: true },
      endpoint: { type: 'string' },
      'update-endpoint': { type: 'string' },
      data: { type: 'string', multiple: true },
      'data-format': { type: 'string' },
      format: { type: 'string' },
      text: { type: 'boolean' },
      out: { type: 'string' },
    },
    strict: true,
  });
  const { bundle, key } = await loadQuery(io, values);
  const argumentSets = [
    ...argumentSetsFromArgs(values.arg ?? []),
    ...(values.args ? argumentSetsFromJson(await readInput(io, values.args), values.args) : []),
  ];
  const payload = {
    arguments: argumentSets,
    limits: pageParameters(values.limit ?? [], 'limit'),
    offsets: pageParameters(values.offset ?? [], 'offset'),
  };

  const format = rdfFormat(values.format ?? 'turtle');
  const out = openOutput(io, values.out);
  try {
    if (values.text) {
      const handle = fromBundle(bundle).query(key);
      await out.write(`${handle.text(payload)}\n`);
      return 0;
    }
    const executor = await chooseExecutor(io, values, format);
    const result = await fromBundle(bundle, { executor }).query(key).run(payload);
    await out.write('data' in result ? ensureNewline(result.data) : `${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } finally {
    await out.close();
  }
}

/** The query to run: one key of a bundle, or a file compiled into a one-query bundle. */
async function loadQuery(
  io: Io,
  values: { file?: string; bundle?: string; query?: string },
): Promise<{ bundle: ExportBundle; key: string }> {
  if (values.bundle) {
    if (values.file) throw new CliError('Pass --file or --bundle, not both.');
    if (!values.query) throw new CliError('query --bundle needs --query <key>.');
    const bundle = await readBundle(io, values.bundle);
    pick(bundle.queries, values.query, 'query', values.bundle);
    return { bundle, key: values.query };
  }
  if (!values.file) throw new CliError('query needs --file, or --bundle and --query.');

  const text = await readInput(io, values.file);
  let compiled;
  try {
    compiled = compileQueryTemplate(text, { name: values.file });
  } catch (error) {
    if (error instanceof TemplateCompileError) throw new CliError(error.message);
    throw error;
  }

  const bundle: ExportBundle = {
    version: 1,
    library: { id: 'urn:sqlib:cli' },
    queries: {
      query: {
        template: compiled.template,
        queryType: compiled.queryType,
        limitParameters: compiled.limitParameters,
        offsetParameters: compiled.offsetParameters,
        ...(compiled.pageParameters.length > 0 ? { pageParameters: compiled.pageParameters } : {}),
        inferredInputs: compiled.inferredInputs,
        textHash: await hashTemplateText(compiled.template.text),
      },
    },
  };
  return { bundle, key: 'query' };
}

function ensureNewline(text: string): string {
  return text.endsWith('\n') || text.length === 0 ? text : `${text}\n`;
}
