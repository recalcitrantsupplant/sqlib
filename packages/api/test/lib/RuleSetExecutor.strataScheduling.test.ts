import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Which rules a pass evaluates, and how the iteration budget is spent.
 *
 * A stratum that has reached its fixpoint is finished. Stratification admits no
 * edge from a higher stratum back to a lower one, so re-running a completed one
 * can only re-derive what it has already derived — not re-running it is the
 * point of stratifying, and it is what the spec's evaluation loop does: strata
 * in order, each to its own fixpoint, never returning to a completed one.
 *
 * The executor used to run every stratum at or below the active one on every
 * pass, which was sound but paid for the whole program on every iteration, and
 * spent one shared iteration budget on what are really N separate fixpoints.
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

const run = (hasRule: string[], initialGraph: string, maxIterations = 25) =>
  new RuleSetExecutor().execute(
    {
      $id: 'urn:test:rule-set-version:1',
      '@type': 'RuleSetVersion',
      isPartOf: 'urn:test:rule-set:1',
      version: 1,
      hasRule,
      hasDataBlock: [],
    } as never,
    { initialGraph, maxIterations },
  );

type Result = Awaited<ReturnType<typeof run>>;

/** The 1-based iterations in which the given rule fired. */
const passesFiring = (result: Result, id: string): number[] =>
  result.iterations
    .filter((iteration) => iteration.rules.some((record) => record.ruleVersionId === id))
    .map((iteration) => iteration.index);

/**
 * A three-stratum chain. Each rule is guarded by `NOT` over the relation the
 * one before it writes, which is exactly what forces a strictly higher stratum,
 * and each derives against its own seed so every stratum has real work to do.
 */
const CHAIN = [
  'RULE { ?x :a ?y } WHERE { ?x :seed1 ?y }',
  'RULE { ?x :b ?y } WHERE { ?x :seed2 ?y . NOT { ?x :a ?y } }',
  'RULE { ?x :c ?y } WHERE { ?x :seed3 ?y . NOT { ?x :b ?y } }',
];

const CHAIN_DATA = [
  '<http://ex/x1> <http://ex/seed1> <http://ex/y1> .',
  '<http://ex/x2> <http://ex/seed2> <http://ex/y2> .',
  '<http://ex/x3> <http://ex/seed3> <http://ex/y3> .',
].join('\n');

beforeEach(() => {
  hoisted.entities.clear();
});

describe('RuleSetExecutor — stratum scheduling', () => {
  it('stops evaluating a stratum once it has reached its fixpoint', async () => {
    const ids = [rule('s0', CHAIN[0]!), rule('s1', CHAIN[1]!), rule('s2', CHAIN[2]!)];
    const result = await run(ids, CHAIN_DATA);

    expect(result.status).toBe('converged');

    const s0 = passesFiring(result, ids[0]!);
    const s1 = passesFiring(result, ids[1]!);
    const s2 = passesFiring(result, ids[2]!);

    // Every stratum runs, and each one's passes come strictly before the next's:
    // no overlap means no lower stratum re-runs under a higher one.
    expect(s0.length).toBeGreaterThan(0);
    expect(s1.length).toBeGreaterThan(0);
    expect(s2.length).toBeGreaterThan(0);
    expect(Math.max(...s0)).toBeLessThan(Math.min(...s1));
    expect(Math.max(...s1)).toBeLessThan(Math.min(...s2));

    // A pass fires one stratum, so every record in an iteration shares a stratum.
    for (const iteration of result.iterations) {
      expect(new Set(iteration.rules.map((record) => record.stratum)).size).toBeLessThanOrEqual(1);
    }
  });

  it('derives the same graph it did when every stratum ran on every pass', async () => {
    const ids = [rule('s0', CHAIN[0]!), rule('s1', CHAIN[1]!), rule('s2', CHAIN[2]!)];
    const result = await run(ids, CHAIN_DATA);

    const inferred = (result.finalGraphNQuads ?? '').split('\n').filter(Boolean).sort();
    expect(inferred).toEqual([
      '<http://ex/x1> <http://ex/a> <http://ex/y1> .',
      '<http://ex/x2> <http://ex/b> <http://ex/y2> .',
      '<http://ex/x3> <http://ex/c> <http://ex/y3> .',
    ]);
  });

  it('spends the iteration budget per stratum rather than per run', async () => {
    // Each of the three strata needs one pass to derive and one to prove it has
    // stopped: six passes for a program that converges perfectly normally. Under
    // a single shared budget a limit of three would report `maxIterations` about
    // a run that in fact converged.
    const ids = [rule('s0', CHAIN[0]!), rule('s1', CHAIN[1]!), rule('s2', CHAIN[2]!)];
    const result = await run(ids, CHAIN_DATA, 3);

    expect(result.status).toBe('converged');
    expect(result.iterations.length).toBeGreaterThan(3);
  });

  it('still reports maxIterations when a stratum outruns its budget', async () => {
    // Transitive closure over a six-link chain needs more passes than the budget
    // allows, and it is one stratum, so nothing about the per-stratum budget can
    // rescue it. The limit still has to bite.
    const ids = [
      rule('anc-base', 'RULE { ?x :anc ?z } WHERE { ?x :parent ?z }'),
      rule('anc-step', 'RULE { ?x :anc ?z } WHERE { ?x :anc ?y . ?y :parent ?z }'),
    ];
    const chain = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
      .slice(0, -1)
      .map((from, index) => `<http://ex/${from}> <http://ex/parent> <http://ex/${'abcdefg'[index + 1]}> .`)
      .join('\n');

    const result = await run(ids, chain, 3);

    expect(result.status).toBe('maxIterations');
    expect(result.maxIterations).toBe(3);
    expect(result.iterations.length).toBe(3);
  });
});
