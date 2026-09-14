import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Fixpoint semantics of `RuleSetExecutor`.
 *
 * Two properties that the loop has to hold and that no other test covers:
 *
 *  - **stratified evaluation** — a stratum must reach its own fixpoint before a
 *    higher stratum runs, or a rule guarded by `NOT` fires against an incomplete
 *    relation and the facts it derives are never retracted;
 *  - **convergence over every relation** — a pass whose only progress is tuple
 *    growth still makes progress, even though it inserts no triples.
 *
 * See `docs/reference/srl-language.md`.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
}));

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const PREFIX = 'PREFIX : <http://ex/>';

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

function ruleSetVersion(hasRule: string[]) {
  return {
    $id: 'urn:test:rule-set-version:1',
    '@type': 'RuleSetVersion',
    isPartOf: 'urn:test:rule-set:1',
    version: 1,
    hasRule,
    hasDataBlock: [],
  } as never;
}

const run = (hasRule: string[], initialGraph: string) =>
  new RuleSetExecutor().execute(ruleSetVersion(hasRule), { initialGraph, maxIterations: 25 });

beforeEach(() => {
  hoisted.entities.clear();
});

describe('RuleSetExecutor — stratified evaluation', () => {
  it('does not let a negated rule fire against an incomplete stratum', async () => {
    // :anc is the transitive closure of :parent over a 4-chain, so it needs
    // more than one pass to close. :unrelated is guarded by NOT over :anc, so it
    // belongs to a later stratum and must not run until :anc is complete.
    const ids = [
      rule('anc-base', 'RULE { ?x :anc ?z } WHERE { ?x :parent ?z }'),
      rule('anc-step', 'RULE { ?x :anc ?z } WHERE { ?x :anc ?y . ?y :parent ?z }'),
      rule('unrelated', 'RULE { ?x :unrelated ?y } WHERE { ?x a :P . ?y a :P . NOT { ?x :anc ?y } }'),
    ];

    const result = await run(
      ids,
      [
        '<http://ex/a> <http://ex/parent> <http://ex/b> .',
        '<http://ex/b> <http://ex/parent> <http://ex/c> .',
        '<http://ex/c> <http://ex/parent> <http://ex/d> .',
        '<http://ex/a> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://ex/P> .',
        '<http://ex/b> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://ex/P> .',
        '<http://ex/c> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://ex/P> .',
        '<http://ex/d> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://ex/P> .',
      ].join('\n'),
    );

    const graph = result.finalGraphNQuads ?? '';

    // :a reaches :d through the chain, so the closure holds it ...
    expect(graph).toContain('<http://ex/a> <http://ex/anc> <http://ex/d> .');
    // ... and :a :unrelated :d must therefore never have been derived. It is
    // derivable only on a pass where :anc is still incomplete.
    expect(graph).not.toContain('<http://ex/a> <http://ex/unrelated> <http://ex/d> .');
  });
});

describe('RuleSetExecutor — convergence sees the tuple store', () => {
  it('keeps iterating while only tuples are growing', async () => {
    // The closure is computed entirely in tuples; the only triple-producing rule
    // fires on one specific long-path tuple. So the first pass grows the tuple
    // store and inserts nothing, which must not read as convergence.
    const ids = [
      rule('reach-base', 'RULE { TUPLE(:reach, ?a, ?b) } WHERE { ?a :edge ?b }'),
      rule('reach-step', 'RULE { TUPLE(:reach, ?a, ?c) } WHERE { TUPLE(:reach, ?a, ?b) . ?b :edge ?c }'),
      rule('materialise', 'RULE { :a :reachesFar :d } WHERE { TUPLE(:reach, :a, :d) }'),
    ];

    const result = await run(
      ids,
      [
        '<http://ex/a> <http://ex/edge> <http://ex/b> .',
        '<http://ex/b> <http://ex/edge> <http://ex/c> .',
        '<http://ex/c> <http://ex/edge> <http://ex/d> .',
      ].join('\n'),
    );

    expect(result.finalGraphNQuads ?? '').toContain(
      '<http://ex/a> <http://ex/reachesFar> <http://ex/d> .',
    );
  });

  it('still terminates when nothing is left to derive', async () => {
    const ids = [rule('reach-base', 'RULE { TUPLE(:reach, ?a, ?b) } WHERE { ?a :edge ?b }')];
    const result = await run(ids, '<http://ex/a> <http://ex/edge> <http://ex/b> .');
    expect(result.status).toBe('converged');
  });
});

describe('RuleSetExecutor — initial named tuples', () => {
  /** A rule set version carrying a tuple-seed document (canonical form). */
  const seeded = (hasRule: string[], tupleSeeds: string) =>
    ({ ...(ruleSetVersion(hasRule) as object), tupleSeeds } as never);

  it('seeds the tuple store, so a tuple relation can be given rather than derived', async () => {
    // No rule writes TUPLE(:reach, …) — the only source is the seed document.
    // Without seeding, the premise is unsatisfiable and nothing is derived.
    const ids = [rule('materialise', 'RULE { ?a :reaches ?b } WHERE { TUPLE(:reach, ?a, ?b) }')];
    const result = await new RuleSetExecutor().execute(
      seeded(ids, 'TUPLE(<http://ex/reach>, <http://ex/a>, <http://ex/d>)'),
      { maxIterations: 10 },
    );

    expect(result.finalGraphNQuads ?? '').toContain('<http://ex/a> <http://ex/reaches> <http://ex/d> .');
  });

  it('seeded rows feed the fixpoint, not just the first pass', async () => {
    const ids = [
      rule('reach-step', 'RULE { TUPLE(:reach, ?a, ?c) } WHERE { TUPLE(:reach, ?a, ?b) . ?b :edge ?c }'),
      rule('materialise', 'RULE { :a :reachesFar :c } WHERE { TUPLE(:reach, :a, :c) }'),
    ];
    const result = await new RuleSetExecutor().execute(
      seeded(ids, 'TUPLE(<http://ex/reach>, <http://ex/a>, <http://ex/b>)'),
      { initialGraph: '<http://ex/b> <http://ex/edge> <http://ex/c> .', maxIterations: 10 },
    );

    expect(result.finalGraphNQuads ?? '').toContain('<http://ex/a> <http://ex/reachesFar> <http://ex/c> .');
  });

  it('ignores a declaration row: a variable is an input, not a value', async () => {
    const ids = [rule('materialise', 'RULE { ?a :reaches ?b } WHERE { TUPLE(:reach, ?a, ?b) }')];
    const result = await new RuleSetExecutor().execute(
      seeded(ids, 'TUPLE(<http://ex/reach>, ?x, ?y)'),
      { maxIterations: 10 },
    );

    expect(result.status).toBe('converged');
    expect(result.finalGraphNQuads ?? '').not.toContain('<http://ex/reaches>');
  });

  it('fails the execution when the seed document is malformed', async () => {
    // Running with an empty store instead would make every tuple premise
    // vacuous — a wrong answer, not a missing one.
    const ids = [rule('materialise', 'RULE { ?a :reaches ?b } WHERE { TUPLE(:reach, ?a, ?b) }')];
    const result = await new RuleSetExecutor().execute(
      seeded(ids, 'this is not a tuple row'),
      { maxIterations: 10 },
    );

    expect(result.status).toBe('failed');
  });
});
