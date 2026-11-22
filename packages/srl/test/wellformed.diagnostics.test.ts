import { describe, expect, it } from 'vitest';
import { checkWellFormed, parseRuleSet } from '../src/index.js';

/*
 * Positions and severities of the diagnostics about a name that is reused:
 * the `in-use` error (the spec's inUse condition, w3c/data-shapes#690 and
 * #1455) and the `group-shadowing` warning for a blank node label. The table
 * of GROUP cases is the one in docs/proposals/srl-diagnostics-with-positions.md;
 * every variable that table marked is an `in-use` error since #690.
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

describe('in-use', () => {
  const cases: Array<[body: string, expected: string[], head?: string]> = [
    ['?s :knows ?o GROUP BY ?s { ?o :p ?v } [ ?n := COUNT(*) ]', ['?o']],
    ['?s :knows ?o GROUP BY ?s ?o { ?o :p ?v } [ ?n := COUNT(*) ]', []],
    // The old eval-group-09, before w3c/data-shapes#1455 renamed ?o.
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
    ['?s a :T GROUP BY ?s { ?s :q ?o } [ ?n := COUNT(*) ] ?s :p ?o', ['?o']],
    [
      '?p a :T GROUP BY ?p { ?p :child ?y } [ ?a := COUNT(*) ] GROUP BY ?p { ?p :child ?y . ?y a :Adult } [ ?b := COUNT(*) ]',
      ['?y', '?y'],
      '?p :n ?b',
    ],
    ['?s a :T NOT { ?s :p ?o } FILTER(?s != :x) GROUP BY ?s { ?s :q ?o } [ ?n := COUNT(*) ]', ['?o']],
    ['GROUP { ?s :p ?o } [ ?n := COUNT(*) ]', [], ':all :n ?n'],
    ['?s a :T GROUP { ?s :p ?o } [ ?n := COUNT(*) ]', ['?s'], ':all :n ?n'],
    ['?x :likes ?any NOT { ?x :knows ?y } ?x :likes ?y', ['?y'], '?x :before ?y'],
    ['?x :likes ?y NOT { ?x :knows ?y }', [], '?x :before ?y'],
    ['?x a :P NOT { ?x :knows ?y }', [], '?x a :Loner'],
  ];

  it.each(cases)('%s', (body, expected, head) => {
    expect(marked(body, 'in-use', head)).toEqual(expected);
  });

  it('marks the variable inside the pattern, not the one before it', () => {
    const body = '?s :knows ?o GROUP BY ?s { ?o :p ?v } [ ?n := COUNT(*) ]';
    expect(markedAt(body, 'in-use')).toEqual([body.indexOf('{ ?o') + 2]);
  });

  it('is an error', () => {
    const { issues } = analyse('?s :knows ?o GROUP BY ?s { ?o :p ?v } [ ?n := COUNT(*) ]');
    expect(issues.map((i) => i.severity)).toEqual(['error']);
    expect(issues[0].message).toBe(
      '?o is bound before this GROUP and is not a key. List it after BY to use the same value, or rename it here.',
    );
  });

  it('names the NOT that the variable is local to', () => {
    const { issues } = analyse('?x :likes ?any NOT { ?x :knows ?y } ?x :likes ?y', '?x :before ?y');
    expect(issues.map((i) => i.message)).toEqual(['?y is local to a NOT earlier in the rule. Rename one of the two.']);
  });
});

describe('group-shadowing', () => {
  it('warns on a blank node label used before the GROUP and in its pattern', () => {
    const { text, issues } = analyse('_:b :knows ?s GROUP BY ?s { _:b :p ?v } [ ?n := COUNT(*) ]');
    expect(issues.map((i) => [i.category, i.severity])).toEqual([['group-shadowing', 'warning']]);
    expect(text.slice(issues[0].from, issues[0].to)).toBe('_:b');
    expect(issues[0].message).toContain('Replace the label by a variable');
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

describe('the reuse diagnostics without source locations', () => {
  it('still reports them, against the whole rule', () => {
    const text = `${PREFIX}\nRULE { ?s :n ?n } WHERE { ?s :knows ?o GROUP BY ?s { ?o :p ?v } [ ?n := COUNT(*) ] }`;
    const issues = checkWellFormed(parseRuleSet(text, { aggregates: true }));
    expect(issues.map((i) => i.category)).toEqual(['in-use']);
    expect(issues[0].from).toBe(text.indexOf('RULE'));
  });
});
