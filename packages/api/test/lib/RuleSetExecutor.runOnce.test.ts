import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Run-once (`SL.once`) rule scheduling.
 *
 * A rule that mints a blank node or assigns a value derives a *fresh* answer on
 * every firing, so iterating it to a fixpoint never terminates: it emits one
 * copy of its output per pass. SPARQL-RL handles this by promoting such a
 * rule's body dependencies to "closed" (strictly higher stratum, as `NOT` gets)
 * and evaluating it exactly once per stratum instead of iterating it.
 *
 * Before that landed, a blank-node-headed rule returned `maxIterations` copies
 * of its head — the answer depended on a tuning knob.
 *
 * See issue #156 and `packages/srl/src/stratify.ts`.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
}));

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const NS = 'http://example.org/ns#';
const PREFIX = `PREFIX : <${NS}>`;

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

function ruleSetVersion(hasRule: string[], stratificationReport?: string) {
  return {
    $id: 'urn:test:rule-set-version:1',
    '@type': 'RuleSetVersion',
    isPartOf: 'urn:test:rule-set:1',
    version: 1,
    hasRule,
    hasDataBlock: [],
    stratificationReport,
  } as never;
}

/** Execute with the *default* options a caller gets. */
const run = (hasRule: string[], initialGraph: string, maxIterations = 5) =>
  new RuleSetExecutor().execute(ruleSetVersion(hasRule), { initialGraph, maxIterations });

/** The inference graph as N-Triples lines, order-insensitive. */
const triples = (nquads: string | undefined): string[] =>
  (nquads ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();

/** Replace blank node labels with `_:b`, so content can be asserted on. */
const anonymize = (lines: string[]): string[] => lines.map((line) => line.replace(/_:[A-Za-z0-9]+/g, '_:b')).sort();

beforeEach(() => {
  hoisted.entities.clear();
});

describe('RuleSetExecutor — run-once rules', () => {
  it('fires a blank-node-headed rule exactly once, whatever maxIterations is', async () => {
    // The issue #156 probe: one match, so the spec answer is two triples about
    // a single fresh node. Iterating produced `maxIterations` copies instead.
    const ruleSet = [
      rule('notify', 'RULE { [] a :Notification ; :concerns ?x } WHERE { ?x :status :criticallyExposed }'),
    ];
    const graph = `<${NS}a> <${NS}status> <${NS}criticallyExposed> .`;

    const result = await run(ruleSet, graph, 5);

    expect(result.status).toBe('converged');
    expect(anonymize(triples(result.finalGraphNQuads))).toEqual([
      `_:b <${NS}concerns> <${NS}a> .`,
      `_:b <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${NS}Notification> .`,
    ]);

    // The answer is the rule set's, not the knob's.
    const wider = await run(ruleSet, graph, 25);
    expect(triples(wider.finalGraphNQuads)).toHaveLength(2);
  });

  it('mints one fresh node per match, not per iteration', async () => {
    const result = await run(
      [rule('notify', 'RULE { [] :concerns ?x } WHERE { ?x :status :criticallyExposed }')],
      `<${NS}a> <${NS}status> <${NS}criticallyExposed> .\n<${NS}b> <${NS}status> <${NS}criticallyExposed> .`,
    );

    expect(result.status).toBe('converged');
    expect(anonymize(triples(result.finalGraphNQuads))).toEqual([
      `_:b <${NS}concerns> <${NS}a> .`,
      `_:b <${NS}concerns> <${NS}b> .`,
    ]);
  });

  it('runs a blank-node-headed rule after the rules it reads have converged', async () => {
    // `:reaches` is transitive, so the once-rule must not fire until the
    // closure is complete — otherwise it misses `:a :reaches :c`.
    const result = await run(
      [
        rule('reach-base', 'RULE { ?x :reaches ?y } WHERE { ?x :edge ?y }'),
        rule('reach-step', 'RULE { ?x :reaches ?z } WHERE { ?x :reaches ?y . ?y :edge ?z }'),
        rule('note', 'RULE { [] :covers ?z } WHERE { :a :reaches ?z }'),
      ],
      `<${NS}a> <${NS}edge> <${NS}b> .\n<${NS}b> <${NS}edge> <${NS}c> .`,
      10,
    );

    expect(result.status).toBe('converged');
    const covers = anonymize(triples(result.finalGraphNQuads)).filter((t) => t.includes(`${NS}covers`));
    expect(covers).toEqual([`_:b <${NS}covers> <${NS}b> .`, `_:b <${NS}covers> <${NS}c> .`]);
  });

  it('fires a SET rule once, strictly above the rule it reads', async () => {
    const result = await run(
      [
        rule('label', 'RULE { ?s :label ?o } WHERE { ?s :name ?o }'),
        rule('greet', 'RULE { ?s :greeting ?g } WHERE { ?s :label ?o SET ( ?g := CONCAT("hi ", ?o) ) }'),
      ],
      `<${NS}a> <${NS}name> "bob" .`,
      10,
    );

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toEqual([
      `<${NS}a> <${NS}greeting> "hi bob" .`,
      `<${NS}a> <${NS}label> "bob" .`,
    ]);
  });

  it('recomputes a stratification report written before run-once scheduling', async () => {
    // A stored report with no `runOnce` also predates closed-edge promotion, so
    // its strata cannot be trusted either: honouring it would keep executing
    // the rule set the old way.
    const ruleId = rule('notify', 'RULE { [] :concerns ?x } WHERE { ?x :status :criticallyExposed }');
    const stale = JSON.stringify({
      strata: { [ruleId]: 0 },
      monotonicity: { [ruleId]: 'monotone' },
      edges: [],
      issues: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await new RuleSetExecutor().execute(ruleSetVersion([ruleId], stale), {
      initialGraph: `<${NS}a> <${NS}status> <${NS}criticallyExposed> .`,
      maxIterations: 5,
    });

    expect(result.status).toBe('converged');
    expect(triples(result.finalGraphNQuads)).toHaveLength(1);
  });

  it('keeps iterating ordinary rules that read a run-once rule\'s output', async () => {
    const result = await run(
      [
        rule('seed', 'RULE { [] :step :s1 } WHERE { ?x :start true }'),
        rule('chain', 'RULE { ?n :step :s2 } WHERE { ?n :step :s1 }'),
        rule('chain2', 'RULE { ?n :step :s3 } WHERE { ?n :step :s2 }'),
      ],
      `<${NS}x> <${NS}start> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> .`,
      10,
    );

    expect(result.status).toBe('converged');
    expect(anonymize(triples(result.finalGraphNQuads))).toEqual([
      `_:b <${NS}step> <${NS}s1> .`,
      `_:b <${NS}step> <${NS}s2> .`,
      `_:b <${NS}step> <${NS}s3> .`,
    ]);
  });
});
