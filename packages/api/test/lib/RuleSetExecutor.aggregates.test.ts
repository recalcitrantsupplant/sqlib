import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { overrideFeatureFlags, resetFeatureFlags } from '../../src/config/featureFlags.js';
import { RuleGrammarValidator } from '../../src/lib/RuleGrammarValidator.js';

/**
 * The SRL rule-aggregates extension, end to end: a rule set run by
 * `RuleSetExecutor` against Oxigraph.
 *
 * The SRL package's own tests check the compiled SPARQL's shape; this checks
 * what it derives, which is the part that depends on an engine. The data and
 * the expected numbers are the worked examples from w3c/data-shapes#840.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
});

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const PREFIX = 'PREFIX : <http://ex/>';
const ex = (local: string) => `<http://ex/${local}>`;
const int = (n: number) => `"${n}"^^<http://www.w3.org/2001/XMLSchema#integer>`;

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

const run = async (hasRule: string[], turtle: string) => {
  const result = await new RuleSetExecutor().execute(ruleSetVersion(hasRule), {
    initialGraph: `${PREFIX}\n${turtle}`,
    initialGraphFormat: 'text/turtle',
    maxIterations: 25,
  });
  return result.finalGraphNQuads ?? '';
};

const FAMILY = `
  :bob a :Person ; :name "Bob", "Robert" .
  :amy a :Person ; :name "Amy" .
  :bob :parentOf :c1, :c2, :c3 .
  :c1 :age 10 . :c2 :age 10 . :c3 :age 7 .
`;

const SCORES = `
  :a :dept :sales ; :score 90 . :b :dept :sales ; :score 85 .
  :c :dept :sales ; :score 85 . :d :dept :sales ; :score 70 .
  :e :dept :ops ; :score 60 .   :f :dept :ops ; :score 50 .
`;

beforeEach(() => {
  hoisted.entities.clear();
  overrideFeatureFlags({ ruleAggregates: true });
});

afterAll(() => {
  resetFeatureFlags();
});

describe('RuleSetExecutor — rule aggregates', () => {
  it('counts a relation another rule derives, only once it is complete', async () => {
    // :childOf is derived, so the counting rule has to wait for it: counting
    // part-way through would leave a wrong count beside the right one.
    const graph = await run(
      [
        rule('child-of', 'RULE { ?y :childOf ?x } WHERE { ?x :parentOf ?y }'),
        rule('count', 'RULE { ?x :numChildren ?n ; :ageSum ?s } WHERE { ?x a :Person . '
          + 'AGGREGATE PER ?x { ?y :childOf ?x ; :age ?a } ( ?n := COUNT(*), ?s := SUM(?a) ) }'),
      ],
      FAMILY,
    );
    expect(graph).toContain(`${ex('bob')} ${ex('numChildren')} ${int(3)} .`);
    // Two children aged 10 are two solutions, so both count towards the sum.
    expect(graph).toContain(`${ex('bob')} ${ex('ageSum')} ${int(27)} .`);
    // A person with no children still gets a row, with 0.
    expect(graph).toContain(`${ex('amy')} ${ex('numChildren')} ${int(0)} .`);
    expect(graph).not.toContain(`${ex('bob')} ${ex('numChildren')} ${int(1)} .`);
  });

  it('keeps every outer row, so a person with two names is not counted twice', async () => {
    const graph = await run(
      [rule('named', 'RULE { ?x :label ?name ; :numChildren ?n } WHERE { ?x a :Person ; :name ?name . '
        + 'AGGREGATE PER ?x { ?x :parentOf ?y } ( ?n := COUNT(*) ) }')],
      FAMILY,
    );
    expect(graph).toContain(`${ex('bob')} ${ex('label')} "Robert" .`);
    expect(graph).toContain(`${ex('bob')} ${ex('numChildren')} ${int(3)} .`);
    expect(graph).not.toContain(`${ex('bob')} ${ex('numChildren')} ${int(6)} .`);
  });

  it('drops the row for MAX of an empty group', async () => {
    const graph = await run(
      [rule('oldest', 'RULE { ?x :oldestChild ?m } WHERE { ?x a :Person . '
        + 'AGGREGATE PER ?x { ?x :parentOf ?y . ?y :age ?a } ( ?m := MAX(?a) ) }')],
      FAMILY,
    );
    expect(graph).toContain(`${ex('bob')} ${ex('oldestChild')} ${int(10)} .`);
    expect(graph).not.toContain(`${ex('amy')} ${ex('oldestChild')}`);
  });

  it('ranks within a partition by counting the rows that beat each one', async () => {
    const graph = await run(
      [rule('rank', 'RULE { ?p :rank ?r } WHERE { ?p :dept ?d ; :score ?s . '
        + 'AGGREGATE PER ?d ?s { ?o :dept ?d ; :score ?s2 FILTER(?s2 > ?s) } ( ?b := COUNT(*) ) '
        + 'SET(?r := ?b + 1) }')],
      SCORES,
    );
    const ranks = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((p) => {
      const match = new RegExp(`<http://ex/${p}> <http://ex/rank> "(\\d+)"`).exec(graph);
      return [p, Number(match?.[1])];
    }));
    expect(ranks).toEqual({ a: 1, b: 2, c: 2, d: 4, e: 1, f: 2 });
  });

  it('PER * and GROUP BY derive the same counts where the head allows both', async () => {
    const graph = await run(
      [
        rule('implicit', 'RULE { ?x :viaAll ?n } WHERE { ?x a :Person . AGGREGATE PER * { ?x :parentOf ?y } ( ?n := COUNT(*) ) }'),
        rule('grouped', 'RULE { ?x :viaGroup ?n } WHERE { ?x a :Person ; :name ?name . '
          + 'AGGREGATE GROUP BY ?x { ?x :parentOf ?y } ( ?n := COUNT(*) ) }'),
      ],
      FAMILY,
    );
    expect(graph).toContain(`${ex('bob')} ${ex('viaAll')} ${int(3)} .`);
    expect(graph).toContain(`${ex('bob')} ${ex('viaGroup')} ${int(3)} .`);
    expect(graph).toContain(`${ex('amy')} ${ex('viaGroup')} ${int(0)} .`);
  });
});

describe('the rule-aggregates deployment gate', () => {
  const RULE = `${PREFIX}\nRULE { ?x :n ?n } WHERE { ?x a :Person . AGGREGATE PER ?x { ?x :parentOf ?y } ( ?n := COUNT(*) ) }`;

  it('validates an AGGREGATE rule when the flag is on', () => {
    const result = new RuleGrammarValidator().validateWithAllGrammars(RULE);
    expect(result.valid).toBe(true);
    expect(result.normalized).toContain('GROUP BY ?x');
  });

  it('refuses to run a stored aggregate rule once the flag is off', async () => {
    // Saved with the flag on: the version carries a compiled program, which a
    // run would otherwise execute without parsing the rule again.
    const id = rule('count', 'RULE { ?x :n ?n } WHERE { ?x a :Person . AGGREGATE PER ?x { ?x :parentOf ?y } ( ?n := COUNT(*) ) }');
    const stored = hoisted.entities.get(id) as Record<string, unknown>;
    stored.normalizedInsert = new RuleGrammarValidator().validateWithAllGrammars(String(stored.ruleString)).normalized;
    expect(stored.normalizedInsert).toContain('GROUP BY ?x');

    overrideFeatureFlags({ ruleAggregates: false });
    const result = await new RuleSetExecutor().execute(ruleSetVersion([id]), {
      initialGraph: `${PREFIX}\n${FAMILY}`,
      initialGraphFormat: 'text/turtle',
      maxIterations: 25,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/rule-aggregates extension, which is not enabled on this server/);
  });

  it('refuses it, naming the extension, when the flag is off', () => {
    overrideFeatureFlags({ ruleAggregates: false });
    const result = new RuleGrammarValidator().validateWithAllGrammars(RULE);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/rule-aggregates extension/);
  });
});
