/**
 * `sqlib check <file>…`
 *
 * Parse each file and report what sqlib would refuse, without running it: a
 * `.rq`/`.sparql` file is parsed, its parameters detected and its template
 * compiled; an `.srl` file is parsed, checked for well-formedness and layered;
 * a `.json` bundle is validated and verified, and its rule sets compiled.
 * The exit status is the verdict, so it fits a CI step.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SparqlQueryParser, TemplateCompileError, compileQueryTemplate, detectSparqlOperation } from '@sparql-query-lib/compiler';
import { CliError, readInput, type Io } from '../io.js';
import { readBundle } from '../bundle.js';
import { compileDocument } from './rules.js';

export const CHECK_HELP = `sqlib check <file>…

Check SPARQL (.rq, .sparql), SRL (.srl) and bundle (.json) files without
running them. Prints one line per file; exits 1 if any file has a problem.
A bundle is validated, its hashes verified, and its rule sets compiled; the
line lists the keys --query, --job and --rule-set take.
`;

export async function checkCommand(io: Io, argv: string[]): Promise<number> {
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true, strict: true });
  if (positionals.length === 0) throw new CliError(`check needs at least one file.\n\n${CHECK_HELP}`);

  const parser = new SparqlQueryParser();
  let failures = 0;
  for (const file of positionals) {
    try {
      io.stdout(`${file}: ${await checkFile(io, file, parser)}\n`);
    } catch (error) {
      failures += 1;
      io.stdout(`${file}: ${(error as Error).message}\n`);
    }
  }
  return failures > 0 ? 1 : 0;
}

async function checkFile(io: Io, file: string, parser: SparqlQueryParser): Promise<string> {
  const text = await readInput(io, file);
  const extension = path.extname(file).toLowerCase();

  if (extension === '.json') {
    const bundle = await readBundle(io, file);
    // The server parsed each document before it wrote it, but under its own
    // flags; compiling here says whether this sqlib can run it.
    for (const [key, ruleSet] of Object.entries(bundle.ruleSets ?? {})) compileDocument(ruleSet.srl, key);
    const list = (kind: string, map: Record<string, unknown> | undefined) => {
      const keys = Object.keys(map ?? {});
      return keys.length === 0 ? [] : [`\n  ${kind}: ${keys.join(', ')}`];
    };
    return [
      `ok, bundle of ${bundle.library.name ?? bundle.library.id}`,
      ...list('queries', bundle.queries),
      ...list('ETL jobs', bundle.etlJobs),
      ...list('rule sets', bundle.ruleSets),
    ].join('');
  }

  if (extension === '.srl') {
    const { rules, dataBlocks } = compileDocument(text, file);
    const strata = new Set(rules.map(rule => rule.stratum)).size;
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    return `ok, ${plural(rules.length, 'rule')} in ${plural(strata, 'stratum').replace(/stratums$/, 'strata')}, ${plural(dataBlocks.length, 'DATA block')}`;
  }

  if (extension === '.rq' || extension === '.sparql' || extension === '.ru') {
    const form = detectSparqlOperation(text);
    const inputs = parser.detectInputs(text);
    const parameters = [
      ...inputs.valuesInputs.map(group => group.map(name => `?${name}`).join(' ')),
      ...inputs.limitParameters.map(name => `LIMIT ${name}`),
      ...inputs.offsetParameters.map(name => `OFFSET ${name}`),
    ];
    const warnings = inputs.correlatedExistsInputs.map(
      input => `warning: [${input.parameters.join(', ')}] inside FILTER EXISTS shares ${input.correlatedVariables.join(', ')} with its scope, which endpoints evaluate differently`,
    );
    let template = '';
    if (form !== 'UPDATE') {
      try {
        compileQueryTemplate(text, { name: file, parser });
      } catch (error) {
        if (!(error instanceof TemplateCompileError)) throw error;
        template = '; does not compile to a template, so its arguments need the parser path';
      }
    }
    const summary = `ok, ${form}, ${parameters.length === 0 ? 'no parameters' : `parameters ${parameters.join(', ')}`}${template}`;
    return [summary, ...warnings].join('\n  ');
  }

  throw new CliError(`not a file check knows; use .rq, .sparql, .ru, .srl or .json`);
}
