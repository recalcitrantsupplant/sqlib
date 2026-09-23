import { describe, expect, it } from 'vitest';
import { checkWellFormed, compileRule, parseRuleSet } from '../src/index.js';
import { sparqlToRule } from '../src/from-sparql.js';

/**
 * Where a `NOT` sits in a rule body.
 *
 * SRL checks a negation against the bindings made before it; a SPARQL
 * `FILTER NOT EXISTS` sees its whole group. The executor-level cases, with the
 * data that tells the two readings apart, are in `test/w3c-proposed/` and run
 * in `packages/api/test/lib/RuleSetExecutor.negationOrder.test.ts`. These pin
 * the translation in both directions.
 */

const PREFIX = 'PREFIX : <http://example/>';
const compile = (body: string) =>
  compileRule(parseRuleSet(`${PREFIX}\nRULE { ?x :r ?y } WHERE { ${body} }`).rules[0], PREFIX).program;
const squash = (text: string) => text.replace(/\s+/g, ' ');

describe('compileRule — NOT before the patterns that bind its variables', () => {
  it('leaves a NOT after its binders as a plain FILTER NOT EXISTS', () => {
    expect(squash(compile('?x :p ?y NOT { ?x :q ?y }'))).toContain('WHERE { ?x :p ?y . FILTER NOT EXISTS { ?x :q ?y . } }');
  });

  it('closes a group around a NOT that a later pattern binds for', () => {
    expect(squash(compile('NOT { ?x :q ?y } ?x :p ?y')))
      .toContain('WHERE { { FILTER NOT EXISTS { ?x :q ?y . } } ?x :p ?y . }');
  });

  it('keeps earlier patterns inside the group, so the NOT still sees them', () => {
    expect(squash(compile('?x :p ?any NOT { ?x :q ?y } ?z :p ?y')))
      .toContain('{ ?x :p ?any . FILTER NOT EXISTS { ?x :q ?y . } } ?z :p ?y .');
  });

  it('closes the group before a SET that binds the negated variable', () => {
    const program = squash(compileRule(
      parseRuleSet(`${PREFIX}\nRULE { ?s :r "abc" } WHERE { NOT { ?s :q 1 } SET ( ?s := :b ) }`).rules[0],
      PREFIX,
    ).program);
    expect(program).toContain('{ { FILTER NOT EXISTS {');
    expect(program.indexOf('FILTER NOT EXISTS')).toBeLessThan(program.indexOf('BIND'));
  });

  it('does not wrap for a NOT variable that nothing binds', () => {
    // ?z is existential in the NOT and never bound outside it, so the NOT's
    // position is immaterial (W3C wellformed-04 has this shape).
    expect(squash(compile('?x :p ?y NOT { ?x :q ?z } ?x :s ?y'))).not.toContain('{ {');
  });

  it('applies the same rule inside a NOT', () => {
    expect(squash(compile('?x :p ?y NOT { NOT { ?o :banned :yes } ?x :owner ?o }')))
      .toContain('FILTER NOT EXISTS { { FILTER NOT EXISTS { ?o :banned :yes . } } ?x :owner ?o . }');
  });

  it('does not wrap an inner NOT whose variable the enclosing body bound first', () => {
    expect(squash(compile('?x :p ?y ?x :owner ?o NOT { NOT { ?o :banned :yes } ?x :owner ?o }')))
      .toContain('FILTER NOT EXISTS { FILTER NOT EXISTS { ?o :banned :yes . } ?x :owner ?o . }');
  });
});

describe('checkWellFormed — order inside a NOT', () => {
  const issues = (body: string) =>
    checkWellFormed(parseRuleSet(`${PREFIX}\nRULE { ?x :r ?y } WHERE { ${body} }`)).map((i) => i.category);

  it('lets a FILTER in a NOT use a variable bound before the NOT', () => {
    expect(issues('?x :p ?y NOT { ?x :q ?z FILTER ( ?z != ?y ) }')).toEqual([]);
  });

  it('rejects a FILTER in a NOT that uses a variable bound only after it', () => {
    expect(issues('NOT { ?x :q ?z FILTER ( ?z != ?y ) } ?x :p ?y')).toEqual(['use-before-bind']);
  });

  it('rejects a SET in a NOT that uses a variable bound only after it', () => {
    expect(issues('NOT { ?x :q ?z SET ( ?w := ?y ) } ?x :p ?y')).toEqual(['use-before-bind']);
  });
});

describe('sparqlToRule — a FILTER written before its binders', () => {
  const PRE = 'PREFIX : <http://example/>';

  it('moves FILTER NOT EXISTS after the pattern that binds its variables, with a warning', () => {
    const result = sparqlToRule(`${PRE} CONSTRUCT { ?x :r ?y } WHERE { FILTER NOT EXISTS { ?x :q ?y } ?x :p ?y }`,
      { targetPrologue: PRE });
    expect(result.rule).toBe('RULE { ?x :r ?y . } WHERE { ?x :p ?y . NOT { ?x :q ?y . } }');
    expect(result.issues.map((i) => i.code)).toEqual(['filter-moved']);
    expect(result.issues[0].message).toContain('?x, ?y');
  });

  it('moves a plain FILTER instead of rejecting it', () => {
    const result = sparqlToRule(`${PRE} CONSTRUCT { ?s :q ?o } WHERE { FILTER(?o > 2) ?s :p ?o }`, { targetPrologue: PRE });
    expect(result.rule).toMatch(/WHERE \{ \?s :p \?o \. FILTER/);
    expect(result.issues.map((i) => i.code)).toEqual(['filter-moved']);
  });

  it('moves a filter after a BIND it depends on, since SPARQL filters see the BIND', () => {
    const result = sparqlToRule(
      `${PRE} CONSTRUCT { ?s :r ?v } WHERE { ?s :p ?o FILTER NOT EXISTS { ?s :q ?v } BIND(?o AS ?v) FILTER(BOUND(?v)) }`,
      { targetPrologue: PRE },
    );
    expect(result.rule).toMatch(/SET \(\s*\?v := \?o\s*\) NOT \{ \?s :q \?v \. \}/);
  });

  it('leaves a filter that is already after its binders where it is, silently', () => {
    const result = sparqlToRule(`${PRE} CONSTRUCT { ?x :r ?y } WHERE { ?x :p ?y FILTER NOT EXISTS { ?x :q ?y } ?x :s ?z }`,
      { targetPrologue: PRE });
    expect(result.rule).toBe('RULE { ?x :r ?y . } WHERE { ?x :p ?y . NOT { ?x :q ?y . } ?x :s ?z . }');
    expect(result.issues).toEqual([]);
  });

  it('keeps MINUS where it is, since SPARQL evaluates it in place too', () => {
    const result = sparqlToRule(`${PRE} CONSTRUCT { ?x :r ?y } WHERE { ?x :p ?y MINUS { ?x :q ?y } ?x :s ?z }`,
      { targetPrologue: PRE });
    expect(result.rule).toBe('RULE { ?x :r ?y . } WHERE { ?x :p ?y . NOT { ?x :q ?y . } ?x :s ?z . }');
  });

  it('round-trips a misplaced NOT through SPARQL without changing its meaning', () => {
    const rule = parseRuleSet(`${PRE}\nRULE { ?x :r ?y } WHERE { NOT { ?x :q ?y } ?x :p ?y }`).rules[0];
    const back = sparqlToRule(compileRule(rule, PRE, { flavour: 'construct' }).program, { targetPrologue: PRE });
    // The compiled group keeps the NOT ahead of ?x/?y, and the import keeps it there.
    expect(back.rule).toBe('RULE { ?x :r ?y . } WHERE { NOT { ?x :q ?y . } ?x :p ?y . }');
    expect(back.issues).toEqual([]);
  });
});
