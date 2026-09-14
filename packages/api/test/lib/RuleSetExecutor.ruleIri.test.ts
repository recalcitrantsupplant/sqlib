import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Attribution: which rule a result is recorded against.
 *
 * A rule set names its rules — `RULE <http://ex/reaches>` — and that name is
 * what an author recognises. The entity id that happens to carry the rule
 * through execution is not: in the playground it is minted per run, and for a
 * saved rule set it is a UUID. So the execution record carries the declared IRI
 * where there is one, and the reader is shown that.
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
    { initialGraph, maxIterations: 5 },
  );

/** Every rule record of every iteration, flattened. */
const records = (result: Awaited<ReturnType<typeof run>>) =>
  result.iterations.flatMap((iteration) => iteration.rules);

beforeEach(() => {
  hoisted.entities.clear();
});

describe('RuleSetExecutor — rule attribution', () => {
  it('records the IRI the SRL gives a rule', async () => {
    const ids = [rule('named', 'RULE :materialise { ?x :reaches ?y } WHERE { ?x :edge ?y }')];

    const result = await run(ids, '<http://ex/a> <http://ex/edge> <http://ex/b> .');

    expect(records(result).map((r) => r.ruleIri)).toContain('http://ex/materialise');
  });

  it('expands a prefixed name against the rule\'s own prologue', async () => {
    // The name is written `:materialise`; what the reader is shown, and what
    // any other view of this rule set uses, is the expanded IRI.
    const ids = [rule('prefixed', 'RULE :materialise { ?x :reaches ?y } WHERE { ?x :edge ?y }')];

    const result = await run(ids, '<http://ex/a> <http://ex/edge> <http://ex/b> .');

    expect(records(result)[0]?.ruleIri).toBe('http://ex/materialise');
    expect(records(result)[0]?.ruleIri).not.toContain(':materialise');
  });

  it('leaves an unnamed rule without one, so it falls back to the entity id', async () => {
    const ids = [rule('anon', 'RULE { ?x :reaches ?y } WHERE { ?x :edge ?y }')];

    const result = await run(ids, '<http://ex/a> <http://ex/edge> <http://ex/b> .');

    const record = records(result)[0]!;
    expect(record.ruleIri).toBeUndefined();
    expect(record.ruleVersionId).toBe('urn:test:rule-version:anon');
  });

  it('records it for a tuple rule too, which compiles down a different path', async () => {
    const ids = [
      rule('tuple', 'RULE :reach-base { TUPLE(:reach, ?x, ?y) } WHERE { ?x :edge ?y }'),
    ];

    const result = await run(ids, '<http://ex/a> <http://ex/edge> <http://ex/b> .');

    expect(records(result)[0]?.ruleIri).toBe('http://ex/reach-base');
  });
});
