import { describe, it, expect } from 'vitest';
import { compileRule, expandIris, generateRule, GROUND_GRAPH_IRI, parseRuleSet, stratify } from '../src/index.js';

/**
 * `WHERE DATA` and `NOT DATA` — the two clauses the grammar has that plain
 * SPARQL does not.
 *
 * Both are how a rule reads the *input* rather than the graph it is growing;
 * the spec's motivating case is setting a default value only where the data did
 * not already have one.
 */

const PREFIX = 'PREFIX : <http://example/>';
const parse = (src: string) => expandIris(parseRuleSet(src, { tuples: false }));

describe('NOT DATA', () => {
  it('negates against the ground graph rather than the evaluation graph', () => {
    const rule = parse(`${PREFIX}\nRULE { ?x :km ?k } WHERE { ?x :mi ?k . NOT DATA { ?x :km ?any } }`).rules[0];
    const body = rule.body.find((item) => item.kind === 'not');
    expect(body).toMatchObject({ data: true });
    expect(compileRule(rule, PREFIX).program).toContain(`GRAPH <${GROUND_GRAPH_IRI}>`);
  });

  it('leaves a plain NOT matching the evaluation graph', () => {
    const rule = parse(`${PREFIX}\nRULE { ?x :km ?k } WHERE { ?x :mi ?k . NOT { ?x :km ?any } }`).rules[0];
    expect(rule.body.find((item) => item.kind === 'not')).toMatchObject({ data: false });
    expect(compileRule(rule, PREFIX).program).not.toContain('GRAPH <');
  });

  it('is not a dependency, so the spec\'s default-value rule stratifies', () => {
    // The rule derives `:km` and asks whether `:km` was in the input. Read as an
    // ordinary negation that is a negative self-dependency — a non-stratifiable
    // cycle. Read against the ground graph, which no rule can add to, it is not
    // a dependency at all. Four W3C eval2 tests turn on this.
    const ruleSet = parse(`${PREFIX}\nRULE { ?x :km ?k } WHERE { ?x :mi ?m . NOT DATA { ?x :km ?any } SET ( ?k := ?m * 2 ) }`);
    const report = stratify(ruleSet.rules.map((ast, i) => ({ id: `r${i}`, ast })));
    expect(report.issues).toEqual([]);
    expect(report.edges).toEqual([]);
  });

  it('still reports a cycle when the negation is an ordinary one', () => {
    const ruleSet = parse(`${PREFIX}\nRULE { ?x :km ?k } WHERE { ?x :mi ?m . NOT { ?x :km ?any } SET ( ?k := ?m * 2 ) }`);
    const report = stratify(ruleSet.rules.map((ast, i) => ({ id: `r${i}`, ast })));
    expect(report.issues.length).toBeGreaterThan(0);
  });
});

describe('WHERE DATA', () => {
  it('sends the whole body to the ground graph', () => {
    const rule = parse(`${PREFIX}\nRULE { :x :msg "seen" } WHERE DATA { :s :p ?o . NOT { :s :q ?o } }`).rules[0];
    expect(rule.data).toBe(true);
    const program = compileRule(rule, PREFIX).program;
    // One GRAPH block around everything — the spec evaluates such a rule with
    // GD in place of G throughout, nested NOT included.
    expect(program).toContain(`GRAPH <${GROUND_GRAPH_IRI}>`);
    expect(program.match(/GRAPH </g)).toHaveLength(1);
  });

  it('reads nothing any rule produces, so it depends on no rule', () => {
    const ruleSet = parse(`${PREFIX}\nRULE { :s :p :o } WHERE { }\nRULE { :x :msg "m" } WHERE DATA { :s :p ?o }`);
    const report = stratify(ruleSet.rules.map((ast, i) => ({ id: `r${i}`, ast })));
    expect(report.edges).toEqual([]);
  });

  it('round-trips through the generator', () => {
    const rule = parse(`${PREFIX}\nRULE { :x :msg "m" } WHERE DATA { :s :p ?o . NOT DATA { :s :q ?o } }`).rules[0];
    const text = generateRule(rule);
    expect(text).toContain('WHERE DATA');
    expect(text).toContain('NOT DATA');
    // And what it generates parses back to the same flags.
    const reparsed = parse(`${PREFIX}\n${text}`).rules[0];
    expect(reparsed.data).toBe(true);
    expect(reparsed.body.find((item) => item.kind === 'not')).toMatchObject({ data: true });
  });
});

describe('removed syntax', () => {
  /*
   * `FOR ?v IN <shape>` (SHACL targeting) and the `IF … THEN` rule form were
   * both taken out of the grammar upstream — the changelog entry of 2026-08-12
   * for FOR, and w3c/data-shapes#1191 for the leftovers of both. Neither is a
   * rule any more, so both must be syntax errors rather than something we
   * parse and refuse later: accepting them would let a document through that no
   * conforming processor reads.
   */
  it('rejects a FOR clause', () => {
    expect(() => parse(`${PREFIX}\nRULE { :x :p :y } FOR ?this IN :Shape WHERE { }`)).toThrow();
  });

  it('rejects the IF … THEN form', () => {
    expect(() => parse(`${PREFIX}\nIF { :s :p ?o } THEN { :x :q ?o }`)).toThrow();
  });

  it('still parses the RULE form the FOR clause used to decorate', () => {
    const rule = parse(`${PREFIX}\nRULE :r { :x :p :y } WHERE { }`).rules[0];
    expect(rule.name).toBe('http://example/r');
    expect(generateRule(rule)).toBe(
      'RULE <http://example/r> { <http://example/x> <http://example/p> <http://example/y> . } WHERE {  }',
    );
  });
});

describe('SET error handling', () => {
  it('scopes the BOUND test so a later pattern cannot revive the solution', () => {
    // `SET(?x := 1/0)` must drop the solution. A bare `BIND … FILTER(BOUND(?x))`
    // does not: a SPARQL FILTER applies to its whole group, so the later
    // `:s ?p ?x` binds ?x and the filter passes. W3C `eval-assign-03`.
    const rule = parse(`${PREFIX}\nRULE { :Z ?p :z } WHERE { SET ( ?x := 1/0 ) :s ?p ?x }`).rules[0];
    const program = compileRule(rule, PREFIX).program;
    const boundIndex = program.indexOf('FILTER(BOUND(?x))');
    // Body IRIs are expanded; only the verbatim head keeps its prefix.
    const patternIndex = program.indexOf('<http://example/s>');
    expect(boundIndex).toBeGreaterThan(-1);
    expect(patternIndex).toBeGreaterThan(-1);
    // The group closes between the two, so the pattern cannot satisfy the test.
    const closeIndex = program.indexOf('}', boundIndex);
    expect(closeIndex).toBeGreaterThan(boundIndex);
    expect(closeIndex).toBeLessThan(patternIndex);
  });
});
