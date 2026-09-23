import { describe, expect, it } from 'vitest';
import { compileRule, parseRuleSet } from '../src/index.js';

const PREFIX = 'PREFIX : <http://example/>';

describe('SRL base grammar — parse + compile', () => {
  it('parses a single-rule document (W3C eval-basic-01)', () => {
    const rs = parseRuleSet(`${PREFIX}\n\nRULE { :x :q ?o } WHERE { :s :p ?o }`);
    expect(rs.rules).toHaveLength(1);
    expect(rs.rules[0].headText).toBe(':x :q ?o');
    expect(rs.rules[0].bodyText).toBe(':s :p ?o');
  });

  it('compiles a rule to a valid INSERT…WHERE', () => {
    const rs = parseRuleSet(`${PREFIX}\nRULE { :x :q ?o } WHERE { :s :p ?o }`);
    const { program } = compileRule(rs.rules[0], rs.prologueText);
    expect(program).toContain('INSERT');
    expect(program).toContain(':q');
    expect(program).toMatch(/INSERT\s*\{[\s\S]*\}\s*WHERE\s*\{[\s\S]*\}/);
  });

  it('spans each block from its keyword to its closing brace', () => {
    const text = `${PREFIX}\n\nDATA {\n  :a :p :b .\n}\n\nRULE {\n  ?s :q ?o\n}\nWHERE {\n  ?s :p ?o\n}`;
    const rs = parseRuleSet(text);
    const data = text.slice(...rs.dataBlocks[0].span);
    const rule = text.slice(...rs.rules[0].span);
    expect(data.startsWith('DATA')).toBe(true);
    expect(data.endsWith('}')).toBe(true);
    expect(rule.startsWith('RULE')).toBe(true);
    expect(rule.endsWith('}')).toBe(true);
  });

  it('parses a multi-rule ruleset', () => {
    const rs = parseRuleSet(`${PREFIX}\nRULE { ?s :p "ABC" } WHERE { ?s :data ?d }\nRULE { ?s :q ?o } WHERE { ?s :p ?o }`);
    expect(rs.rules).toHaveLength(2);
    expect(rs.rules[1].headText).toBe('?s :q ?o');
  });

  it('parses an empty rule (W3C stratification-01)', () => {
    const rs = parseRuleSet(`${PREFIX}\nRULE {} WHERE {}`);
    expect(rs.rules).toHaveLength(1);
    expect(rs.rules[0].headText).toBe('');
    expect(rs.rules[0].body).toEqual([]);
  });

  it('rejects the removed IF … THEN form (w3c/data-shapes#1191)', () => {
    expect(() => parseRuleSet(`${PREFIX}\nIF { :s :p ?o } THEN { :x :q ?o }`)).toThrow();
  });

  /*
   * SRL has no EXISTS and no NOT EXISTS: its own `[118] BuiltInCall` lists
   * every function a constraint may call and omits `ExistsFunc` and
   * `NotExistsFunc`, and negation is `[21] Negation` — `NOT { … }`, whose
   * inner body is triple patterns and filters rather than a nested pattern.
   *
   * They parsed here because the body rule reuses SPARQL's `filter` and
   * `expression` for the leaves the two languages share, and SPARQL's
   * `BuiltInCall` does end with those two. So `FILTER NOT EXISTS { … }` read
   * as an ordinary SRL filter whose expression happened to be a pattern
   * operation, compiled to SPARQL, and ran — while the editor's own grammar
   * underlined it as invalid.
   */
  describe('EXISTS and NOT EXISTS are not SRL', () => {
    const body = (text: string) => `${PREFIX}\nRULE { :x :q ?o } WHERE { :s :p ?o ${text} }`;

    it('rejects FILTER NOT EXISTS, naming the SRL spelling', () => {
      expect(() => parseRuleSet(body('FILTER NOT EXISTS { :s :dead ?z }')))
        .toThrow(/NOT EXISTS is not part of SRL — write the negation as NOT/);
    });

    it('rejects FILTER EXISTS, which a conjunction already says', () => {
      expect(() => parseRuleSet(body('FILTER EXISTS { :s :alive ?z }')))
        .toThrow(/EXISTS is not part of SRL — match the pattern in the body/);
    });

    // The leak is not only the top of a constraint.
    it('rejects one buried in an operand', () => {
      expect(() => parseRuleSet(body('FILTER ( ?o > 1 && NOT EXISTS { :s :dead ?z } )')))
        .toThrow(/NOT EXISTS is not part of SRL/);
    });

    it('rejects one inside a NOT body', () => {
      expect(() => parseRuleSet(body('NOT { :s :y ?z FILTER NOT EXISTS { :s :dead ?w } }')))
        .toThrow(/NOT EXISTS is not part of SRL/);
    });

    it('rejects one in a SET expression, which takes the same expressions', () => {
      expect(() => parseRuleSet(`${PREFIX}\nRULE { :x :q ?v } WHERE { :s :p ?o SET ( ?v := NOT EXISTS { :s :dead ?z } ) }`))
        .toThrow(/NOT EXISTS is not part of SRL/);
    });

    it('leaves NOT { … } and ordinary filters alone', () => {
      expect(() => parseRuleSet(body('NOT { :s :dead ?z }'))).not.toThrow();
      expect(() => parseRuleSet(body('FILTER ( ?o > 1 )'))).not.toThrow();
      expect(() => parseRuleSet(body('FILTER ( REGEX(STR(?o), "a") )'))).not.toThrow();
    });
  });

  it('compiles FILTER in the body (W3C eval-filter shape)', () => {
    const rs = parseRuleSet(`${PREFIX}\nRULE { ?x :bothPositive true } WHERE { ?x :p ?v1 FILTER ( ?v1 > 0 ) }`);
    const item = rs.rules[0].body.map((b) => b.kind);
    expect(item).toContain('filter');
    const { program } = compileRule(rs.rules[0], rs.prologueText);
    expect(program).toMatch(/FILTER\s*\(/);
  });

  it('compiles NOT to FILTER NOT EXISTS (negation)', () => {
    const rs = parseRuleSet(`${PREFIX}\nRULE { ?x :unclassified true } WHERE { ?x :p ?y . NOT { ?x :pop ?z } }`);
    const kinds = rs.rules[0].body.map((b) => b.kind);
    expect(kinds).toContain('not');
    const { program } = compileRule(rs.rules[0], rs.prologueText);
    expect(program).toMatch(/FILTER\s+NOT\s+EXISTS\s*\{/i);
  });

  it('compiles SET to BIND', () => {
    const rs = parseRuleSet(`${PREFIX}\nRULE { ?x :age ?a } WHERE { ?x :p ?v SET ( ?a := ?v + 1 ) }`);
    const kinds = rs.rules[0].body.map((b) => b.kind);
    expect(kinds).toContain('set');
    const { program } = compileRule(rs.rules[0], rs.prologueText);
    expect(program).toMatch(/BIND\s*\([\s\S]*AS\s+\?a\)/i);
  });
});

/*
 * Issue #158. The CONSTRUCT flavour is the non-destructive reading of a rule:
 * same head, same body, one pass, returning the triples instead of writing
 * them. Generated from the AST rather than by rewriting the INSERT string —
 * the cases a reader most needs to be right (SET, blank-node heads, tuple
 * heads) are exactly the ones a token swap gets wrong.
 */
describe('CONSTRUCT flavour', () => {
  const construct = (doc: string, opts = {}) => {
    const rs = parseRuleSet(doc, opts);
    return compileRule(rs.rules[0], rs.prologueText, { flavour: 'construct' });
  };

  it('emits CONSTRUCT … WHERE from the same head and body', () => {
    const { program } = construct(`${PREFIX}\nRULE { :x :q ?o } WHERE { :s :p ?o }`);
    expect(program).toMatch(/CONSTRUCT\s*\{[\s\S]*:q[\s\S]*\}\s*WHERE\s*\{[\s\S]*:p[\s\S]*\}/);
    expect(program).not.toContain('INSERT');
  });

  it('keeps the prologue, so the prefixes a reader wrote still resolve', () => {
    expect(construct(`${PREFIX}\nRULE { :x :q ?o } WHERE { :s :p ?o }`).program.startsWith(PREFIX)).toBe(true);
  });

  it('defaults to INSERT, so existing callers are unaffected', () => {
    const rs = parseRuleSet(`${PREFIX}\nRULE { :x :q ?o } WHERE { :s :p ?o }`);
    expect(compileRule(rs.rules[0], rs.prologueText).program).toContain('INSERT');
    expect(compileRule(rs.rules[0], rs.prologueText, {}).program).toContain('INSERT');
  });

  it('carries the body translations through unchanged — only the head form differs', () => {
    const doc = `${PREFIX}\nRULE { ?x :age ?a } WHERE { ?x :p ?v SET ( ?a := ?v + 1 ) NOT { ?x :skip true } }`;
    const rs = parseRuleSet(doc);
    const insert = compileRule(rs.rules[0], rs.prologueText).program;
    const constructed = compileRule(rs.rules[0], rs.prologueText, { flavour: 'construct' }).program;
    expect(constructed.replace(/^(\s*)CONSTRUCT/m, '$1INSERT')).toBe(insert);
    expect(constructed).toMatch(/FILTER\(BOUND\(\?a\)\)/);
  });

  it('ignores the flavour for a tuple-producing rule: a SELECT has no CONSTRUCT form', () => {
    const doc = `${PREFIX}\nRULE { TUPLE(:reach, ?x, ?y) } WHERE { ?x :link ?y }`;
    const compiled = construct(doc, { tuples: true });
    expect(compiled.producesTuples).toBe(true);
    expect(compiled.program).toContain('SELECT DISTINCT');
    expect(compiled.program).not.toContain('CONSTRUCT');
  });

  it('still refuses a FOR clause — the flavour is a rendering, not a relaxation', () => {
    // FOR was removed from the grammar, so this is now a parse error rather
    // than a compile-time refusal. Either way the flavour does not admit it.
    expect(() => construct(`${PREFIX}\nRULE { :x :q ?o } FOR ?v IN :Shape WHERE { :s :p ?o }`)).toThrow();
  });
});
