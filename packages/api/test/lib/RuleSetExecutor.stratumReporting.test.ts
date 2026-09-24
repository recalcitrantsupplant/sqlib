import { describe, it, expect, beforeEach, vi } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

/**
 * Which stratum a firing is recorded against.
 *
 * The executor already knows: `activeStratum` is what decides whether a rule
 * runs on a given pass. What was missing is that the trace never said so, which
 * left a reader of a finished run to re-stratify the document to find out —
 * against text that may have been edited since. So the record carries it, and
 * the replay timeline tints a step with the colour the editor gutter gives the
 * rule that produced it.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
});

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

/** Every rule record of every iteration, flattened. */
const records = (result: Awaited<ReturnType<typeof run>>) =>
  result.iterations.flatMap((iteration) => iteration.rules);

beforeEach(() => {
  hoisted.entities.clear();
});

describe('RuleSetExecutor — stratum reporting', () => {
  it('records the stratum each firing was evaluated in', async () => {
    // :anc closes over :parent, and :unrelated is guarded by NOT over :anc, so
    // stratification puts them in different layers.
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

    const byRule = new Map(records(result).map((record) => [record.ruleVersionId, record.stratum]));
    expect(byRule.get('urn:test:rule-version:anc-base')).toBe(0);
    // Strictly later: the negated rule cannot share a layer with what it negates.
    expect(byRule.get('urn:test:rule-version:unrelated')).toBeGreaterThan(0);
  });

  it('reports a stratum on every firing, including repeats in later passes', async () => {
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

    // The closure needs several passes, and a step drawn from a pass with no
    // stratum would leave a hole in the timeline's band.
    expect(result.iterations.length).toBeGreaterThan(1);
    expect(records(result).every((record) => typeof record.stratum === 'number')).toBe(true);
  });

  it('puts an unstratifiable set in one layer rather than none', async () => {
    // Mutual recursion has no stratification; the executor falls back to a
    // single stratum, and the trace has to say 0 rather than nothing.
    const ids = [
      rule('p', 'RULE { ?x :p ?y } WHERE { ?x :q ?y }'),
      rule('q', 'RULE { ?x :q ?y } WHERE { ?x :p ?y }'),
    ];

    const result = await run(ids, '<http://ex/a> <http://ex/q> <http://ex/b> .');

    expect(records(result).map((record) => record.stratum)).not.toContain(undefined);
  });
});
