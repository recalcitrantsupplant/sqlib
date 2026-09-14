import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Reporting the named-tuple workspace.
 *
 * Tuples are intermediate working data: they never enter the inference graph,
 * so a run that derives its answer through them shows nothing of that work in
 * its output. The execution record therefore carries the rows each rule wrote,
 * and the result carries the workspace as the run left it.
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
      tuplesEnabled: true,
    } as never,
    { initialGraph, maxIterations: 10 },
  );

/** a → b → c, so a transitive closure over :edge has something to close over. */
const CHAIN = [
  '<http://ex/a> <http://ex/edge> <http://ex/b> .',
  '<http://ex/b> <http://ex/edge> <http://ex/c> .',
].join('\n');

beforeEach(() => {
  hoisted.entities.clear();
});

describe('RuleSetExecutor — named tuple reporting', () => {
  it('attributes each tuple to the rule that wrote it', async () => {
    const ids = [
      rule('reach-base', 'RULE :reach-base { TUPLE(:reach, ?a, ?b) } WHERE { ?a :edge ?b }'),
      rule('reach-step', 'RULE :reach-step { TUPLE(:reach, ?a, ?c) } WHERE { TUPLE(:reach, ?a, ?b) . ?b :edge ?c }'),
    ];

    const result = await run(ids, CHAIN);

    const byRule = new Map<string, string[]>();
    for (const iteration of result.iterations) {
      for (const record of iteration.rules) {
        const existing = byRule.get(record.ruleIri ?? record.ruleVersionId) ?? [];
        byRule.set(record.ruleIri ?? record.ruleVersionId, [...existing, ...record.insertedTuples]);
      }
    }

    // The base rule reads the two edges; the step rule closes them into a→c.
    // Sorted, because row order within the workspace is solution order.
    expect(byRule.get('http://ex/reach-base')?.slice().sort()).toEqual([
      'TUPLE(<http://ex/reach>, <http://ex/a>, <http://ex/b>)',
      'TUPLE(<http://ex/reach>, <http://ex/b>, <http://ex/c>)',
    ]);
    expect(byRule.get('http://ex/reach-step')).toEqual([
      'TUPLE(<http://ex/reach>, <http://ex/a>, <http://ex/c>)',
    ]);
  });

  it('reports a tuple once, to the pass that first derived it', async () => {
    // The store is set-semantics, so a rule re-deriving a row it already wrote
    // adds nothing — and must not be reported as having added it again.
    const ids = [rule('reach-base', 'RULE { TUPLE(:reach, ?a, ?b) } WHERE { ?a :edge ?b }')];

    const result = await run(ids, CHAIN);

    const perIteration = result.iterations.map((i) => i.rules.flatMap((r) => r.insertedTuples).length);
    expect(perIteration[0]).toBe(2);
    expect(perIteration.slice(1).every((n) => n === 0)).toBe(true);
  });

  it('carries the workspace and its size on the result', async () => {
    const ids = [
      rule('reach-base', 'RULE { TUPLE(:reach, ?a, ?b) } WHERE { ?a :edge ?b }'),
      rule('reach-step', 'RULE { TUPLE(:reach, ?a, ?c) } WHERE { TUPLE(:reach, ?a, ?b) . ?b :edge ?c }'),
    ];

    const result = await run(ids, CHAIN);

    expect(result.finalTuples?.slice().sort()).toEqual([
      'TUPLE(<http://ex/reach>, <http://ex/a>, <http://ex/b>)',
      'TUPLE(<http://ex/reach>, <http://ex/a>, <http://ex/c>)',
      'TUPLE(<http://ex/reach>, <http://ex/b>, <http://ex/c>)',
    ]);
    expect(result.iterations.at(-1)?.tupleCount).toBe(3);
  });

  it('leaves the workspace off a run that used no tuples', async () => {
    const ids = [rule('plain', 'RULE { ?x :reaches ?y } WHERE { ?x :edge ?y }')];

    const result = await run(ids, CHAIN);

    expect(result.finalTuples).toBeUndefined();
    expect(result.iterations.every((i) => i.tupleCount === 0)).toBe(true);
  });
});
