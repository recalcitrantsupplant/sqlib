import { compileRule, expandIris, parseRuleSet } from '@sparql-query-lib/srl';
import { RuleSetRunner, type PreparedDataBlock, type PreparedRule, type RuleSetSource } from '../src/index.js';

const PREFIX = 'PREFIX : <http://ex/>';
const CHAIN = ['a', 'b', 'c', 'd', 'e']
  .map((from, i) => `<http://ex/${from}> <http://ex/parent> <http://ex/${'abcdef'[i + 1]}> .`)
  .join('\n');

/** Compile SRL text the way a CLI host would: parse, expand, compile each rule. */
function compile(text: string): PreparedRule[] {
  const set = expandIris(parseRuleSet(`${PREFIX}\n${text}`));
  return set.rules.map((rule, i) => ({
    ruleVersionId: `urn:test:rule:${i}`,
    program: compileRule(rule, set.prologueText).program,
    source: 'normalized',
    stratum: 0,
  }));
}

const closure = compile(`
RULE { ?x :anc ?z } WHERE { ?x :parent ?z }
RULE { ?x :anc ?z } WHERE { ?x :anc ?y . ?y :parent ?z }
`);

function source(rules: PreparedRule[], extra: Partial<RuleSetSource> = {}): RuleSetSource {
  return {
    id: 'urn:test:rule-set:1',
    ruleCount: rules.length,
    dataBlockCount: 0,
    prepareRules: () => rules,
    prepareDataBlocks: () => [],
    ...extra,
  };
}

describe('RuleSetRunner', () => {
  it('runs the rules to their fixpoint and returns only the inferred triples', async () => {
    const result = await new RuleSetRunner().run(source(closure), { initialGraph: CHAIN, maxIterations: 25 });

    expect(result.status).toBe('converged');
    const inferred = result.finalGraphNQuads!.split('\n');
    expect(inferred).toContain('<http://ex/a> <http://ex/anc> <http://ex/f> .');
    expect(inferred.some(line => line.includes('/parent>'))).toBe(false);
    // 5 + 4 + 3 + 2 + 1 ancestor pairs over a chain of six.
    expect(inferred).toHaveLength(15);
  });

  it('stops at the iteration cap and says so', async () => {
    const result = await new RuleSetRunner().run(source(closure), { initialGraph: CHAIN, maxIterations: 2 });
    expect(result.status).toBe('maxIterations');
    expect(result.maxIterations).toBe(2);
    expect(result.iterations).toHaveLength(2);
  });

  it('applies DATA blocks once, before the rules, and reports what they seeded', async () => {
    const block: PreparedDataBlock = {
      dataBlockVersionId: 'urn:test:data:1',
      programSource: 'normalized',
      program: 'INSERT DATA { <http://ex/f> <http://ex/parent> <http://ex/g> }',
    };
    const result = await new RuleSetRunner().run(
      source(closure, { dataBlockCount: 1, prepareDataBlocks: () => [block] }),
      { initialGraph: CHAIN, maxIterations: 25 },
    );
    expect(result.status).toBe('converged');
    expect(result.dataBlocks).toMatchObject([{ dataBlockVersionId: 'urn:test:data:1', tripleDelta: 1 }]);
    expect(result.seededQuads).toEqual(['<http://ex/f> <http://ex/parent> <http://ex/g> .']);
    expect(result.finalGraphNQuads).toContain('<http://ex/a> <http://ex/anc> <http://ex/g> .');
  });

  it('fails the run with the message of a source that refuses', async () => {
    const errors: string[] = [];
    const result = await new RuleSetRunner().run(
      source([], { prepareRules: () => { throw new Error('RuleSet contains invalid RuleVersions: x'); } }),
      { callbacks: { onExecutionError: ({ message }) => errors.push(message) } },
    );
    expect(result.status).toBe('failed');
    expect(result.error).toBe('RuleSet contains invalid RuleVersions: x');
    expect(errors).toEqual(['RuleSet contains invalid RuleVersions: x']);
  });

  it('refuses seed rows that do not parse, naming the rule set', async () => {
    const result = await new RuleSetRunner().run(source(closure, { tupleSeeds: 'TUPLE(' }));
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/^RuleSetVersion urn:test:rule-set:1 has invalid initial named tuples:/);
  });

  it('starts nothing once its signal has fired, and says why', async () => {
    const controller = new AbortController();
    controller.abort(new Error('the client disconnected'));
    const result = await new RuleSetRunner().run(source(closure), { initialGraph: CHAIN, signal: controller.signal });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('the client disconnected');
    expect(result.iterations).toHaveLength(0);
  });
});
