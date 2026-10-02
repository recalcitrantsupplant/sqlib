import { describe, expect, it } from 'vitest';
import {
  checkWellFormed,
  compileRule,
  expandIris,
  formatRuleSet,
  generateRuleSet,
  parseRuleSet,
  stratify,
} from '../src/index.js';

const PREFIX = 'PREFIX : <http://example/>';
const opts = { aggregates: true } as const;

const parse = (doc: string) => parseRuleSet(`${PREFIX}\n${doc}`, opts);
const compile = (doc: string) => {
  const rs = expandIris(parse(doc));
  return compileRule(rs.rules[0], rs.prologueText);
};
const issues = (doc: string) => checkWellFormed(parse(doc)).map((i) => i.message);
const strat = (doc: string) => {
  const rs = parse(doc);
  return stratify(rs.rules.map((ast, i) => ({ id: `r${i}`, ast })));
};

const CHILDREN = 'RULE { ?x :numChildren ?n } WHERE { ?x a :Person . AGGREGATE PER ?x { ?y :childOf ?x } ( ?n := COUNT(*) ) }';

describe('rule aggregates — gating', () => {
  it('rejects AGGREGATE without the extension enabled', () => {
    expect(() => parseRuleSet(`${PREFIX}\n${CHILDREN}`)).toThrow(/rule-aggregates extension/i);
  });

  it('accepts AGGREGATE with the extension enabled', () => {
    expect(parse(CHILDREN).rules[0].body.map((b) => b.kind)).toEqual(['bgp', 'aggregate']);
  });

  it('leaves documents without AGGREGATE alone either way', () => {
    expect(() => parseRuleSet(`${PREFIX}\nRULE { ?x :q ?y } WHERE { ?x :p ?y }`)).not.toThrow();
  });
});

describe('rule aggregates — syntax', () => {
  it('reads the three join forms and the bare form', () => {
    const modes = parse(`
      RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER ?x { ?y :c ?x } ( ?n := COUNT(*) ) }
      RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER * { ?y :c ?x } ( ?n := COUNT(*) ) }
      RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE GROUP BY ?x { ?y :c ?x } ( ?n := COUNT(*) ) }
      RULE { :all :n ?n } WHERE { AGGREGATE { ?y :c ?x } ( ?n := COUNT(*) ) }
    `).rules.map((r) => {
      const agg = r.body.find((b) => b.kind === 'aggregate');
      return agg?.kind === 'aggregate' ? [agg.mode, agg.keys] : null;
    });
    expect(modes).toEqual([['per', ['x']], ['per-all', []], ['group', ['x']], ['per', []]]);
  });

  it('reads several assignments, DISTINCT and expression arguments', () => {
    const rule = parse(
      'RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER ?x { ?y :c ?x ; :p ?p ; :q ?q } '
      + '( ?n := COUNT(DISTINCT ?y), ?t := SUM(?p * ?q), ?m := MAX(?p) ) }',
    ).rules[0];
    const agg = rule.body[1];
    expect(agg.kind === 'aggregate' && agg.assignments.map((a) => a.variable)).toEqual(['n', 't', 'm']);
  });

  it('takes the keyword in any case — `a` must not swallow a lowercase `aggregate`', () => {
    expect(parse(CHILDREN.replace('AGGREGATE PER', 'aggregate per')).rules[0].body[1].kind).toBe('aggregate');
  });

  it('rejects SAMPLE and GROUP_CONCAT, whose results depend on row order', () => {
    expect(() => parse('RULE { :a :n ?n } WHERE { AGGREGATE { ?y :c ?x } ( ?n := SAMPLE(?y) ) }')).toThrow(/SAMPLE is not an AGGREGATE function/);
    expect(() => parse('RULE { :a :n ?n } WHERE { AGGREGATE { ?y :c ?x } ( ?n := GROUP_CONCAT(?y) ) }')).toThrow(/GROUP_CONCAT/);
  });

  it('rejects nesting and SET inside the pattern', () => {
    expect(() => parse(
      'RULE { :a :n ?n } WHERE { AGGREGATE { ?y :c ?x AGGREGATE { ?z :c ?y } ( ?k := COUNT(*) ) } ( ?n := COUNT(*) ) }',
    )).toThrow(/inside NOT or another AGGREGATE/);
    expect(() => parse(
      'RULE { ?x :n ?n } WHERE { ?x a :P NOT { AGGREGATE { ?y :c ?x } ( ?k := COUNT(*) ) } }',
    )).toThrow(/inside NOT or another AGGREGATE/);
    expect(() => parse(
      'RULE { :a :n ?n } WHERE { AGGREGATE { ?y :c ?x SET(?z := 1) } ( ?n := COUNT(*) ) }',
    )).toThrow(/SET cannot appear inside an AGGREGATE/);
  });

  it('rejects an aggregate inside an aggregate argument (Traqula already does)', () => {
    expect(() => parse('RULE { :a :n ?n } WHERE { AGGREGATE { ?y :c ?x } ( ?n := SUM(COUNT(?y)) ) }')).toThrow();
  });

  it('keeps aggregates out of FILTER and SET', () => {
    expect(() => parse('RULE { ?x :n ?n } WHERE { ?x :c ?n FILTER(COUNT(?n) > 1) }')).toThrow();
  });
});

describe('rule aggregates — round trip', () => {
  const doc = [
    'RULE { ?x :n ?n ; :m ?m } WHERE { ?x a :P . AGGREGATE PER ?x { ?y :c ?x ; :age ?a FILTER(?a > 1) NOT { ?y :d true } } ( ?n := COUNT(*), ?m := MAX(DISTINCT ?a) ) }',
    'RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER * { ?y :c ?x } ( ?n := COUNT(*) ) }',
    'RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE GROUP BY ?x { ?y :c ?x } ( ?n := SUM(?y) ) }',
    'RULE { :all :n ?n } WHERE { AGGREGATE { ?y :c ?x } ( ?n := COUNT(*) ) }',
  ].join('\n');

  it('generates text that parses back to the same rules', () => {
    const once = generateRuleSet(parse(doc));
    expect(generateRuleSet(parseRuleSet(once, opts))).toBe(once);
    expect(once).toContain('AGGREGATE PER ?x {');
    expect(once).toContain('AGGREGATE PER * {');
    expect(once).toContain('AGGREGATE GROUP BY ?x {');
    expect(once).toContain('} } ( ?n := COUNT( * ), ?m := MAX( DISTINCT ?a ) )');
  });

  it('formats idempotently, with the assignments after the closing brace', () => {
    const formatted = formatRuleSet(parse(doc));
    expect(formatRuleSet(parseRuleSet(formatted, opts))).toBe(formatted);
    expect(formatted).toMatch(/\n {2}AGGREGATE PER \?x \{\n {4}\?y :c \?x/);
    expect(formatted).toContain('\n  } ( ?n := COUNT( * ), ?m := MAX( DISTINCT ?a ) )');
  });
});

describe('rule aggregates — well-formedness', () => {
  it('accepts the worked examples', () => {
    expect(issues(CHILDREN)).toEqual([]);
    expect(issues(
      'RULE { ?p :rank ?r } WHERE { ?p :dept ?d ; :score ?s . '
      + 'AGGREGATE PER ?d ?s { ?o :dept ?d ; :score ?s2 FILTER(?s2 > ?s) } ( ?b := COUNT(*) ) SET(?r := ?b + 1) }',
    )).toEqual([]);
    expect(issues('RULE { :sales :staff ?n } WHERE { AGGREGATE { ?p :worksIn :sales ; :role ?r } ( ?n := COUNT(DISTINCT ?p) ) }')).toEqual([]);
  });

  it('keeps the outer row: a variable from before the aggregate can reach the head', () => {
    expect(issues(
      'RULE { ?x :name ?name ; :n ?n } WHERE { ?x a :P ; :name ?name . AGGREGATE PER ?x { ?y :c ?x } ( ?n := COUNT(*) ) }',
    )).toEqual([]);
  });

  it('under GROUP BY, only the listed variables and the results stay bound', () => {
    const found = checkWellFormed(parse(
      'RULE { ?x :name ?name ; :n ?n } WHERE { ?x a :P ; :name ?name . AGGREGATE GROUP BY ?x { ?y :c ?x } ( ?n := COUNT(*) ) }',
    ));
    expect(found.map((i) => [i.category, i.message])).toEqual([
      ['unbound-head', 'Head variable ?name is not bound by the rule body'],
    ]);
    expect(issues(
      'RULE { ?x :n ?n } WHERE { ?x a :P ; :name ?name . AGGREGATE GROUP BY ?x { ?y :c ?x } ( ?n := COUNT(*) ) FILTER(?name != "") }',
    )).toEqual(['?name is used by a FILTER before it is bound']);
  });

  it('needs every listed variable bound before the aggregate and used inside it', () => {
    expect(issues('RULE { :a :n ?n } WHERE { AGGREGATE PER ?x { ?y :c ?x } ( ?n := COUNT(*) ) }'))
      .toEqual(['PER ?x is not bound before the AGGREGATE']);
    expect(issues('RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER ?x { ?y :c :b } ( ?n := COUNT(*) ) }'))
      .toEqual(['PER ?x is not used inside the AGGREGATE']);
  });

  it('refuses an unlisted inner variable that is also used outside — correlation is written down', () => {
    expect(issues(
      'RULE { ?x :n ?n } WHERE { ?x a :P ; :knows ?y . AGGREGATE PER ?x { ?y :c ?x } ( ?n := COUNT(*) ) }',
    )).toEqual(['?y is used inside the AGGREGATE and outside it; list it after PER to correlate it, or rename the inner one']);
    // After the aggregate counts too.
    expect(issues(
      'RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER ?x { ?y :c ?x } ( ?n := COUNT(*) ) ?x :knows ?y }',
    )).toHaveLength(1);
  });

  it('lets two aggregates each have a local of the same name', () => {
    expect(issues(
      'RULE { ?x :n ?n ; :m ?m } WHERE { ?x a :P . AGGREGATE PER ?x { ?y :c ?x } ( ?n := COUNT(*) ) '
      + 'AGGREGATE PER ?x { ?y :d ?x } ( ?m := COUNT(*) ) }',
    )).toEqual([]);
  });

  it('PER * correlates whatever is shared with earlier elements, and nothing bound later', () => {
    expect(issues('RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER * { ?y :c ?x } ( ?n := COUNT(*) ) }')).toEqual([]);
    expect(issues(
      'RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER * { ?y :c ?x } ( ?n := COUNT(*) ) ?x :knows ?y }',
    )).toEqual(['?y is used inside the AGGREGATE and outside it; list it after PER to correlate it, or rename the inner one']);
  });

  it('refuses a result that is already bound, or assigned again', () => {
    expect(issues('RULE { ?x :n ?x } WHERE { ?x a :P . AGGREGATE PER ?x { ?y :c ?x } ( ?x := COUNT(*) ) }'))
      .toContain('AGGREGATE assigns ?x, which is already bound');
    expect(issues('RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER ?x { ?y :c ?x } ( ?n := COUNT(*), ?n := MAX(?y) ) }'))
      .toContain('AGGREGATE assigns ?n, which is already bound');
    expect(issues('RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER ?x { ?y :c ?x } ( ?n := COUNT(*) ) SET(?n := 1) }'))
      .toContain('?n is assigned by an AGGREGATE and again later in the body');
  });

  it('refuses an argument the pattern does not bind', () => {
    expect(issues('RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER ?x { ?y :c ?x } ( ?n := SUM(?z) ) }'))
      .toContain('The aggregate over ?z uses a variable the AGGREGATE pattern does not bind');
  });

  it('holds the inner FILTER to the order rule, with only the keys bound from outside', () => {
    expect(issues(
      'RULE { ?x :n ?n } WHERE { ?x a :P ; :min ?lo . AGGREGATE PER ?x { FILTER(?a > ?lo) ?y :c ?x ; :age ?a } ( ?n := COUNT(*) ) }',
    )).toContain('?a is used by a FILTER before it is bound');
  });
});

describe('rule aggregates — stratification', () => {
  it('makes the rule run-once, so what it counts is complete before it fires', () => {
    const report = strat(`
      RULE { ?y :childOf ?x } WHERE { ?x :parentOf ?y }
      ${CHILDREN}
    `);
    expect(report.issues).toEqual([]);
    expect(report.runOnce.r1).toBe(true);
    expect(report.monotonicity.r1).toBe('aggregation');
    expect(report.strata.r1).toBeGreaterThan(report.strata.r0);
    expect(report.edges.find((e) => e.from === 'r1' && e.to === 'r0')?.label).toBe('closed');
  });

  it('refuses recursion through an aggregate', () => {
    const report = strat('RULE { ?x :childOf ?n } WHERE { ?x a :Person . AGGREGATE PER ?x { ?y :childOf ?x } ( ?n := COUNT(*) ) }');
    expect(report.issues).not.toEqual([]);
    expect(report.cycles[0]?.kind).toBe('run-once');
    expect(report.cycles[0]?.runOnce?.[0]?.reasons).toContain('aggregate (AGGREGATE)');
  });
});

describe('rule aggregates — compile', () => {
  it('compiles to an OPTIONAL grouped subquery over renamed inner variables', () => {
    const { program } = compile(CHILDREN);
    expect(program).toContain('OPTIONAL {');
    expect(program).toContain('SELECT ?x (COUNT(*) AS ?_agg0_count) (COUNT( * ) AS ?_agg0_v0) WHERE {');
    expect(program).toContain('?_agg0_y <http://example/childOf> ?x');
    expect(program).toContain('GROUP BY ?x');
    // An empty group gives 0 for COUNT rather than dropping the row.
    expect(program).toContain('BIND(IF(COALESCE(?_agg0_count, 0) > 0, ?_agg0_v0, 0) AS ?n)');
    expect(program).toContain('FILTER(BOUND(?n))');
  });

  it('drops the row on an empty group for MIN, MAX and AVG', () => {
    const { program } = compile('RULE { ?x :oldest ?m } WHERE { ?x a :P . AGGREGATE PER ?x { ?y :c ?x ; :age ?a } ( ?m := MAX(?a) ) }');
    expect(program).toContain('FILTER(COALESCE(?_agg0_count, 0) > 0)');
    expect(program).toContain('BIND(?_agg0_v0 AS ?m)');
  });

  it('seeds the subquery with the outer rows only when a key appears just in a FILTER', () => {
    expect(compile(CHILDREN).program).not.toContain('SELECT DISTINCT');
    const { program } = compile(
      'RULE { ?p :rank ?r } WHERE { ?p :dept ?d ; :score ?s . '
      + 'AGGREGATE PER ?d ?s { ?o :dept ?d ; :score ?s2 FILTER(?s2 > ?s) } ( ?b := COUNT(*) ) SET(?r := ?b + 1) }',
    );
    expect(program).toContain('SELECT DISTINCT ?d ?s WHERE {');
  });

  it('projects GROUP BY down to the listed variables and the results', () => {
    const { program } = compile('RULE { ?x :n ?n } WHERE { ?x a :P ; :name ?name . AGGREGATE GROUP BY ?x { ?y :c ?x } ( ?n := COUNT(*) ) }');
    expect(program).toContain('SELECT DISTINCT ?x ?n WHERE {');
  });

  it('PER * correlates on what is bound before it', () => {
    const { program } = compile('RULE { ?x :n ?n } WHERE { ?x a :P . AGGREGATE PER * { ?y :c ?x } ( ?n := COUNT(*) ) }');
    expect(program).toContain('GROUP BY ?x');
  });

  it('keeps generated names clear of the author\'s', () => {
    const { program } = compile('RULE { ?x :n ?_agg0_y } WHERE { ?x a :P ; :q ?_agg0_y . AGGREGATE PER ?x { ?y :c ?x } ( ?n := COUNT(*) ) }');
    expect(program).toContain('?__agg0_y <http://example/c> ?x');
  });

  it('numbers a tuple read inside the pattern in order, and reports it', () => {
    const rs = expandIris(parseRuleSet(
      `${PREFIX}\nRULE { ?x :n ?n } WHERE { TUPLE(:p, ?x) AGGREGATE PER ?x { TUPLE(:c, ?y, ?x) } ( ?n := COUNT(*) ) }`,
      { aggregates: true, tuples: true },
    ));
    const compiled = compileRule(rs.rules[0], rs.prologueText);
    expect(compiled.tupleReads.map((r) => r.terms[0])).toEqual(['<http://example/p>', '<http://example/c>']);
    expect(compiled.program).toContain('# TUPLE(<http://example/c>, ?_agg0_y, ?x)');
  });
});
