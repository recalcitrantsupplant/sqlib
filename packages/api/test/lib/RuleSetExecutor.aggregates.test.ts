import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { overrideFeatureFlags, resetFeatureFlags } from '../../src/config/featureFlags.js';
import { RuleGrammarValidator } from '../../src/lib/RuleGrammarValidator.js';

/**
 * `GROUP` aggregation (w3c/data-shapes#1347), end to end: a rule set run by
 * `RuleSetExecutor` against Oxigraph.
 *
 * The SRL package's own tests check the compiled SPARQL's shape; this checks
 * what it derives, which is the part that depends on an engine. The data and
 * the expected numbers are the worked examples from w3c/data-shapes#840 and
 * #1344.
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

describe('RuleSetExecutor — GROUP', () => {
  it('counts a relation another rule derives, only once it is complete', async () => {
    // :childOf is derived, so the counting rule has to wait for it: counting
    // part-way through would leave a wrong count beside the right one.
    const graph = await run(
      [
        rule('child-of', 'RULE { ?y :childOf ?x } WHERE { ?x :parentOf ?y }'),
        rule('count', 'RULE { ?x :numChildren ?n ; :ageSum ?s } WHERE { ?x a :Person . '
          + 'GROUP BY ?x { ?y :childOf ?x ; :age ?a } [ ?n := COUNT(*) , ?s := SUM(?a) ] }'),
      ],
      FAMILY,
    );
    expect(graph).toContain(`${ex('bob')} ${ex('numChildren')} ${int(3)} .`);
    // Two children aged 10 are two solutions, so both count towards the sum.
    expect(graph).toContain(`${ex('bob')} ${ex('ageSum')} ${int(27)} .`);
    // A person with no children forms no group, so gets no row
    // (w3c/data-shapes#1377).
    expect(graph).not.toContain(`${ex('amy')} ${ex('numChildren')}`);
    expect(graph).not.toContain(`${ex('bob')} ${ex('numChildren')} ${int(1)} .`);
  });

  it('carries a name through BY, and a person with two names is not counted twice', async () => {
    const graph = await run(
      [rule('named', 'RULE { ?x :label ?name ; :numChildren ?n } WHERE { ?x a :Person ; :name ?name . '
        + 'GROUP BY ?x ?name { ?x :parentOf ?y } [ ?n := COUNT(*) ] }')],
      FAMILY,
    );
    expect(graph).toContain(`${ex('bob')} ${ex('label')} "Robert" .`);
    expect(graph).toContain(`${ex('bob')} ${ex('numChildren')} ${int(3)} .`);
    expect(graph).not.toContain(`${ex('bob')} ${ex('numChildren')} ${int(6)} .`);
  });

  it('drops the row for MAX of an empty group', async () => {
    const graph = await run(
      [rule('oldest', 'RULE { ?x :oldestChild ?m } WHERE { ?x a :Person . '
        + 'GROUP BY ?x { ?x :parentOf ?y . ?y :age ?a } [ ?m := MAX(?a) ] }')],
      FAMILY,
    );
    expect(graph).toContain(`${ex('bob')} ${ex('oldestChild')} ${int(10)} .`);
    expect(graph).not.toContain(`${ex('amy')} ${ex('oldestChild')}`);
  });

  it('ranks within a partition by counting the rows that beat each one', async () => {
    const graph = await run(
      // The GROUP keeps only ?d, ?s and ?b, so the person is matched again.
      [rule('rank', 'RULE { ?p :rank ?r } WHERE { ?q :dept ?d ; :score ?s . '
        + 'GROUP BY ?d ?s { ?o :dept ?d ; :score ?s2 FILTER(?s2 > ?s) } [ ?b := COUNT(*) ] '
        + '?p :dept ?d ; :score ?s . SET(?r := ?b + 1) }')],
      SCORES,
    );
    const ranks = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((p) => {
      const match = new RegExp(`<http://ex/${p}> <http://ex/rank> "(\\d+)"`).exec(graph);
      return [p, Number(match?.[1])];
    }));
    // The top score in a department has nobody above it, so it forms no group
    // and gets no rank.
    expect(ranks).toEqual({ a: NaN, b: 2, c: 2, d: 4, e: NaN, f: 2 });
  });

  it('makes one group of every earlier row when there is no BY', async () => {
    const graph = await run(
      [rule('census', 'RULE { :census :children ?n } WHERE { ?x a :Person . GROUP { ?y :parentOf ?z } [ ?n := COUNT(*) ] }')],
      FAMILY,
    );
    expect(graph).toContain(`${ex('census')} ${ex('children')} ${int(3)} .`);
  });

  it('keeps a first GROUP\'s result through a second that lists it', async () => {
    const graph = await run(
      [rule('two', 'RULE { ?x :kids ?n ; :young ?m } WHERE { ?x a :Person . '
        + 'GROUP BY ?x { ?x :parentOf ?y } [ ?n := COUNT(*) ] '
        + 'GROUP BY ?x ?n { ?x :parentOf ?y . ?y :age ?a FILTER(?a < 10) } [ ?m := COUNT(*) ] }')],
      FAMILY,
    );
    expect(graph).toContain(`${ex('bob')} ${ex('kids')} ${int(3)} .`);
    expect(graph).toContain(`${ex('bob')} ${ex('young')} ${int(1)} .`);
    // Amy has no children, so the first GROUP forms no group for her.
    expect(graph).not.toContain(`${ex('amy')}`);
  });
});

describe('RuleSetExecutor — feeding a GROUP one value per item', () => {
  // `:o1` has two tags, so a pattern matching `?o :amount ?a ; :tag ?t` gives
  // its amount twice: SUM(?a) is 300 and SUM(DISTINCT ?a) is 100, because both
  // amounts are 100. A helper rule that derives one fact per order gives 200.
  const ORDERS = `
    :o1 :amount 100 ; :tag :urgent, :export .
    :o2 :amount 100 ; :tag :urgent .
    :o3 :amount 50 .
  `;

  it('sums one amount per order when a helper rule derives the items', async () => {
    const graph = await run(
      [
        rule('tagged', 'RULE { ?o :taggedAmount ?a } WHERE { ?o :amount ?a ; :tag ?t }'),
        rule('total', 'RULE { :all :total ?total } WHERE { GROUP { ?o :taggedAmount ?a } [ ?total := SUM(?a) ] }'),
      ],
      ORDERS,
    );
    expect(graph).toContain(`${ex('all')} ${ex('total')} ${int(200)} .`);
  });

  it('does the same through a tuple, which keeps the helper relation out of the graph', async () => {
    overrideFeatureFlags({ ruleAggregates: true, ruleTuples: true });
    const graph = await run(
      [
        rule('tagged', 'RULE { TUPLE(:taggedAmount, ?o, ?a) } WHERE { ?o :amount ?a ; :tag ?t }'),
        rule('total', 'RULE { :all :total ?total } WHERE { GROUP { TUPLE(:taggedAmount, ?o, ?a) } [ ?total := SUM(?a) ] }'),
      ],
      ORDERS,
    );
    expect(graph).toContain(`${ex('all')} ${ex('total')} ${int(200)} .`);
    expect(graph).not.toContain('taggedAmount');
  });

  it('gives 300 when the pattern itself multiplies the rows', async () => {
    const graph = await run(
      [rule('total', 'RULE { :all :total ?total } WHERE { GROUP { ?o :amount ?a ; :tag ?t } [ ?total := SUM(?a) ] }')],
      ORDERS,
    );
    expect(graph).toContain(`${ex('all')} ${ex('total')} ${int(300)} .`);
  });
});

describe('the rule-aggregates deployment gate', () => {
  const RULE = `${PREFIX}\nRULE { ?x :n ?n } WHERE { ?x a :Person . GROUP BY ?x { ?x :parentOf ?y } [ ?n := COUNT(*) ] }`;

  it('validates a GROUP rule when the flag is on', () => {
    const result = new RuleGrammarValidator().validateWithAllGrammars(RULE);
    expect(result.valid).toBe(true);
    expect(result.normalized).toContain('GROUP BY ?x');
  });

  it('refuses to run a stored aggregate rule once the flag is off', async () => {
    // Saved with the flag on: the version carries a compiled program, which a
    // run would otherwise execute without parsing the rule again.
    const id = rule('count', 'RULE { ?x :n ?n } WHERE { ?x a :Person . GROUP BY ?x { ?x :parentOf ?y } [ ?n := COUNT(*) ] }');
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
