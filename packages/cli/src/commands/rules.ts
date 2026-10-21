/**
 * `sqlib rules run --srl rules.srl --data base.ttl [--out inferred.nt]`
 *
 * The document is parsed and compiled with `srl`, layered with `srl`'s
 * `stratify`, and run by `RuleSetRunner`, the same runner the API uses for a
 * stored rule set. The data files are the base graph; the output is the
 * inference graph, which is what the rules added to it.
 */
import { parseArgs } from 'node:util';
import * as oxigraph from 'oxigraph';
import { checkWellFormed, compileRule, expandIris, parseRuleSet, stratify } from '@sparql-query-lib/srl';
import { RuleSetRunner, type PreparedDataBlock, type PreparedRule } from '@sparql-query-lib/runtime-srl';
import { CliError, openOutput, rdfFormat, rdfFormatOf, readInput, type Io } from '../io.js';

export const RULES_HELP = `sqlib rules run --srl <rules.srl> [options]

Run a SHACL 1.2 rule set from an SRL document, in process.

  --srl <path|->            the SRL document: rules and DATA blocks
  --data <file>             the base graph; repeatable, formats may differ
  --data-format <format>    the format of --data files, when the name does not say
  --tuples <path>           initial named-tuple rows (rule-tuples extension)
  --max-iterations <n>      passes per stratum before stopping (default 100)
  --format <format>         n-triples (default), n-quads or json-ld
  --out <path>              write the inference graph here instead of standard output
  --trace                   report each rule's effect per pass on standard error
`;

const INFERENCE_FORMATS = new Set(['application/n-triples', 'application/n-quads', 'application/ld+json']);

export async function rulesCommand(io: Io, argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== 'run') throw new CliError(`rules has one subcommand, run.\n\n${RULES_HELP}`);
  const { values } = parseArgs({
    args: rest,
    options: {
      srl: { type: 'string' },
      data: { type: 'string', multiple: true },
      'data-format': { type: 'string' },
      tuples: { type: 'string' },
      'max-iterations': { type: 'string', default: '100' },
      format: { type: 'string', default: 'n-triples' },
      out: { type: 'string' },
      trace: { type: 'boolean' },
    },
    strict: true,
  });
  if (!values.srl) throw new CliError('rules run needs --srl.');
  const maxIterations = Number(values['max-iterations']);
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new CliError(`--max-iterations takes a positive integer; got '${values['max-iterations']}'.`);
  }
  const inferenceFormat = rdfFormat(values.format!);
  if (!INFERENCE_FORMATS.has(inferenceFormat)) throw new CliError('--format takes n-triples, n-quads or json-ld.');

  const { rules, dataBlocks } = compileDocument(await readInput(io, values.srl), values.srl);

  // The base graph goes into the store before the run, so the runner captures
  // it as G0 exactly as it would an initial graph given as text.
  const store = new oxigraph.Store();
  for (const file of values.data ?? []) {
    try {
      store.load(await readInput(io, file), { format: rdfFormatOf(file, values['data-format']) });
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(`Cannot load ${file}: ${(error as Error).message}`);
    }
  }

  const result = await new RuleSetRunner().run(
    {
      id: values.srl,
      ruleCount: rules.length,
      dataBlockCount: dataBlocks.length,
      prepareRules: () => rules,
      prepareDataBlocks: () => dataBlocks,
      tupleSeeds: values.tuples ? await readInput(io, values.tuples) : null,
    },
    {
      maxIterations,
      inferenceFormat,
      store,
      trace: values.trace,
      callbacks: values.trace
        ? {
            onRuleResult: record => io.stderr(
              `pass ${record.iteration} stratum ${record.stratum ?? 0} ${record.ruleIri ?? record.ruleVersionId}: +${record.triplesInserted} -${record.triplesDeleted}\n`,
            ),
          }
        : undefined,
    },
  );

  const passes = result.iterations.length;
  if (result.status === 'failed') throw new CliError(`The rule set failed: ${result.error ?? 'no reason given'}`);

  const out = openOutput(io, values.out);
  try {
    const content = result.finalGraphContent ?? '';
    await out.write(content.endsWith('\n') || content.length === 0 ? content : `${content}\n`);
  } finally {
    await out.close();
  }

  const inferred = (result.finalGraphNQuads ?? '').split('\n').filter(Boolean).length;
  if (result.status === 'converged') {
    io.stderr(`converged after ${passes} passes: ${inferred} triples inferred\n`);
    return 0;
  }
  const why = result.status === 'cycle'
    ? `the rules cycle between passes ${result.cycle?.startIteration} and ${result.cycle?.endIteration}`
    : `a stratum reached --max-iterations (${result.maxIterations}) without converging`;
  io.stderr(`stopped after ${passes} passes: ${why}. The output is the graph so far.\n`);
  return 2;
}

/** Parse, check, layer and compile an SRL document, as a host prepares a rule set. */
export function compileDocument(text: string, name: string): { rules: PreparedRule[]; dataBlocks: PreparedDataBlock[] } {
  let set;
  try {
    set = expandIris(parseRuleSet(text, { tuples: true, aggregates: true }));
  } catch (error) {
    throw new CliError(`${name} does not parse: ${(error as Error).message}`);
  }
  const issues = checkWellFormed(set);
  if (issues.length > 0) {
    throw new CliError(`${name} is not well formed:\n${issues.map(issue => `  ${issue.message}`).join('\n')}`);
  }

  const ids = set.rules.map((rule, i) => rule.name ?? `${name}#rule-${i + 1}`);
  const report = stratify(set.rules.map((ast, i) => ({ id: ids[i]!, ast })));
  if (report.issues && report.issues.length > 0) {
    throw new CliError(`${name} does not stratify: ${report.issues.join('; ')}`);
  }

  const rules: PreparedRule[] = set.rules
    .map((rule, i) => {
      const compiled = compileRule(rule, set.prologueText);
      const id = ids[i]!;
      const tuples = compiled.tupleReads.length > 0 || compiled.tupleWrites.length > 0
        ? { tuples: { reads: compiled.tupleReads, writes: compiled.tupleWrites, producesTuples: compiled.producesTuples } }
        : {};
      return {
        ruleVersionId: id,
        ...(rule.name ? { ruleIri: rule.name } : {}),
        program: compiled.program,
        source: 'normalized' as const,
        stratum: report.strata[id] ?? 0,
        monotonicity: report.monotonicity[id],
        runOnce: report.runOnce[id] === true,
        ...tuples,
      };
    })
    // Run order: by stratum, and within one, run-once rules first. The same
    // order the API's host gives the runner.
    .sort((a, b) => a.stratum - b.stratum || Number(b.runOnce) - Number(a.runOnce));

  const prologue = set.prologueText ? `${set.prologueText}\n` : '';
  const dataBlocks: PreparedDataBlock[] = set.dataBlocks.map((block, i) => ({
    dataBlockVersionId: `${name}#data-${i + 1}`,
    programSource: 'normalized',
    program: block.dataText.trim() ? `${prologue}INSERT DATA { ${block.dataText} }` : null,
    missingContentMessage: `DATA block ${i + 1} of ${name} is empty`,
  }));

  return { rules, dataBlocks };
}
