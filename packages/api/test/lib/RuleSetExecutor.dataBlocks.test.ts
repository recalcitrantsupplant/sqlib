import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * DATA blocks and the inference graph.
 *
 * SHACL 1.2 Rules initialises the inference graph from the DATA triples —
 * "a data block is equivalent to a rule with an empty body: its triples are
 * part of the inference graph without any rule being evaluated", formally
 * `GI = { t ∈ D | t ∉ G0 }`. The executor used to capture its subtraction
 * baseline *after* running the data blocks, which folded DATA triples into the
 * base graph and removed them from the result.
 *
 * These are the upstream `eval-data-01` / `eval-data-02` cases ported as
 * executor tests, plus the two boundary conditions the port does not cover
 * (a DATA triple that is already in G0, and G0 itself staying out of the
 * output). The full W3C eval harness is tracked separately.
 *
 * See `docs/reference/srl-language.md`.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
}));

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const PREFIX = 'PREFIX : <http://example.org/ns#>';

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

function ruleSetVersion(hasDataBlock: string[], hasRule: string[] = []) {
  return {
    $id: 'urn:test:rule-set-version:1',
    '@type': 'RuleSetVersion',
    isPartOf: 'urn:test:rule-set:1',
    version: 1,
    hasRule,
    hasDataBlock,
  } as never;
}

const run = (hasDataBlock: string[], hasRule: string[] = [], initialGraph?: string) =>
  new RuleSetExecutor().execute(ruleSetVersion(hasDataBlock, hasRule), {
    initialGraph,
    maxIterations: 10,
  });

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

describe('RuleSetExecutor — DATA blocks are inference-graph output', () => {
  it('eval-data-01: a lone DATA block is the whole inference graph', async () => {
    const result = await run([dataBlock('d1', 'DATA { :a :b :c }')]);

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([
      '<http://example.org/ns#a> <http://example.org/ns#b> <http://example.org/ns#c> .',
    ]);
  });

  it('eval-data-02: two DATA blocks and an empty rule', async () => {
    const result = await run(
      [dataBlock('d1', 'DATA { :a :b :c }'), dataBlock('d2', 'DATA { :d :e :f }')],
      [rule('empty', 'RULE { } WHERE { }')],
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([
      '<http://example.org/ns#a> <http://example.org/ns#b> <http://example.org/ns#c> .',
      '<http://example.org/ns#d> <http://example.org/ns#e> <http://example.org/ns#f> .',
    ]);
  });

  it('omits a DATA triple that is already in the base graph (GI = D \\ G0)', async () => {
    const result = await run(
      [dataBlock('d1', 'DATA { :a :b :c . :d :e :f }')],
      [],
      '<http://example.org/ns#a> <http://example.org/ns#b> <http://example.org/ns#c> .',
    );

    expect(triples(result.finalGraphNQuads)).toEqual([
      '<http://example.org/ns#d> <http://example.org/ns#e> <http://example.org/ns#f> .',
    ]);
  });

  it('keeps the data graph itself out of the inference graph', async () => {
    const result = await run(
      [],
      [rule('copy', 'RULE { ?s :derived ?o } WHERE { ?s :edge ?o }')],
      '<http://example.org/ns#a> <http://example.org/ns#edge> <http://example.org/ns#b> .',
    );

    expect(triples(result.finalGraphNQuads)).toEqual([
      '<http://example.org/ns#a> <http://example.org/ns#derived> <http://example.org/ns#b> .',
    ]);
  });

  it('carries DATA-block facts into the output alongside what rules derive from them', async () => {
    // The repro from the design doc: a DATA block feeding a rule chain returned
    // only the derived triples, never the given ones.
    const result = await run(
      [dataBlock('edges', 'DATA { :a :edge :b . :b :edge :c }')],
      [
        rule('reach-base', 'RULE { ?x :reaches ?y } WHERE { ?x :edge ?y }'),
        rule('reach-step', 'RULE { ?x :reaches ?z } WHERE { ?x :reaches ?y . ?y :edge ?z }'),
      ],
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([
      '<http://example.org/ns#a> <http://example.org/ns#edge> <http://example.org/ns#b> .',
      '<http://example.org/ns#a> <http://example.org/ns#reaches> <http://example.org/ns#b> .',
      '<http://example.org/ns#a> <http://example.org/ns#reaches> <http://example.org/ns#c> .',
      '<http://example.org/ns#b> <http://example.org/ns#edge> <http://example.org/ns#c> .',
      '<http://example.org/ns#b> <http://example.org/ns#reaches> <http://example.org/ns#c> .',
    ]);
  });
});

/**
 * `seededQuads` is what makes a replay of a run reconcile.
 *
 * A client stepping through an execution rebuilds the inference graph by
 * applying each rule's inserts and deletes in order. Without the DATA blocks'
 * own triples it would end up short by exactly them, and the last step would
 * disagree with the final graph the same response carries — so the invariant
 * below is the feature, not an implementation detail.
 */
describe('RuleSetExecutor — seededQuads accounts for the DATA blocks', () => {
  it('reports the triples the DATA blocks seeded', async () => {
    const result = await run([dataBlock('d1', 'DATA { :a :b :c }')]);

    expect(triples(result.seededQuads?.join('\n'))).toEqual([
      '<http://example.org/ns#a> <http://example.org/ns#b> <http://example.org/ns#c> .',
    ]);
  });

  it('seeded plus every rule delta equals the final graph', async () => {
    const result = await run(
      [dataBlock('d1', 'DATA { :a :edge :b . :b :edge :c }')],
      [rule('r1', 'RULE { ?x :reaches ?y } WHERE { ?x :edge ?y }')],
    );

    expect(result.status).toBe('converged');

    // Replay the run the way the UI does: start from what the DATA blocks
    // seeded, then apply each rule firing in order.
    const replayed = new Set(result.seededQuads ?? []);
    for (const iteration of result.iterations) {
      for (const record of iteration.rules) {
        for (const quad of record.deletedQuads) replayed.delete(quad);
        for (const quad of record.insertedQuads) replayed.add(quad);
      }
    }

    expect([...replayed].sort()).toEqual(triples(result.finalGraphNQuads));
  });

  it('excludes the base graph, which is input rather than inference', async () => {
    const result = await run(
      [dataBlock('d1', 'DATA { :d :e :f }')],
      [],
      '<http://example.org/ns#a> <http://example.org/ns#b> <http://example.org/ns#c> .',
    );

    expect(triples(result.seededQuads?.join('\n'))).toEqual([
      '<http://example.org/ns#d> <http://example.org/ns#e> <http://example.org/ns#f> .',
    ]);
  });

  it('is an empty list when there are no DATA blocks', async () => {
    const result = await run([], [rule('r1', 'RULE { :a :b :c } WHERE { }')]);
    expect(result.seededQuads).toEqual([]);
  });
});
