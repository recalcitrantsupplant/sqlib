import { describe, it, expect, beforeEach, vi } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

/**
 * Blank nodes in a rule body behave like variables.
 *
 * The spec ("Treating blank nodes as variables", w3c/data-shapes#1308) replaces
 * each body blank node by a variable the rule does not use, with one variable
 * per blank node across the whole body — inside triple terms and `NOT`
 * included. SPARQL instead scopes a blank node label to one basic graph
 * pattern, so the literal translation of a body that shares a blank node with
 * a `NOT`, or uses one on both sides of a `SET`, does not even parse. The
 * compiler now does the replacement itself; these cases check the results.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
});

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const PREFIX = 'PREFIX : <http://example/>';

/** Register a RuleVersion the executor can load, and return its id. */
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

const run = (hasDataBlock: string[], hasRule: string[] = [], initialGraph?: string) =>
  new RuleSetExecutor().execute(
    {
      $id: 'urn:test:rule-set-version:1',
      '@type': 'RuleSetVersion',
      isPartOf: 'urn:test:rule-set:1',
      version: 1,
      hasRule,
      hasDataBlock,
    } as never,
    { initialGraph, maxIterations: 10 },
  );

/** The inference graph as a set of N-Triples lines, order-insensitive. */
const triples = (nquads: string | undefined): string[] =>
  (nquads ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();

beforeEach(() => {
  hoisted.entities.clear();
});

const ex = (local: string) => `<http://example/${local}>`;

describe('RuleSetExecutor — blank nodes in a rule body are variables', () => {
  it('shares a blank node between the body and a NOT', async () => {
    // `_:b` inside the NOT is the same variable as outside it, so the negation
    // is per solution: :a's node has :q :c, :b's does not.
    const result = await run(
      [],
      [rule('r', 'RULE { ?x :p :o } WHERE { ?x :r _:b NOT { _:b :q :c } }')],
      [
        `${ex('a')} ${ex('r')} ${ex('n1')} .`,
        `${ex('b')} ${ex('r')} ${ex('n2')} .`,
        `${ex('n1')} ${ex('q')} ${ex('c')} .`,
      ].join('\n'),
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([`${ex('b')} ${ex('p')} ${ex('o')} .`]);
  });

  it('joins a blank node used on both sides of a SET', async () => {
    const result = await run(
      [],
      [rule('r', 'RULE { ?x :p ?w } WHERE { ?x :r _:b SET(?z := 1) _:b :s ?w }')],
      [
        `${ex('a')} ${ex('r')} ${ex('n1')} .`,
        `${ex('b')} ${ex('r')} ${ex('n2')} .`,
        `${ex('n1')} ${ex('s')} ${ex('d')} .`,
      ].join('\n'),
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([`${ex('a')} ${ex('p')} ${ex('d')} .`]);
  });

  it('matches a blank node inside a triple term as a variable', async () => {
    const result = await run(
      [],
      [rule('r', 'RULE { ?x :p :o } WHERE { ?x :r <<( _:b :q :c )>> . _:b :s :d }')],
      [
        `${ex('a')} ${ex('r')} <<( ${ex('n1')} ${ex('q')} ${ex('c')} )>> .`,
        `${ex('b')} ${ex('r')} <<( ${ex('n2')} ${ex('q')} ${ex('c')} )>> .`,
        `${ex('n1')} ${ex('s')} ${ex('d')} .`,
      ].join('\n'),
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([`${ex('a')} ${ex('p')} ${ex('o')} .`]);
  });
});
