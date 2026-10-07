import { describe, expect, it } from 'vitest';
import { compileRule, parseRuleSet } from '../src/index.js';

const PREFIX = 'PREFIX : <http://example/>';

const compile = (rule: string) => {
  const rs = parseRuleSet(`${PREFIX}\n${rule}`);
  return compileRule(rs.rules[0], rs.prologueText).program;
};

/** The WHERE part only: the head keeps its blank nodes. */
const where = (program: string) => program.slice(program.indexOf('WHERE'));

describe('compileRule — body blank nodes become variables', () => {
  it('uses one variable for a blank node shared with a NOT', () => {
    const program = compile('RULE { ?x :p :o } WHERE { ?x :r _:b NOT { _:b :q :c } }');
    expect(where(program)).not.toMatch(/_:/);
    expect(program.match(/\?_bnode_e_b\b/g)).toHaveLength(2);
  });

  it('compiles a blank node used on both sides of a SET', () => {
    const program = compile('RULE { ?x :p ?w } WHERE { ?x :r _:b SET(?z := 1) _:b :s ?w }');
    expect(program.match(/\?_bnode_e_b\b/g)).toHaveLength(2);
  });

  it('replaces blank nodes inside triple terms, [ … ] and ( … )', () => {
    const program = compile('RULE { ?x :p :o } WHERE { ?x :r <<( _:b :q [] )>> ; :s [ :t _:b ] ; :u ( _:b ) }');
    expect(where(program)).not.toMatch(/_:/);
    expect(where(program)).toMatch(/\[/);
    expect(where(program)).toMatch(/\(\s*\?_bnode_e_b\s*\)/);
  });

  it('keeps head blank nodes as blank nodes', () => {
    const program = compile('RULE { ?x :p _:b } WHERE { ?x :r _:b }');
    expect(program).toMatch(/INSERT \{\s*\?x :p _:b\s*\}/);
    expect(where(program)).toMatch(/\?x :r \?_bnode_e_b/);
  });

  it('picks a name the rule does not use', () => {
    const program = compile('RULE { ?x :p ?_bnode_e_b } WHERE { ?x :r _:b ; :s ?_bnode_e_b }');
    expect(where(program)).toMatch(/\?x :r \?__bnode_e_b/);
  });

  it('scopes a NOT ahead of the blank node it shares, like a variable', () => {
    // `_:b` is free inside the NOT at that point, so the NOT must not see the
    // later binding: the compiler closes the group before the triple.
    const program = compile('RULE { ?x :p :o } WHERE { NOT { _:b :q :c } ?x :r _:b }');
    expect(where(program)).toMatch(/\{\s*FILTER NOT EXISTS \{\s*\?_bnode_e_b :q :c \.\s*\}\s*\}\s*\?x :r \?_bnode_e_b/);
  });
});
