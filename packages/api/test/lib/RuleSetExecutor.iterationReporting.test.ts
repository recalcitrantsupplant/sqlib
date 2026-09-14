import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * What a pass of the fixpoint loop reports about itself.
 *
 * The rules already carried a duration and a stratum; the pass around them
 * carried neither, so "where did this run's time go" could only be answered by
 * summing the rules — which silently omits the dataset capture on either side
 * of every one of them, the part that dominates on a large graph. A benchmark's
 * second-level table is built out of these records, so they have to be measured
 * rather than derived.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
}));

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const PREFIX = 'PREFIX : <http://ex/>';

function rule(id: string, ruleString: string): string {
  const $id = `urn:test:rule-version:${id}`;
  hoisted.entities.set($id, {
    $id,
    '@type': 'RuleVersion',
    isPartOf: `urn:test:rule:${id}`,
    version: 1,
    ruleString: `${PREFIX}\n${ruleString}`,
    grammarValid: true,
  });
  return $id;
}

const run = (hasRule: string[], initialGraph: string) =>
  new RuleSetExecutor().execute(
    {
      $id: 'urn:test:rule-set-version:1',
      '@type': 'RuleSetVersion',
      isPartOf: 'urn:test:rule-set:1',
      version: 1,
      hasRule,
      hasDataBlock: [],
    } as never,
    { initialGraph, maxIterations: 25 },
  );

beforeEach(() => {
  hoisted.entities.clear();
});

describe('RuleSetExecutor — iteration reporting', () => {
  it('times every pass, including the one that finds the fixpoint', async () => {
    const ids = [
      rule('anc-base', 'RULE { ?x :anc ?z } WHERE { ?x :parent ?z }'),
      rule('anc-step', 'RULE { ?x :anc ?z } WHERE { ?x :anc ?y . ?y :parent ?z }'),
    ];

    const result = await run(
      ids,
      [
        '<http://ex/a> <http://ex/parent> <http://ex/b> .',
        '<http://ex/b> <http://ex/parent> <http://ex/c> .',
      ].join('\n'),
    );

    // The last pass derives nothing — it is the one that proves convergence —
    // and it costs what every other pass costs, so a table missing it
    // under-reports the run.
    expect(result.iterations.length).toBeGreaterThan(1);
    expect(result.iterations.at(-1)?.delta).toBe(0);
    expect(result.iterations.every((iteration) => typeof iteration.durationMs === 'number')).toBe(true);
    expect(result.iterations.every((iteration) => iteration.durationMs >= 0)).toBe(true);
  });

  it('measures the pass rather than adding up its rules', async () => {
    const ids = [rule('anc-base', 'RULE { ?x :anc ?z } WHERE { ?x :parent ?z }')];

    const result = await run(ids, '<http://ex/a> <http://ex/parent> <http://ex/b> .');

    for (const iteration of result.iterations) {
      const ruleTotal = iteration.rules.reduce((total, record) => total + record.durationMs, 0);
      // Never less: the pass contains its rules, plus the dataset hashing
      // between them that a sum of the rules cannot see.
      expect(iteration.durationMs).toBeGreaterThanOrEqual(ruleTotal);
    }
  });

  it('names the stratum a pass evaluated, and agrees with the rules it ran', async () => {
    // :anc closes over :parent, and :unrelated is guarded by NOT over :anc, so
    // the two land in different layers and the run spans more than one.
    const ids = [
      rule('anc-base', 'RULE { ?x :anc ?z } WHERE { ?x :parent ?z }'),
      rule('unrelated', 'RULE { ?x :unrelated ?y } WHERE { ?x a :P . ?y a :P . NOT { ?x :anc ?y } }'),
    ];

    const result = await run(
      ids,
      [
        '<http://ex/a> <http://ex/parent> <http://ex/b> .',
        '<http://ex/a> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://ex/P> .',
        '<http://ex/b> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://ex/P> .',
      ].join('\n'),
    );

    expect(result.iterations.every((iteration) => typeof iteration.stratum === 'number')).toBe(true);
    // A pass belongs to exactly one layer — the loop advances the cursor only at
    // a stratum's own fixpoint — so a reader comparing pass 3 of two runs can
    // tell whether they are the same layer.
    for (const iteration of result.iterations) {
      for (const record of iteration.rules) {
        expect(record.stratum).toBe(iteration.stratum);
      }
    }
    expect(new Set(result.iterations.map((iteration) => iteration.stratum)).size).toBeGreaterThan(1);
  });
});
