import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * What `WHERE DATA` and `NOT DATA` match against: the ground graph `GD`.
 *
 * `GD` is frozen once, in `RuleSetExecutor.execute`, after the base graph is
 * loaded and *before* the DATA blocks run — so it is `G0`, the data graph, and
 * nothing else. Which is a reading rather than a transcription, because the
 * spec says it twice and not quite the same way (issue #174):
 *
 * - prose, [Matching Ground Data]: "Ground data is the triples in the base
 *   graph";
 * - pseudocode, [Evaluation of a Rule Set]: `let GD = G0 ∪ D`.
 *
 * The two disagree exactly when a DATA block supplies a triple a `NOT DATA`
 * asks about, and the upstream `eval-neg-data-03` / `-06` cases are that case:
 * base graph empty, `DATA { :s :p :o }`, and the expected result has the rule
 * firing — so the suite sides with the prose, against its own pseudocode. We
 * follow the prose, for the reasons written at the freeze point.
 *
 * Until now the only thing that would have caught that decision being reversed
 * was the W3C conformance ratchet, which scores 203 names and would report the
 * flip as two of them regressing. These tests put the decision where it is
 * made: each one states which reading it discriminates, so moving the freeze
 * line fails with a sentence rather than a scoreboard.
 *
 * `NOT DATA`'s stratification depends on the same reading — see
 * `packages/srl/test/groundData.test.ts`, where a rule that derives `:km` and
 * asks whether `:km` was in the input stratifies only because no rule can add
 * to the graph it asks. That is sound under `GD = G0` and unsound under
 * `GD = G0 ∪ D`, since a DATA block would then be something the rule reads.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
}));

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

/** The upstream cases' own prefix, so the rule text below is theirs verbatim. */
const PREFIX = 'PREFIX : <http://example/>';

const MSG = '<http://example/x> <http://example/msg> ":s :p :o inferred" .';
const SPO = '<http://example/s> <http://example/p> <http://example/o> .';

/** Register a DataBlockVersion the executor can load, and return its id. */
function dataBlock(id: string, dataString: string): string {
  const $id = `urn:test:data-block-version:${id}`;
  hoisted.entities.set($id, {
    $id,
    '@type': 'DataBlockVersion',
    isPartOf: `urn:test:data-block:${id}`,
    version: 1,
    dataString: `${PREFIX}\n${dataString}`,
    grammarValid: true,
  });
  return $id;
}

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

describe('RuleSetExecutor — NOT DATA negates against the base graph', () => {
  it('eval-neg-data-01: nothing anywhere, so the negation holds', async () => {
    const result = await run([], [rule('r', 'RULE { :x :msg ":s :p :o inferred" } WHERE { NOT DATA { :s :p ?o } }')]);

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([MSG]);
  });

  it('sees the base graph, which is the clause\'s whole purpose', async () => {
    // The spec's motivating case — "the rule must test whether the base graph
    // already contains a value" — so this is the one direction both readings
    // agree on, and the control for the two below.
    const result = await run(
      [],
      [rule('r', 'RULE { :x :msg ":s :p :o inferred" } WHERE { NOT DATA { :s :p ?o } }')],
      SPO,
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([]);
  });

  it('eval-neg-data-02: does not see what a rule derived', async () => {
    // A derived triple is in the evaluation graph and never in `GD`, however
    // `GD` is read — the pair with the case below, which is what makes "a DATA
    // block is a rule with an empty body" a claim with a consequence.
    const result = await run([], [
      rule('give', 'RULE { :s :p :o } WHERE { }'),
      rule('ask', 'RULE { :x :msg ":s :p :o inferred" } WHERE { NOT DATA { :s :p ?o } }'),
    ]);

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([MSG, SPO].sort());
  });

  it('eval-neg-data-03: does not see what a DATA block supplied — the prose reading', async () => {
    // THE discriminating case (#174). Under `GD = G0 ∪ D` the DATA block would
    // answer the negation and this rule would not fire; the upstream expected
    // result has it firing, and so do we.
    const result = await run(
      [dataBlock('d', 'DATA { :s :p :o }')],
      [rule('ask', 'RULE { :x :msg ":s :p :o inferred" } WHERE { NOT DATA { :s :p ?o } }')],
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([MSG, SPO].sort());
  });

  it('eval-neg-data-06: same, with the triple also read positively', async () => {
    // `:s :p ?o` matches in the evaluation graph, where the DATA block's triple
    // is, while `NOT DATA` asks the base graph, where it is not. One rule
    // holding both halves, which is the shape a default-value rule has.
    const result = await run(
      [dataBlock('d', 'DATA { :s :p :o }')],
      [rule('ask', 'RULE { :x :msg ":s :p :o inferred" } WHERE { :s :p ?o NOT DATA { :s :p ?o } }')],
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([MSG, SPO].sort());
  });

  it('distinguishes the two readings: the same triple in the base graph blocks the rule', async () => {
    // The pair above and this one differ in nothing but *where* `:s :p :o`
    // comes from — a DATA block, or the data graph. `GD = G0 ∪ D` would make
    // them the same run; they are not, and this is the assertion that says so.
    const result = await run(
      [],
      [rule('ask', 'RULE { :x :msg ":s :p :o inferred" } WHERE { :s :p ?o NOT DATA { :s :p ?o } }')],
      SPO,
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([]);
  });
});

describe('RuleSetExecutor — WHERE DATA matches the base graph', () => {
  it('matches a base-graph triple', async () => {
    const result = await run(
      [],
      [rule('ask', 'RULE { :x :msg ":s :p :o inferred" } WHERE DATA { :s :p ?o }')],
      SPO,
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([MSG]);
  });

  it('does not match a DATA block triple — the same decision, positively', async () => {
    // `WHERE DATA` and `NOT DATA` read one graph between them, so the reading
    // has to hold on both sides or a rule set could see a DATA block's triple
    // by asking about its absence and not by asking about its presence.
    const result = await run(
      [dataBlock('d', 'DATA { :s :p :o }')],
      [rule('ask', 'RULE { :x :msg ":s :p :o inferred" } WHERE DATA { :s :p ?o }')],
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([SPO]);
  });

  it('does not match what a rule derived', async () => {
    const result = await run([], [
      rule('give', 'RULE { :s :p :o } WHERE { }'),
      rule('ask', 'RULE { :x :msg ":s :p :o inferred" } WHERE DATA { :s :p ?o }'),
    ]);

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([SPO]);
  });
});
