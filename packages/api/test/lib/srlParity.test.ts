/**
 * WP5's parity test: a rule set gives the same inference graph through the
 * API's executor and through the path the CLI will take.
 *
 * - The API path is `RuleSetExecutor.execute` over stored rule versions: its
 *   grammar validator compiles each rule, and its `RuleStratifier` layers them.
 * - The CLI path parses the same rules as one SRL document, layers them with
 *   `srl`'s `stratify`, compiles them with `srl`'s `compileRule`, and runs
 *   them with `RuleSetRunner` on the runner's own store and executor.
 *
 * The rules recurse and negate across strata, so both the fixpoint and the
 * layering have to agree for the graphs to match.
 */
import { describe, it, expect, vi } from 'vitest';
import { compileRule, expandIris, parseRuleSet, stratify } from '@sparql-query-lib/srl';
import { RuleSetRunner, type PreparedRule } from '@sparql-query-lib/runtime-srl';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
});

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const PREFIX = 'PREFIX : <http://ex/>';
const RULES = [
  'RULE { ?x :anc ?z } WHERE { ?x :parent ?z }',
  'RULE { ?x :anc ?z } WHERE { ?x :anc ?y . ?y :parent ?z }',
  'RULE { ?x :root true } WHERE { ?x :anc ?y NOT { ?w :anc ?x } }',
];
const GRAPH = `
<http://ex/a> <http://ex/parent> <http://ex/b> .
<http://ex/b> <http://ex/parent> <http://ex/c> .
<http://ex/c> <http://ex/parent> <http://ex/d> .
<http://ex/x> <http://ex/parent> <http://ex/y> .
`;

const lines = (nquads: string | undefined) => (nquads ?? '').split('\n').filter(Boolean).sort();

describe('one rule set, two hosts', () => {
  it('gives the same inference graph through the API executor and through the CLI path', async () => {
    const ids = RULES.map((text, i) => {
      const $id = `urn:test:parity:rule-version:${i}`;
      hoisted.entities.set($id, {
        $id, '@type': 'RuleVersion', isPartOf: `urn:test:parity:rule:${i}`, version: 1,
        ruleString: `${PREFIX}\n${text}`, grammarValid: true,
      });
      return $id;
    });
    const viaApi = await new RuleSetExecutor().execute({
      $id: 'urn:test:parity:rule-set-version', '@type': 'RuleSetVersion', isPartOf: 'urn:test:parity:rule-set',
      version: 1, hasRule: ids, hasDataBlock: [],
    } as never, { initialGraph: GRAPH, maxIterations: 25 });

    const set = expandIris(parseRuleSet(`${PREFIX}\n${RULES.join('\n')}`));
    const report = stratify(set.rules.map((ast, i) => ({ id: `rule-${i}`, ast })));
    const prepared: PreparedRule[] = set.rules
      .map((rule, i) => ({
        ruleVersionId: `rule-${i}`,
        program: compileRule(rule, set.prologueText).program,
        source: 'normalized' as const,
        stratum: report.strata[`rule-${i}`] ?? 0,
        monotonicity: report.monotonicity[`rule-${i}`],
        runOnce: report.runOnce[`rule-${i}`] === true,
      }))
      .sort((a, b) => a.stratum - b.stratum);
    const viaCli = await new RuleSetRunner().run(
      { id: 'cli', ruleCount: prepared.length, dataBlockCount: 0, prepareRules: () => prepared, prepareDataBlocks: () => [] },
      { initialGraph: GRAPH, maxIterations: 25 },
    );

    expect(viaApi.status).toBe('converged');
    expect(viaCli.status).toBe('converged');
    expect(lines(viaCli.finalGraphNQuads)).toEqual(lines(viaApi.finalGraphNQuads));

    // What both agree on is right: six ancestor pairs over the chain, one over
    // the pair, and the roots are exactly the nodes nobody is a parent of.
    const inferred = lines(viaApi.finalGraphNQuads);
    expect(inferred.filter(line => line.includes('/anc>'))).toHaveLength(7);
    expect(inferred.filter(line => line.includes('/root>'))).toEqual([
      '<http://ex/a> <http://ex/root> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> .',
      '<http://ex/x> <http://ex/root> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> .',
    ]);
    // The negation ran in a higher stratum than the closure it negates over.
    expect(new Set(viaApi.iterations.map(i => i.stratum)).size).toBeGreaterThan(1);
  });
});
