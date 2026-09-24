import { describe, expect, it } from 'vitest';
import { sparqlToRule, isSrlImportable } from '../src/from-sparql.js';
import { compileRule } from '../src/compile.js';
import { parseRuleSet } from '../src/parse.js';

const PREFIX = 'PREFIX : <http://example/>';

/** The rule text an import produces, asserting it produced one at all. */
function ruleOf(query: string, targetPrologue = PREFIX): string {
  const result = sparqlToRule(query, { targetPrologue });
  expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  expect(result.rule).not.toBeNull();
  return result.rule!;
}

/** The error codes an import rejected with. */
function errorsOf(query: string): string[] {
  const result = sparqlToRule(query, { targetPrologue: PREFIX });
  expect(result.rule).toBeNull();
  return result.issues.filter((i) => i.severity === 'error').map((i) => i.code);
}

describe('sparqlToRule (CONSTRUCT) — the supported subset', () => {
  it('maps a plain template and BGP', () => {
    expect(ruleOf(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }`))
      .toBe('RULE { ?s :q ?o . } WHERE { ?s :p ?o . }');
  });

  it('keeps a FILTER', () => {
    expect(ruleOf(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o FILTER(?o > 2) }`))
      .toContain('FILTER ( ( ?o > "2"^^<http://www.w3.org/2001/XMLSchema#integer> ) )');
  });

  it('maps FILTER NOT EXISTS to NOT', () => {
    const rule = ruleOf(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o FILTER NOT EXISTS { ?s :dead ?z } }`);
    expect(rule).toContain('NOT { ?s :dead ?z . }');
  });

  it('flattens a conjunctive group', () => {
    // The brace is gone and the two items sit side by side in one sequence.
    expect(ruleOf(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { { ?s :p ?o } FILTER(?o > 2) }`))
      .toBe(ruleOf(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o FILTER(?o > 2) }`));
  });

  it('carries property paths through untouched', () => {
    expect(ruleOf(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p/:r ?o }`)).toContain(':p/:r');
  });

  it('names the rule when asked', () => {
    const result = sparqlToRule(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }`, {
      targetPrologue: PREFIX,
      name: 'http://example/r1',
    });
    // Abbreviated against the target prologue, like every other IRI.
    expect(result.rule).toContain('RULE :r1');
  });
});

describe('sparqlToRule (CONSTRUCT) — BIND and SET', () => {
  it('folds BIND + FILTER(BOUND(?v)) into SET with no warning', () => {
    const result = sparqlToRule(
      `${PREFIX} CONSTRUCT { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) FILTER(BOUND(?x)) }`,
      { targetPrologue: PREFIX },
    );
    expect(result.rule).toContain('SET ( ?x := ( ?o + "1"^^<http://www.w3.org/2001/XMLSchema#integer> ) )');
    expect(result.issues).toEqual([]);
  });

  it('warns when a bare BIND becomes a SET', () => {
    const result = sparqlToRule(
      `${PREFIX} CONSTRUCT { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) }`,
      { targetPrologue: PREFIX },
    );
    expect(result.rule).toContain('SET ( ?x := ( ?o + "1"^^<http://www.w3.org/2001/XMLSchema#integer> ) )');
    const warning = result.issues.find((i) => i.code === 'bare-bind');
    expect(warning?.severity).toBe('warning');
    // The two consequences the user has to know about, not one.
    expect(warning?.message).toContain('BOUND');
    expect(warning?.message).toContain('once rather than to a fixpoint');
  });

  it('reports a SET-carrying rule as run-once', () => {
    const result = sparqlToRule(
      `${PREFIX} CONSTRUCT { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) }`,
      { targetPrologue: PREFIX },
    );
    expect(result.runOnce).toBe(true);
  });

  it('reports a blank-node template as run-once', () => {
    const result = sparqlToRule(`${PREFIX} CONSTRUCT { ?s :q _:b } WHERE { ?s :p ?o }`, {
      targetPrologue: PREFIX,
    });
    expect(result.runOnce).toBe(true);
    expect(result.rule).not.toBeNull();
  });

  it('does not call a plain rule run-once', () => {
    expect(sparqlToRule(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }`).runOnce).toBe(false);
  });
});

describe('sparqlToRule (CONSTRUCT) — MINUS', () => {
  it('rewrites a MINUS sharing variables, with a warning', () => {
    const result = sparqlToRule(
      `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o MINUS { ?s :gone ?o } }`,
      { targetPrologue: PREFIX },
    );
    expect(result.rule).toContain('NOT { ?s :gone ?o . }');
    expect(result.issues.map((i) => i.code)).toEqual(['minus-as-not']);
  });

  it('rejects a MINUS over disjoint variables', () => {
    expect(errorsOf(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o MINUS { ?a :gone ?b } }`))
      .toEqual(['disjoint-minus']);
  });
});

describe('sparqlToRule (CONSTRUCT) — rejections', () => {
  it.each([
    ['OPTIONAL', `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o OPTIONAL { ?s :m ?n } }`],
    ['UNION', `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { { ?s :p ?o } UNION { ?s :r ?o } }`],
    ['VALUES', `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o VALUES ?v { 1 2 } }`],
    ['GRAPH', `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { GRAPH ?g { ?s :p ?o } }`],
    ['SERVICE', `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { SERVICE <http://x/> { ?s :p ?o } }`],
    ['sub-SELECT', `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { { SELECT ?s ?o WHERE { ?s :p ?o } } }`],
  ])('rejects %s', (_name, query) => {
    expect(errorsOf(query)).toEqual(['unsupported-pattern']);
  });

  it('rejects a SELECT with a message naming what it got', () => {
    const result = sparqlToRule(`${PREFIX} SELECT * WHERE { ?s :p ?o }`);
    expect(result.rule).toBeNull();
    expect(result.issues[0].code).toBe('not-importable');
    expect(result.issues[0].message).toContain('SELECT');
  });

  it('rejects unparseable text', () => {
    expect(errorsOf('this is not sparql')).toEqual(['syntax']);
  });

  it('rejects FROM, LIMIT and ORDER BY', () => {
    const codes = errorsOf(
      `${PREFIX} CONSTRUCT { ?s :q ?o } FROM <http://g/> WHERE { ?s :p ?o } ORDER BY ?o LIMIT 5`,
    );
    expect(codes).toContain('dataset-clause');
    expect(codes).toContain('solution-modifier');
  });

  it('reports every offending construct at once rather than the first', () => {
    const result = sparqlToRule(
      `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE {
        ?s :p ?o
        OPTIONAL { ?s :m ?n }
        VALUES ?v { 1 }
        GRAPH ?g { ?s :x ?y }
      }`,
    );
    const named = result.issues.map((i) => i.construct);
    expect(named).toEqual(expect.arrayContaining(['OPTIONAL', 'VALUES', 'GRAPH']));
  });

  it('rejects an empty template', () => {
    expect(errorsOf(`${PREFIX} CONSTRUCT { } WHERE { ?s :p ?o }`)).toEqual(['empty-template']);
  });
});

describe('sparqlToRule (CONSTRUCT) — well-formedness', () => {
  it('rejects a head variable the body never binds', () => {
    expect(errorsOf(`${PREFIX} CONSTRUCT { ?s :q ?missing } WHERE { ?s :p ?o }`))
      .toEqual(['well-formedness']);
  });

  it('explains that SRL evaluates a body in order', () => {
    // The filter is scoped to the inner group, which never binds ?o, so moving
    // it cannot help: it is rejected.
    const result = sparqlToRule(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { { ?s :x ?y FILTER(?o > 2) } ?s :p ?o }`);
    const issue = result.issues.find((i) => i.code === 'well-formedness');
    expect(issue?.message).toContain('in order');
  });
});

describe('sparqlToRule (CONSTRUCT) — prefixes', () => {
  it('re-abbreviates against the target, so the target wins a conflict', () => {
    // The query calls `http://query/` `x:`; the target already uses `x:` for
    // something else and calls `http://query/` `q:`. The rule must come out
    // spelled the target's way.
    const rule = ruleOf(
      'PREFIX x: <http://query/> CONSTRUCT { ?s x:q ?o } WHERE { ?s x:p ?o }',
      'PREFIX x: <http://other/>\nPREFIX q: <http://query/>',
    );
    expect(rule).toContain('q:q');
    expect(rule).not.toContain('x:q');
  });

  it('flags the conflicting label without resolving it itself', () => {
    const result = sparqlToRule('PREFIX x: <http://query/> CONSTRUCT { ?s x:q ?o } WHERE { ?s x:p ?o }', {
      targetPrologue: 'PREFIX x: <http://other/>',
    });
    expect(result.prefixes).toEqual([{ prefix: 'x', namespace: 'http://query/', conflicts: true }]);
  });

  it('does not flag a label the target binds identically', () => {
    const result = sparqlToRule(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }`, {
      targetPrologue: PREFIX,
    });
    expect(result.prefixes).toEqual([{ prefix: '', namespace: 'http://example/', conflicts: false }]);
  });

  it('leaves an IRI the target cannot abbreviate in full form', () => {
    const rule = ruleOf('PREFIX x: <http://query/> CONSTRUCT { ?s x:q ?o } WHERE { ?s x:p ?o }', '');
    expect(rule).toContain('<http://query/q>');
  });
});

describe('sparqlToRule (CONSTRUCT) — round trip against compileRule', () => {
  /*
   * The two directions are each other's inverse over the supported subset, so
   * compiling an imported rule back to CONSTRUCT and importing that again must
   * reach a fixed point. Anything the mapping gets structurally wrong shows up
   * here without a hand-written expectation.
   */
  const cases = [
    `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }`,
    `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o FILTER(?o > 2) }`,
    `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o FILTER NOT EXISTS { ?s :dead ?z } }`,
    `${PREFIX} CONSTRUCT { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) FILTER(BOUND(?x)) }`,
    `${PREFIX} CONSTRUCT { ?s :q ?o . ?o :back ?s } WHERE { ?s :p ?o . ?o :r ?s }`,
  ];

  it.each(cases)('reaches a fixed point: %s', (query) => {
    const first = ruleOf(query);
    const compiled = compileRule(parseRuleSet(`${PREFIX}\n${first}`).rules[0], PREFIX, {
      flavour: 'construct',
    });
    const second = ruleOf(compiled.program);
    expect(second).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// INSERT … WHERE
// ---------------------------------------------------------------------------

/*
 * The WHERE clause is the same grammar production for both input forms and goes
 * through the same `mapPatterns`, so the whitelist is not re-tested here — the
 * CONSTRUCT cases above cover it. What is tested is the head: which update
 * forms are readable at all, and the clauses only an update can carry.
 */

describe('sparqlToRule (INSERT) — the supported subset', () => {
  it('reads a rule out of an INSERT … WHERE', () => {
    expect(ruleOf(`${PREFIX} INSERT { ?s :q ?o } WHERE { ?s :p ?o }`))
      .toBe('RULE { ?s :q ?o . } WHERE { ?s :p ?o . }');
  });

  it('produces the same rule as the equivalent CONSTRUCT', () => {
    expect(ruleOf(`${PREFIX} INSERT { ?s :q ?o } WHERE { ?s :p ?o FILTER NOT EXISTS { ?s :dead ?z } }`))
      .toBe(ruleOf(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o FILTER NOT EXISTS { ?s :dead ?z } }`));
  });

  it('reports which form it read', () => {
    expect(sparqlToRule(`${PREFIX} INSERT { ?s :q ?o } WHERE { ?s :p ?o }`).form).toBe('insert');
    expect(sparqlToRule(`${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }`).form).toBe('construct');
    expect(sparqlToRule(`${PREFIX} SELECT * WHERE { ?s :p ?o }`).form).toBeNull();
  });

  it('resolves prefixes declared before the operation', () => {
    const result = sparqlToRule(`${PREFIX} INSERT { ?s :q ?o } WHERE { ?s :p ?o }`, { targetPrologue: '' });
    // The prologue of an update sits on the operation rather than the document,
    // so a rule that comes out with full IRIs means it was read from the wrong
    // place.
    expect(result.prefixes).toEqual([{ prefix: '', namespace: 'http://example/', conflicts: false }]);
    expect(result.rule).toContain('<http://example/q>');
  });

  it('carries a multi-triple template across', () => {
    expect(ruleOf(`${PREFIX} INSERT { ?s :q ?o . ?o :back ?s } WHERE { ?s :p ?o . ?o :r ?s }`))
      .toBe(ruleOf(`${PREFIX} CONSTRUCT { ?s :q ?o . ?o :back ?s } WHERE { ?s :p ?o . ?o :r ?s }`));
  });

  it('applies the body whitelist to an INSERT too', () => {
    expect(errorsOf(`${PREFIX} INSERT { ?s :q ?o } WHERE { ?s :p ?o OPTIONAL { ?s :m ?n } }`))
      .toEqual(['unsupported-pattern']);
  });
});

describe('sparqlToRule (INSERT) — rejections', () => {
  it('rejects a DELETE/INSERT, because a rule cannot retract', () => {
    const codes = errorsOf(`${PREFIX} DELETE { ?s :p ?o } INSERT { ?s :q ?o } WHERE { ?s :p ?o }`);
    expect(codes).toContain('delete-clause');
  });

  it('rejects WITH', () => {
    expect(errorsOf(`${PREFIX} WITH <http://g/> INSERT { ?s :q ?o } WHERE { ?s :p ?o }`))
      .toContain('named-graph-target');
  });

  it('rejects USING', () => {
    expect(errorsOf(`${PREFIX} INSERT { ?s :q ?o } USING <http://g/> WHERE { ?s :p ?o }`))
      .toContain('dataset-clause');
  });

  it('rejects a GRAPH block in the template', () => {
    expect(errorsOf(`${PREFIX} INSERT { GRAPH <http://g/> { ?s :q ?o } } WHERE { ?s :p ?o }`))
      .toContain('named-graph-target');
  });

  it('rejects a sequence of operations rather than importing the first', () => {
    const result = sparqlToRule(
      `${PREFIX} INSERT { ?s :q ?o } WHERE { ?s :p ?o }; INSERT { ?s :r ?o } WHERE { ?s :p ?o }`,
    );
    expect(result.rule).toBeNull();
    expect(result.issues.map((i) => i.code)).toEqual(['multiple-operations']);
  });

  it.each([
    ['INSERT DATA', `${PREFIX} INSERT DATA { <http://a/> :q 1 }`],
    ['DELETE DATA', `${PREFIX} DELETE DATA { <http://a/> :q 1 }`],
    ['DELETE WHERE', `${PREFIX} DELETE WHERE { ?s :p ?o }`],
    ['LOAD', 'LOAD <http://g/>'],
    ['DROP', 'DROP GRAPH <http://g/>'],
  ])('rejects %s by name', (name, query) => {
    const result = sparqlToRule(query);
    expect(result.rule).toBeNull();
    expect(result.issues[0].code).toBe('not-importable');
    expect(result.issues[0].message).toContain(name);
  });

  it('points an INSERT DATA at a DATA block', () => {
    const result = sparqlToRule(`${PREFIX} INSERT DATA { <http://a/> :q 1 }`);
    expect(result.issues[0].message).toContain('DATA { … } block');
  });

  it('rejects an empty template', () => {
    expect(errorsOf(`${PREFIX} INSERT { } WHERE { ?s :p ?o }`)).toEqual(['empty-template']);
  });
});

describe('sparqlToRule (INSERT) — round trip against compileRule', () => {
  /*
   * The insert flavour is what the executor actually runs, so this closes the
   * loop the CONSTRUCT round trip leaves open: a rule compiled the way it is
   * evaluated has to import back to itself.
   */
  const cases = [
    `${PREFIX} INSERT { ?s :q ?o } WHERE { ?s :p ?o }`,
    `${PREFIX} INSERT { ?s :q ?o } WHERE { ?s :p ?o FILTER(?o > 2) }`,
    `${PREFIX} INSERT { ?s :q ?o } WHERE { ?s :p ?o FILTER NOT EXISTS { ?s :dead ?z } }`,
    `${PREFIX} INSERT { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) FILTER(BOUND(?x)) }`,
  ];

  it.each(cases)('reaches a fixed point: %s', (query) => {
    const first = ruleOf(query);
    const compiled = compileRule(parseRuleSet(`${PREFIX}\n${first}`).rules[0], PREFIX, { flavour: 'insert' });
    expect(ruleOf(compiled.program)).toBe(first);
  });
});

describe('isSrlImportable', () => {
  it.each([
    [true, `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }`],
    [true, `${PREFIX} INSERT { ?s :q ?o } WHERE { ?s :p ?o }`],
    // Converts with a warning, which is still a conversion.
    [true, `${PREFIX} CONSTRUCT { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) }`],
    [false, `${PREFIX} SELECT * WHERE { ?s :p ?o }`],
    [false, `${PREFIX} ASK { ?s :p ?o }`],
    [false, `${PREFIX} CONSTRUCT { ?s :q ?o } WHERE { { ?s :p ?o } UNION { ?s :r ?o } }`],
    [false, `${PREFIX} DELETE WHERE { ?s :p ?o }`],
    [false, 'this is not sparql'],
  ])('is %s for %s', (expected, query) => {
    expect(isSrlImportable(query)).toBe(expected);
  });
});
