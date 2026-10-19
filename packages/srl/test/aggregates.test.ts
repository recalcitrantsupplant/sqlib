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

/**
 * `GROUP` aggregation, in the syntax of w3c/data-shapes#1347.
 *
 * What it derives on a real engine is in the API's
 * `RuleSetExecutor.aggregates*.test.ts`; these pin the parse, the checks, the
 * stratification and the shape of the compiled SPARQL.
 */

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
const aggregateOf = (doc: string) => {
  const item = parse(doc).rules[0].body.find((b) => b.kind === 'aggregate');
  if (item?.kind !== 'aggregate') throw new Error('no GROUP in the rule');
  return item;
};

const CHILDREN = 'RULE { ?x :numChildren ?n } WHERE { ?x a :Person . GROUP BY ?x { ?y :childOf ?x } [ ?n := COUNT(*) ] }';

describe('GROUP — gating', () => {
  it('rejects GROUP without the extension enabled', () => {
    expect(() => parseRuleSet(`${PREFIX}\n${CHILDREN}`)).toThrow(/GROUP requires the rule-aggregates extension/);
  });

  it('accepts GROUP with the extension enabled', () => {
    expect(parse(CHILDREN).rules[0].body.map((b) => b.kind)).toEqual(['bgp', 'aggregate']);
  });

  it('leaves documents without GROUP alone either way', () => {
    expect(() => parseRuleSet(`${PREFIX}\nRULE { ?x :q ?y } WHERE { ?x :p ?y }`)).not.toThrow();
  });
});

describe('GROUP — syntax', () => {
  it('reads BY variables, the pattern and the assignments', () => {
    const item = aggregateOf(CHILDREN);
    expect(item.keys).toEqual(['x']);
    expect(item.body.map((b) => b.kind)).toEqual(['bgp']);
    expect(item.assignments.map((a) => a.variable)).toEqual(['n']);
  });

  it('reads several BY variables, with no separator', () => {
    expect(aggregateOf('RULE { } WHERE { ?s ?p ?o GROUP BY ?s ?p { ?s ?p ?q } [ ?n := COUNT(*) ] }').keys)
      .toEqual(['s', 'p']);
  });

  it('reads no BY as no keys', () => {
    expect(aggregateOf('RULE { :all :n ?n } WHERE { GROUP { ?s ?p ?o } [ ?n := COUNT(*) ] }').keys).toEqual([]);
  });

  it('reads several assignments, with no separator', () => {
    const item = aggregateOf(
      'RULE { } WHERE { ?s a :T GROUP BY ?s { ?s :p ?o } [ ?n := COUNT(*) ?d := COUNT(DISTINCT ?o) ?t := SUM(?o) ?lo := MIN(?o) ?hi := MAX(?o) ] }',
    );
    expect(item.assignments.map((a) => a.variable)).toEqual(['n', 'd', 't', 'lo', 'hi']);
  });

  it('reads an empty block, written [] or [ ]', () => {
    expect(aggregateOf('RULE { } WHERE { GROUP { ?s ?p ?o } [] }').assignments).toEqual([]);
    expect(aggregateOf('RULE { } WHERE { GROUP { ?s ?p ?o } [ ] }').assignments).toEqual([]);
  });

  it('accepts COUNT(DISTINCT *), as the PR\'s group-11 does', () => {
    expect(() => parse('RULE { } WHERE { GROUP { ?s ?p ?o } [ ?n := COUNT(DISTINCT *) ] }')).not.toThrow();
  });

  it('accepts FILTER and SET in the pattern', () => {
    const item = aggregateOf('RULE { } WHERE { ?s a :T GROUP BY ?s { ?s :p ?o FILTER(?o < 42) SET (?z := ?o + 1) } [ ?n := SUM(?z) ] }');
    expect(item.body.map((b) => b.kind)).toEqual(['bgp', 'filter', 'set']);
  });

  it('takes the keywords in any case', () => {
    expect(aggregateOf(CHILDREN.replace('GROUP BY', 'group by').replace('COUNT', 'count')).keys).toEqual(['x']);
  });

  it('allows a triple pattern starting with ( after the block', () => {
    expect(parse('RULE { } WHERE { GROUP { ?s ?p ?o } [] ( 1 2 ) :p ?o }').rules[0].body.map((b) => b.kind))
      .toEqual(['aggregate', 'bgp']);
  });

  it.each([
    ['no pattern', 'GROUP BY ?s [ ?n := COUNT(*) ]', /Parse error/],
    ['no block', 'GROUP BY ?x { }', /Parse error/],
    ['BY with no variables', 'GROUP BY { ?s ?p ?o } [ ?n := COUNT(*) ]', /Parse error/],
    ['a comma between assignments', 'GROUP { ?s ?p ?o } [ ?n := COUNT(*), ?t := SUM(?o) ]', /Parse error/],
    ['parentheses around an assignment', 'GROUP { ?s ?p ?o } [ ( ?n := COUNT(*) ) ]', /Parse error/],
    ['an expression in COUNT', 'GROUP { ?s :p ?o } [ ?n := COUNT(?s + ?o) ]', /COUNT takes a variable or \*/],
    ['an expression in SUM', 'GROUP { ?s :p ?o } [ ?n := SUM(?o + 1) ]', /SUM takes a variable, not an expression/],
    ['DISTINCT in MIN', 'GROUP { ?s :p ?o } [ ?n := MIN(DISTINCT ?o) ]', /MIN does not take DISTINCT/],
    ['DISTINCT in MAX', 'GROUP { ?s :p ?o } [ ?n := MAX(DISTINCT ?o) ]', /MAX does not take DISTINCT/],
    ['DISTINCT in SUM', 'GROUP { ?s :p ?o } [ ?n := SUM(DISTINCT ?o) ]', /SUM does not take DISTINCT/],
    ['AVG', 'GROUP { ?s :p ?o } [ ?n := AVG(?o) ]', /AVG is not a GROUP aggregation function/],
    ['SAMPLE', 'GROUP { ?s :p ?o } [ ?n := SAMPLE(?o) ]', /SAMPLE is not a GROUP aggregation function/],
    ['GROUP_CONCAT', 'GROUP { ?s :p ?o } [ ?n := GROUP_CONCAT(?o) ]', /GROUP_CONCAT is not a GROUP aggregation function/],
    ['an assignment that is not an aggregate', 'GROUP { ?s :p ?o } [ ?n := ?o ]', /Parse error|Expected/],
    ['NOT in the pattern', 'GROUP { ?s :p ?o NOT { ?s :q ?o } } [ ?n := COUNT(*) ]', /NOT cannot appear inside a GROUP pattern/],
    ['a GROUP in the pattern', 'GROUP { ?s :p ?o GROUP { ?o :q ?z } [] } [ ?n := COUNT(*) ]', /GROUP cannot appear inside NOT or another GROUP/],
  ])('rejects %s', (_label, element, message) => {
    expect(() => parse(`RULE { } WHERE { ${element} }`)).toThrow(message);
  });

  it('rejects a GROUP inside a NOT', () => {
    expect(() => parse('RULE { ?x :r true } WHERE { ?x a :P NOT { GROUP { ?y :c ?x } [] } }'))
      .toThrow(/GROUP cannot appear inside NOT or another GROUP/);
  });

  it('keeps aggregate functions out of FILTER and SET', () => {
    expect(() => parse('RULE { ?x :n ?n } WHERE { ?x :c ?n FILTER(COUNT(?n) > 1) }')).toThrow();
    expect(() => parse('RULE { ?x :n ?m } WHERE { ?x :c ?n SET (?m := COUNT(?n)) }')).toThrow();
  });
});

describe('GROUP — round trip', () => {
  const doc = [
    'RULE { ?x :n ?n ; :m ?m } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x ; :age ?a FILTER(?a > 1) SET (?b := ?a + 1) } [ ?n := COUNT(*) ?m := MAX(?b) ] }',
    'RULE { ?x :n ?n } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x } [ ?n := COUNT(DISTINCT ?y) ] }',
    'RULE { :all :n ?n } WHERE { GROUP { ?y :c ?x } [ ?n := SUM(?x) ] }',
    'RULE { } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x } [] }',
  ].join('\n');

  it('generates text that parses back to the same text', () => {
    const once = generateRuleSet(parse(doc));
    expect(generateRuleSet(parseRuleSet(once, opts))).toBe(once);
    expect(once).toContain('GROUP BY ?x {');
    expect(once).toContain('GROUP {');
    expect(once).toContain('[ ?n := COUNT( * ) ?m := MAX( ?b ) ]');
    expect(once).toContain('} []');
  });

  it('formats idempotently, one assignment per line when there are several', () => {
    const formatted = formatRuleSet(parse(doc));
    expect(formatRuleSet(parseRuleSet(formatted, opts))).toBe(formatted);
    expect(formatted).toMatch(/\n {2}GROUP BY \?x \{\n {4}\?y :c \?x/);
    expect(formatted).toContain('\n  } [\n    ?n := COUNT( * )\n    ?m := MAX( ?b )\n  ]');
    expect(formatted).toContain('\n  } [ ?n := COUNT( DISTINCT ?y ) ]');
    expect(formatted).toContain('\n  } []');
  });
});

describe('GROUP — well-formedness', () => {
  it('accepts the worked examples', () => {
    expect(issues(CHILDREN)).toEqual([]);
    // Rank: the keys come from before the GROUP, and the person is matched
    // again after it, since the GROUP keeps only its keys and results.
    expect(issues(
      'RULE { ?p :rank ?r } WHERE { ?q :dept ?d ; :score ?s . '
      + 'GROUP BY ?d ?s { ?o :dept ?d ; :score ?s2 FILTER(?s2 > ?s) } [ ?b := COUNT(*) ] '
      + '?p :dept ?d ; :score ?s . SET (?r := ?b + 1) }',
    )).toEqual([]);
    expect(issues('RULE { :sales :staff ?n } WHERE { GROUP { ?p :worksIn :sales ; :role ?r } [ ?n := COUNT(DISTINCT ?p) ] }'))
      .toEqual([]);
  });

  it('keeps only the keys and the results after the GROUP', () => {
    const found = checkWellFormed(parse(
      'RULE { ?x :name ?name ; :n ?n } WHERE { ?x a :P ; :name ?name . GROUP BY ?x { ?y :c ?x } [ ?n := COUNT(*) ] }',
    ));
    expect(found.map((i) => [i.category, i.message])).toEqual([
      ['unbound-head', 'Head variable ?name is not bound by the rule body'],
    ]);
    expect(issues(
      'RULE { ?x :n ?n } WHERE { ?x a :P ; :name ?name . GROUP BY ?x { ?y :c ?x } [ ?n := COUNT(*) ] FILTER(?name != "") }',
    )).toEqual(['?name is used by a FILTER before it is bound']);
  });

  it('lets a later pattern bind a dropped variable again', () => {
    expect(issues(
      'RULE { ?x :name ?name ; :n ?n } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x } [ ?n := COUNT(*) ] ?x :name ?name }',
    )).toEqual([]);
  });

  it('needs every BY variable bound before the GROUP', () => {
    expect(issues('RULE { ?x :n ?n } WHERE { GROUP BY ?x { ?y :c ?x } [ ?n := COUNT(*) ] }'))
      .toContain('GROUP BY ?x is not bound before the GROUP');
  });

  it('carries a BY variable the pattern does not use through unchanged', () => {
    expect(issues('RULE { ?x :n ?n ; :name ?name } WHERE { ?x a :P ; :name ?name . GROUP BY ?x ?name { ?y :c ?x } [ ?n := COUNT(*) ] }'))
      .toEqual([]);
  });

  it('refuses a pattern variable that is also used outside without being listed', () => {
    const clash = '?y is used in the GROUP pattern and outside it; list it after GROUP BY to correlate it, or rename the one in the pattern';
    expect(issues('RULE { ?x :n ?n } WHERE { ?x a :P ; :knows ?y . GROUP BY ?x { ?y :c ?x } [ ?n := COUNT(*) ] }'))
      .toEqual([clash]);
    expect(issues('RULE { ?x :n ?n } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x } [ ?n := COUNT(*) ] ?x :knows ?y }'))
      .toEqual([clash]);
  });

  it('counts a SET target in the pattern as a pattern variable', () => {
    expect(issues('RULE { ?x :n ?z } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x SET (?z := 1) } [ ?n := COUNT(*) ] }'))
      .toContain('?z is used in the GROUP pattern and outside it; list it after GROUP BY to correlate it, or rename the one in the pattern');
  });

  it('refuses a SET in the pattern that re-binds a variable', () => {
    expect(issues('RULE { ?x :n ?n } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x ; :age ?a SET (?a := 1) } [ ?n := COUNT(*) ] }'))
      .toContain('SET (?a := …) in the GROUP pattern re-binds a variable already bound there');
  });

  it('lets two GROUPs each have a pattern variable of the same name', () => {
    expect(issues(
      'RULE { ?x :pets ?m } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x } [ ?n := COUNT(*) ] '
      + 'GROUP BY ?x { ?y :pet ?x } [ ?m := COUNT(*) ] }',
    )).toEqual([]);
  });

  it('drops a first GROUP\'s results at a second GROUP unless the second lists them', () => {
    const second = (by: string) =>
      `RULE { ?x :kids ?n ; :pets ?m } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x } [ ?n := COUNT(*) ] GROUP BY ${by} { ?y :pet ?x } [ ?m := COUNT(*) ] }`;
    expect(issues(second('?x'))).toEqual(['Head variable ?n is not bound by the rule body']);
    expect(issues(second('?x ?n'))).toEqual([]);
  });

  it('refuses a result that is already bound, or assigned again', () => {
    expect(issues('RULE { ?x :n ?x } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x } [ ?x := COUNT(*) ] }'))
      .toContain('GROUP assigns ?x, which is already bound');
    expect(issues('RULE { ?x :n ?n } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x ; :age ?a } [ ?n := COUNT(*) ?n := MAX(?a) ] }'))
      .toContain('GROUP assigns ?n, which is already bound');
    expect(issues('RULE { ?x :n ?n } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x } [ ?n := COUNT(*) ] SET (?n := 1) }'))
      .toContain('?n is assigned by a GROUP and again later in the body');
  });

  it('refuses an argument the pattern does not bind', () => {
    expect(issues('RULE { ?x :n ?n } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x } [ ?n := SUM(?z) ] }'))
      .toContain('The aggregate over ?z uses a variable the GROUP pattern does not bind');
  });

  it('holds a FILTER in the pattern to the order rule, with only the keys bound from outside', () => {
    expect(issues(
      'RULE { ?x :n ?n } WHERE { ?x a :P ; :min ?lo . GROUP BY ?x { FILTER(?a > ?lo) ?y :c ?x ; :age ?a } [ ?n := COUNT(*) ] }',
    )).toContain('?a is used by a FILTER before it is bound');
  });
});

describe('GROUP — stratification', () => {
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

  it('refuses recursion through a GROUP', () => {
    const report = strat('RULE { ?x :childOf ?n } WHERE { ?x a :Person . GROUP BY ?x { ?y :childOf ?x } [ ?n := COUNT(*) ] }');
    expect(report.issues).not.toEqual([]);
    expect(report.cycles[0]?.kind).toBe('run-once');
    expect(report.cycles[0]?.runOnce?.[0]?.reasons).toContain('aggregate (GROUP)');
  });
});

describe('GROUP — compile', () => {
  it('compiles to an OPTIONAL grouped subquery over renamed pattern variables, collapsed to the keys', () => {
    const { program } = compile(CHILDREN);
    expect(program).toContain('SELECT DISTINCT ?x ?n WHERE {');
    expect(program).toContain('OPTIONAL {');
    expect(program).toContain('SELECT ?x (COUNT(*) AS ?_agg0_count) (COUNT( * ) AS ?_agg0_v0) WHERE {');
    expect(program).toContain('?_agg0_y <http://example/childOf> ?x');
    expect(program).toContain('GROUP BY ?x');
    // An empty group gives 0 for COUNT rather than dropping the key.
    expect(program).toContain('BIND(IF(COALESCE(?_agg0_count, 0) > 0, ?_agg0_v0, 0) AS ?n)');
    expect(program).toContain('FILTER(BOUND(?n))');
  });

  it('drops the row on an empty group for MIN and MAX', () => {
    const { program } = compile('RULE { ?x :oldest ?m } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x ; :age ?a } [ ?m := MAX(?a) ] }');
    expect(program).toContain('FILTER(COALESCE(?_agg0_count, 0) > 0)');
    expect(program).toContain('BIND(?_agg0_v0 AS ?m)');
  });

  it('renames a SET target in the pattern with the other pattern variables', () => {
    const { program } = compile('RULE { ?x :t ?t } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x ; :age ?a SET (?z := ?a + 1) } [ ?t := SUM(?z) ] }');
    expect(program).toContain('AS ?_agg0_z)');
    expect(program).toContain('SUM( ?_agg0_z )');
    expect(program).not.toMatch(/[^_]\?z\b/);
  });

  it('seeds the subquery with the outer rows only when a key appears just in a FILTER', () => {
    expect(compile(CHILDREN).program).not.toContain('SELECT DISTINCT ?x WHERE');
    const { program } = compile(
      'RULE { ?p :rank ?r } WHERE { ?q :dept ?d ; :score ?s . '
      + 'GROUP BY ?d ?s { ?o :dept ?d ; :score ?s2 FILTER(?s2 > ?s) } [ ?b := COUNT(*) ] '
      + '?p :dept ?d ; :score ?s . SET (?r := ?b + 1) }',
    );
    expect(program).toContain('SELECT DISTINCT ?d ?s WHERE {');
  });

  it('projects only the keys for an empty block', () => {
    expect(compile('RULE { ?x :hasChild true } WHERE { ?x a :P . GROUP BY ?x { ?y :c ?x } [] }').program)
      .toContain('SELECT DISTINCT ?x WHERE {');
  });

  it('projects a fresh, unbound variable when there are neither keys nor results', () => {
    expect(compile('RULE { :all :seen true } WHERE { GROUP { ?s ?p ?o } [] }').program)
      .toContain('SELECT DISTINCT ?_agg0_unit WHERE {');
  });

  it('keeps generated names clear of the author\'s', () => {
    const { program } = compile('RULE { ?x :n ?_agg0_y } WHERE { ?x a :P ; :q ?_agg0_y . GROUP BY ?x ?_agg0_y { ?y :c ?x ; :d ?_agg0_y } [ ?n := COUNT(*) ] }');
    expect(program).toContain('?__agg0_y <http://example/c> ?x');
  });

  it('numbers a tuple read in the pattern in order, and reports it', () => {
    const rs = expandIris(parseRuleSet(
      `${PREFIX}\nRULE { ?x :n ?n } WHERE { TUPLE(:p, ?x) GROUP BY ?x { TUPLE(:c, ?y, ?x) } [ ?n := COUNT(*) ] }`,
      { aggregates: true, tuples: true },
    ));
    const compiled = compileRule(rs.rules[0], rs.prologueText);
    expect(compiled.tupleReads.map((r) => r.terms[0])).toEqual(['<http://example/p>', '<http://example/c>']);
    expect(compiled.program).toContain('# TUPLE(<http://example/c>, ?_agg0_y, ?x)');
  });
});
