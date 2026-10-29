import { describe, expect, it } from 'vitest';
import { checkWellFormed, parseRuleSet, wellFormednessErrors } from '../src/index.js';

/*
 * Positions, severities, and the two warnings about a name that is a separate
 * variable: `group-shadowing` and `not-before-binding`. The table of GROUP
 * cases is the one in docs/proposals/srl-diagnostics-with-positions.md.
 */

const PREFIX = 'PREFIX : <http://example/>';

function analyse(body: string, head = '?s :n ?n') {
  const text = `${PREFIX}\nRULE { ${head} } WHERE { ${body} }`;
  const ruleSet = parseRuleSet(text, { aggregates: true, tuples: true, sourceLocations: true });
  return { text, issues: checkWellFormed(ruleSet) };
}

/** The text each issue of a category marks, in document order. */
function marked(body: string, category: string, head?: string): string[] {
  const { text, issues } = analyse(body, head);
  return issues.filter((i) => i.category === category).map((i) => text.slice(i.from, i.to));
}

/** Where in the body text each marked range starts, to tell two `?o` apart. */
function markedAt(body: string, category: string, head?: string): number[] {
  const { text, issues } = analyse(body, head);
  const bodyStart = text.indexOf(body);
  return issues.filter((i) => i.category === category).map((i) => i.from - bodyStart);
}

describe('group-shadowing', () => {
  const cases: Array<[body: string, expected: string[], head?: string]> = [
    ['?s :knows ?o GROUP BY ?s { ?o :p ?v } [ ?n := COUNT(*) ]', ['?o']],
    ['?s :knows ?o GROUP BY ?s ?o { ?o :p ?v } [ ?n := COUNT(*) ]', []],
    // eval-group-09
    ['?x :p ?o GROUP BY ?x { ?x :q ?o } [ ?n := COUNT(*) ]', ['?o'], '?x :n ?n'],
    ['?s :p ?o GROUP BY ?s { ?o :q ?v . ?v :r ?o } [ ?n := COUNT(*) ]', ['?o', '?o']],
    ['?s :p ?o GROUP BY ?s { $o :q ?v } [ ?n := COUNT(*) ]', ['$o']],
    ['?s :p ?o GROUP BY ?s { ?s :q ?v SET(?o := ?v) } [ ?n := COUNT(*) ]', ['?o']],
    ['?s :p ?x SET(?o := ?x) GROUP BY ?s { ?o :q ?s } [ ?n := COUNT(*) ]', ['?o']],
    [
      '?s a :T GROUP BY ?s { ?s :p ?y } [ ?n := COUNT(*) ] GROUP BY ?s { ?s :q ?n } [ ?m := COUNT(*) ]',
      ['?n'],
      '?s :n ?m',
    ],
    ['TUPLE(?s, ?o) GROUP BY ?s { ?o :q ?v } [ ?n := COUNT(*) ]', ['?o']],
    ['?s a :T GROUP BY ?s { ?s :q ?o } [ ?n := COUNT(*) ] ?s :p ?o', []],
    [
      '?p a :T GROUP BY ?p { ?p :child ?y } [ ?a := COUNT(*) ] GROUP BY ?p { ?p :child ?y . ?y a :Adult } [ ?b := COUNT(*) ]',
      [],
      '?p :n ?b',
    ],
    ['?s a :T NOT { ?s :p ?o } FILTER(?s != :x) GROUP BY ?s { ?s :q ?o } [ ?n := COUNT(*) ]', []],
    ['GROUP { ?s :p ?o } [ ?n := COUNT(*) ]', [], ':all :n ?n'],
    ['?s a :T GROUP { ?s :p ?o } [ ?n := COUNT(*) ]', ['?s'], ':all :n ?n'],
  ];

  it.each(cases)('%s', (body, expected, head) => {
    expect(marked(body, 'group-shadowing', head)).toEqual(expected);
  });

  it('marks the variable inside the pattern, not the one before it', () => {
    const body = '?s :knows ?o GROUP BY ?s { ?o :p ?v } [ ?n := COUNT(*) ]';
    expect(markedAt(body, 'group-shadowing')).toEqual([body.indexOf('{ ?o') + 2]);
  });

  it('is a warning, so the rule stays well-formed', () => {
    const { issues } = analyse('?s :knows ?o GROUP BY ?s { ?o :p ?v } [ ?n := COUNT(*) ]');
    expect(issues.map((i) => i.severity)).toEqual(['warning']);
    expect(wellFormednessErrors(issues)).toEqual([]);
    expect(issues[0].message).toBe(
      '?o here is a separate variable from the ?o bound before this GROUP. List it after BY to use the same value.',
    );
  });

  it('warns on a blank node label used before the GROUP and in its pattern', () => {
    const { text, issues } = analyse('_:b :knows ?s GROUP BY ?s { _:b :p ?v } [ ?n := COUNT(*) ]');
    const warning = issues.find((i) => i.category === 'group-shadowing');
    expect(warning && text.slice(warning.from, warning.to)).toBe('_:b');
    expect(warning?.message).toContain('Replace the label by a variable');
  });
});

describe('not-before-binding', () => {
  it('marks a NOT variable that only a later element binds', () => {
    expect(marked('?x :likes ?any NOT { ?x :knows ?y } ?x :likes ?y', 'not-before-binding', '?x :before ?y'))
      .toEqual(['?y']);
  });

  it('is info, so the rule stays well-formed', () => {
    const { issues } = analyse('?x :likes ?any NOT { ?x :knows ?y } ?x :likes ?y', '?x :before ?y');
    expect(issues.map((i) => [i.category, i.severity])).toEqual([['not-before-binding', 'info']]);
  });

  it('says nothing when the NOT comes after the binding', () => {
    expect(marked('?x :likes ?y NOT { ?x :knows ?y }', 'not-before-binding', '?x :before ?y')).toEqual([]);
  });

  it('says nothing about a NOT variable nothing else binds', () => {
    expect(marked('?x a :P NOT { ?x :knows ?y }', 'not-before-binding', '?x a :Loner')).toEqual([]);
  });
});

describe('positions of the existing errors', () => {
  it('marks a SET target that re-binds', () => {
    expect(marked('?s :p ?n SET(?n := 1)', 'set-rebinds')).toEqual(['?n']);
  });

  it('marks the variable a FILTER uses before it is bound', () => {
    expect(marked('FILTER(?n > 1) ?s :p ?n', 'use-before-bind')).toEqual(['?n']);
  });

  it('marks the unbound head variable', () => {
    expect(marked('?s :p ?o', 'unbound-head')).toEqual(['?n']);
  });

  it('falls back to the whole rule when the parse kept no locations', () => {
    const text = `${PREFIX}\nRULE { ?s :n ?n } WHERE { ?s :p ?o }`;
    const [issue] = checkWellFormed(parseRuleSet(text));
    expect(issue.severity).toBe('error');
    expect(text.slice(issue.from, issue.to)).toBe('RULE { ?s :n ?n } WHERE { ?s :p ?o }');
  });

  it('counts offsets in UTF-16 code units', () => {
    const text = `${PREFIX}\nRULE { ?s :n "😀" ; :m ?n } WHERE { ?s :p ?o }`;
    const [issue] = checkWellFormed(parseRuleSet(text, { sourceLocations: true }));
    expect(text.slice(issue.from, issue.to)).toBe('?n');
  });
});

describe('the warnings without source locations', () => {
  it('still reports them, against the whole rule', () => {
    const text = `${PREFIX}\nRULE { ?s :n ?n } WHERE { ?s :knows ?o GROUP BY ?s { ?o :p ?v } [ ?n := COUNT(*) ] }`;
    const issues = checkWellFormed(parseRuleSet(text, { aggregates: true }));
    expect(issues.map((i) => i.category)).toEqual(['group-shadowing']);
    expect(issues[0].from).toBe(text.indexOf('RULE'));
  });
});
