import { describe, expect, it } from 'vitest';
import {
  compileRule,
  expandIris,
  groundTupleSeedRows,
  parseRuleSet,
  parseTupleSeeds,
  readSlotRow,
  stratify,
  tupleSeedDeclarations,
} from '../src/index.js';

const PREFIX = 'PREFIX : <http://example/>';
const opts = { tuples: true } as const;

const parse = (doc: string) => parseRuleSet(doc, opts);
const strat = (doc: string) => {
  const rs = parse(doc);
  return stratify(rs.rules.map((ast, i) => ({ id: `r${i}`, ast })));
};

describe('rule tuples — gating', () => {
  it('rejects TUPLE without the extension enabled', () => {
    expect(() => parseRuleSet(`${PREFIX}\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x) }`)).toThrow(
      /rule-tuples extension/i,
    );
  });

  it('accepts TUPLE with the extension enabled', () => {
    const rs = parse(`${PREFIX}\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x) }`);
    expect(rs.rules[0].body.map((b) => b.kind)).toContain('tuple');
  });
});

describe('rule tuples — compile', () => {
  it('a body tuple becomes a read with an all-UNDEF VALUES slot, one column per slot', () => {
    const rs = parse(`${PREFIX}\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x, ?y) }`);
    const c = compileRule(rs.rules[0], rs.prologueText);
    expect(c.producesTuples).toBe(false);
    expect(c.tupleReads).toHaveLength(1);
    expect(c.tupleReads[0].arity).toBe(3);
    expect(c.tupleReads[0].terms).toEqual([':rel', '?x', '?y']);
    // A column per position, so the block states the read's arity; the constant
    // pinned into the row, so the block says which rows it wants.
    expect(c.program).toContain('VALUES (?_read0_slot0 ?x ?y) { (:rel UNDEF UNDEF) }');
    // The pattern as written sits above it, and is what marks the pair as a slot.
    expect(c.program).toContain('# TUPLE(:rel, ?x, ?y)');
    // Still valid SPARQL before substitution (compileRule parses what it emits).
    expect(c.program).toContain('INSERT');
  });

  it('states a repeated variable as a filter — VALUES cannot declare one twice', () => {
    const rs = parse(`${PREFIX}\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x, ?x) }`);
    const c = compileRule(rs.rules[0], rs.prologueText);
    expect(c.program).toContain('VALUES (?_read0_slot0 ?x ?_read0_slot2) { (:rel UNDEF UNDEF) }');
    // Agreement is part of the selection, so it has to be enforced somewhere. In
    // the query means whoever injects rows need not know about repeats at all.
    expect(c.program).toContain('FILTER(sameTerm(?x, ?_read0_slot2))');
  });

  it('pins every position of a fully-ground read', () => {
    const rs = parse(`${PREFIX}\nRULE { ?x :ok true } WHERE { ?x :p ?y . TUPLE(:rel, :a, :b) }`);
    const c = compileRule(rs.rules[0], rs.prologueText);
    expect(c.program).toContain('VALUES (?_read0_slot0 ?_read0_slot1 ?_read0_slot2) { (:rel :a :b) }');
  });

  it('generated columns miss the rule\u2019s own variables, and each other', () => {
    // The author already uses the name the generator would reach for first.
    const rs = parse(`${PREFIX}\nRULE { ?x :ok true } WHERE { ?x :p ?_read0_slot0 . TUPLE(:rel, ?x) }`);
    const c = compileRule(rs.rules[0], rs.prologueText);
    expect(c.program).toContain('VALUES (?__read0_slot0 ?x)');
    // Constraining the author's variable instead would change what the rule means.
    expect(c.program).toContain('?x :p ?_read0_slot0 .');
  });

  it('names a slot column once, so a column and its filter agree', () => {
    // Two occurrences of one generated name: allocating per occurrence renames
    // the filter's copy and the agreement silently stops being enforced.
    const rs = parse(`${PREFIX}\nRULE { ?x :ok true } WHERE { ?x :p ?_read0_slot2 . TUPLE(:rel, ?x, ?x) }`);
    const c = compileRule(rs.rules[0], rs.prologueText);
    expect(c.program).toContain('VALUES (?_read0_slot0 ?x ?__read0_slot2) { (:rel UNDEF UNDEF) }');
    expect(c.program).toContain('FILTER(sameTerm(?x, ?__read0_slot2))');
  });

  it('gives each read its own columns, so two reads never join through them', () => {
    const rs = parse(
      `${PREFIX}\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x) NOT { TUPLE(:seen, ?x) } }`,
    );
    const c = compileRule(rs.rules[0], rs.prologueText);
    // A shared name would join the two blocks, silently requiring :rel and :seen
    // to be the same term.
    expect(c.program).toContain('VALUES (?_read0_slot0 ?x) { (:rel UNDEF) }');
    expect(c.program).toContain('VALUES (?_read1_slot0 ?x) { (:seen UNDEF) }');
    expect(c.tupleReads.map((r) => r.terms[0])).toEqual([':rel', ':seen']);
  });

  it('reads a slot row back, tokenising terms that contain spaces', () => {
    // What injection matches on. Splitting on whitespace would break the literal
    // into two cells and shift every position after it.
    expect(readSlotRow('(<http://ex/t> UNDEF "Port Douglas" "3"^^<http://ex/int> "hi"@en)'))
      .toEqual(['<http://ex/t>', undefined, '"Port Douglas"', '"3"^^<http://ex/int>', '"hi"@en']);
    // UNDEF is a hole; a literal that merely says UNDEF is a term.
    expect(readSlotRow('("UNDEF" UNDEF)')).toEqual(['"UNDEF"', undefined]);
  });

  it('a head tuple turns the rule into a SELECT that captures rows', () => {
    const rs = parse(`${PREFIX}\nRULE { TUPLE(:rel, ?s, ?o) } WHERE { ?s :p ?o }`);
    const c = compileRule(rs.rules[0], rs.prologueText);
    expect(c.producesTuples).toBe(true);
    // DISTINCT: the store is a set, and a SELECT returns a solution sequence.
    expect(c.program).toMatch(/SELECT\s+DISTINCT\s+\?s\s+\?o\s+WHERE/);
    expect(c.tupleWrites).toHaveLength(1);
    expect(c.tupleWrites[0].terms).toEqual([':rel', '?s', '?o']);
  });

  it('rejects a head mixing triple and tuple templates', () => {
    const rs = parse(`${PREFIX}\nRULE { ?s :q ?o . TUPLE(:rel, ?s, ?o) } WHERE { ?s :p ?o }`);
    expect(() => compileRule(rs.rules[0], rs.prologueText)).toThrow(/either triple templates or tuple templates/i);
  });

  it('marks a tuple read under NOT as negated', () => {
    const rs = parse(`${PREFIX}\nRULE { ?x :ok true } WHERE { ?x :p ?y NOT { TUPLE(:rel, ?x, ?y) } }`);
    const c = compileRule(rs.rules[0], rs.prologueText);
    expect(c.tupleReads[0].negated).toBe(true);
  });
});

describe('rule tuples — stratification', () => {
  it('a reader depends positively on a same-signature writer', () => {
    const r = strat(`${PREFIX}
RULE { TUPLE(:rel, ?s, ?o) } WHERE { ?s :p ?o }
RULE { ?s :ok true } WHERE { TUPLE(:rel, ?s, ?o) }`);
    expect(r.issues).toEqual([]);
    const edge = r.edges.find((e) => e.from === 'r1' && e.to === 'r0');
    expect(edge?.label).toBe('positive');
  });

  it('does not link tuples of different arity', () => {
    const r = strat(`${PREFIX}
RULE { TUPLE(:rel, ?s) } WHERE { ?s :p ?o }
RULE { ?s :ok true } WHERE { TUPLE(:rel, ?s, ?o) }`);
    expect(r.edges.find((e) => e.from === 'r1' && e.to === 'r0')).toBeUndefined();
  });

  it('does not link tuples whose constant slots differ', () => {
    const r = strat(`${PREFIX}
RULE { TUPLE(:other, ?s, ?o) } WHERE { ?s :p ?o }
RULE { ?s :ok true } WHERE { TUPLE(:rel, ?s, ?o) }`);
    expect(r.edges.find((e) => e.from === 'r1' && e.to === 'r0')).toBeUndefined();
  });

  it('a variable in slot 0 matches all same-arity writers (conservative)', () => {
    const r = strat(`${PREFIX}
RULE { TUPLE(:a, ?s, ?o) } WHERE { ?s :p ?o }
RULE { TUPLE(:b, ?s, ?o) } WHERE { ?s :q ?o }
RULE { ?s :ok true } WHERE { TUPLE(?any, ?s, ?o) }`);
    expect(r.edges.find((e) => e.from === 'r2' && e.to === 'r0')).toBeDefined();
    expect(r.edges.find((e) => e.from === 'r2' && e.to === 'r1')).toBeDefined();
  });

  it('flags a non-stratifiable negative tuple cycle', () => {
    const r = strat(`${PREFIX}\nRULE { TUPLE(:rel, ?s) } WHERE { ?s :p ?o NOT { TUPLE(:rel, ?s) } }`);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues[0]).toMatch(/non-stratifiable/i);
  });

  it('puts a negative tuple reader in a later stratum', () => {
    const r = strat(`${PREFIX}
RULE { TUPLE(:rel, ?s) } WHERE { ?s :p ?o }
RULE { ?s :missing true } WHERE { ?s :thing ?o NOT { TUPLE(:rel, ?s) } }`);
    expect(r.issues).toEqual([]);
    expect(r.strata.r1).toBeGreaterThan(r.strata.r0);
  });
});

describe('rule tuples — prefix expansion symmetry', () => {
  it('expands head tuple terms as well as body tuple terms', () => {
    const rs = expandIris(
      parseRuleSet(
        `${PREFIX}
RULE { TUPLE(:rel, ?s) } WHERE { ?s :p ?o }
RULE { ?s :ok true } WHERE { TUPLE(:rel, ?s) }`,
        opts,
      ),
    );
    const write = (rs.rules[0].headTuples[0].terms[0] as any).value;
    const readItem = rs.rules[1].body.find((b) => b.kind === 'tuple') as any;
    const read = readItem.tuple.terms[0].value;
    // Both sides must expand identically, else writes and reads never match.
    expect(write).toBe('http://example/rel');
    expect(read).toBe(write);
  });
});

describe('tuple seed rows', () => {
  const seeds = (text: string) => parseTupleSeeds(text, opts);

  it('requires the extension: with tuples off there is nothing to seed', () => {
    expect(() => parseTupleSeeds(`${PREFIX}\nTUPLE(:reach, :a, :b)`)).toThrow(/rule-tuples extension/i);
  });

  it('parses ground rows and expands them against the seed prologue', () => {
    const s = seeds(`${PREFIX}\nTUPLE(:reach, :a, :b)\nTUPLE(:reach, :b, :c) .`);
    expect(s.rows).toHaveLength(2);
    expect(s.rows.every((r) => r.ground)).toBe(true);
    expect(groundTupleSeedRows(s)).toEqual([
      ['<http://example/reach>', '<http://example/a>', '<http://example/b>'],
      ['<http://example/reach>', '<http://example/b>', '<http://example/c>'],
    ]);
  });

  it('expands seeds the same way rules are expanded, so a seed matches a rule read', () => {
    const s = seeds(`${PREFIX}\nTUPLE(:rel, :a)`);
    const rs = expandIris(parseRuleSet(`${PREFIX}\nRULE { ?s :ok true } WHERE { TUPLE(:rel, ?s) }`, opts));
    const read = (rs.rules[0].body.find((b) => b.kind === 'tuple') as any).tuple.terms[0].value;
    expect(s.rows[0].terms[0]).toBe(`<${read}>`);
  });

  it('treats a row carrying variables as a declaration, not a value', () => {
    const s = seeds(`${PREFIX}\nTUPLE(:seed, ?x, ?y)`);
    expect(s.rows[0].ground).toBe(false);
    expect(groundTupleSeedRows(s)).toEqual([]);
    expect(tupleSeedDeclarations(s)).toEqual([
      { arity: 3, terms: ['<http://example/seed>', '?x', '?y'] },
    ]);
  });

  it('keeps values and declarations apart in one document', () => {
    const s = seeds(`${PREFIX}\nTUPLE(:reach, :a, :b)\nTUPLE(:input, ?x)`);
    expect(groundTupleSeedRows(s)).toHaveLength(1);
    expect(tupleSeedDeclarations(s)).toHaveLength(1);
  });

  it('rejects a blank node: an existential is neither a value nor an input', () => {
    expect(() => seeds(`${PREFIX}\nTUPLE(:reach, _:b1, :a)`)).toThrow(/blank node/i);
  });

  it('accepts an empty document', () => {
    expect(seeds('   ').rows).toEqual([]);
  });

  it('rejects anything that is not a TUPLE row', () => {
    expect(() => seeds(`${PREFIX}\nRULE { ?s :q ?o } WHERE { ?s :p ?o }`)).toThrow();
  });
});
