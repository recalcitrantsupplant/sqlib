import { describe, expect, it } from 'vitest';
import { TupleStore, injectTupleReads, renderBindingValue } from '../../src/lib/TupleStore.js';
import {
  compileRule,
  expandIris,
  groundTupleSeedRows,
  parseRuleSet,
  parseTupleSeeds,
} from '@sparql-query-lib/srl';

const PREFIX = 'PREFIX : <http://example/>';
const compile = (doc: string) => {
  const rs = expandIris(parseRuleSet(doc, { tuples: true }));
  return { rs, compiled: compileRule(rs.rules[0], rs.prologueText) };
};

describe('TupleStore', () => {
  // Changed 2026-08-08: was 'keeps duplicates', per #752. Derived tuples are
  // re-captured on every pass of the fixpoint, so a bag grows without bound and
  // its contribution to the convergence signature never settles. See
  // TupleStore.add.
  it('stores by arity, and is a set', () => {
    const s = new TupleStore();
    s.add(['<http://example/rel>', '<http://a>']);
    s.add(['<http://example/rel>', '<http://a>']);
    s.add(['<http://example/rel>', '<http://a>', '<http://b>']);
    expect(s.rows(2)).toHaveLength(1);
    expect(s.rows(3)).toHaveLength(1);
    expect(s.size).toBe(2);
  });

  it('signature is stable under insertion order and changes on new content', () => {
    const a = new TupleStore();
    const b = new TupleStore();
    a.add(['<http://example/rel>', '<http://a>']);
    a.add(['<http://example/rel>', '<http://b>']);
    b.add(['<http://example/rel>', '<http://b>']);
    b.add(['<http://example/rel>', '<http://a>']);
    expect(a.signature()).toBe(b.signature());
    b.add(['<http://example/rel>', '<http://c>']);
    expect(a.signature()).not.toBe(b.signature());
  });

  it('matches on constant slots only', () => {
    const { compiled } = compile(`${PREFIX}\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x) }`);
    const ref = compiled.tupleReads[0];
    const s = new TupleStore();
    s.add(['<http://example/rel>', '<http://a>']);
    s.add(['<http://example/other>', '<http://b>']);
    expect(s.match(ref)).toEqual([['<http://example/rel>', '<http://a>']]);
  });

  it('renders matching rows entire, in slot order', () => {
    const s = new TupleStore();
    s.add(['<http://example/rel>', '<http://a>']);
    s.add(['<http://example/other>', '<http://b>']);
    // Terms as a slot's row states them: a term to match, or undefined for a
    // variable position. Rows come back whole, since the header has a column per
    // position.
    expect(s.valuesRows(['<http://example/rel>', undefined]))
      .toBe('(<http://example/rel> <http://a>)');
  });

  it('yields no rows when nothing matches (rule produces nothing)', () => {
    expect(new TupleStore().valuesRows(['<http://example/rel>', undefined])).toBe('');
  });

  it('tells two same-arity reads apart by their pinned IRI', () => {
    // The case the slot has to carry itself: same arity, same variables, and the
    // only difference is slot 0 — so that is what injection matches on.
    const { compiled } = compile(`${PREFIX}
RULE { ?n :ok true } WHERE { TUPLE(:cities, ?n, ?p) TUPLE(:suburbs, ?n, ?p) }`);
    const s = new TupleStore();
    s.add(['<http://example/cities>', '"Cairns"', '<http://example/p1>']);
    s.add(['<http://example/suburbs>', '"Edge Hill"', '<http://example/p2>']);
    const out = injectTupleReads(compiled.program, s);
    expect(out).toContain('VALUES (?_read0_slot0 ?n ?p) { (<http://example/cities> "Cairns" <http://example/p1>) }');
    expect(out).toContain('VALUES (?_read1_slot0 ?n ?p) { (<http://example/suburbs> "Edge Hill" <http://example/p2>) }');
  });

  it('needs no constant at all — an unpinned read takes every row of its arity', () => {
    // Slot 0 is a convention, not a rule. With nothing pinned there is nothing to
    // generate a column for either: the header is the author's own variables and
    // the row is all UNDEF, which is what a read with no constants means.
    const { compiled } = compile(`${PREFIX}\nRULE { ?x :ok true } WHERE { TUPLE(?name, ?latlon) }`);
    expect(compiled.program).toContain('VALUES (?name ?latlon) { (UNDEF UNDEF) }');

    const s = new TupleStore();
    s.add(['"Cairns"', '<http://example/p1>']);
    s.add(['<http://example/cities>', '"Cairns"']);
    s.add(['<http://example/a>', '<http://example/b>', '<http://example/c>']);
    const out = injectTupleReads(compiled.program, s);
    // Every arity-2 row, and only those.
    expect(out).toContain('VALUES (?name ?latlon) { ("Cairns" <http://example/p1>) (<http://example/cities> "Cairns") }');
  });

  it('fills the slot in the compiled program, keeping header and comment', () => {
    const { compiled } = compile(`${PREFIX}\nRULE { ?x :ok true } WHERE { ?x :p ?y . TUPLE(:rel, ?x) }`);
    const s = new TupleStore();
    s.add(['<http://example/rel>', '<http://a>']);
    const out = injectTupleReads(compiled.program, s);
    // No UNDEF survives: nothing is left binding a variable position to nothing.
    expect(out).not.toMatch(/UNDEF/);
    expect(out).toContain('VALUES (?_read0_slot0 ?x) { (<http://example/rel> <http://a>) }');
    // The comment is re-emitted, so injected rows stay labelled with their read.
    expect(out).toContain('# TUPLE(<http://example/rel>, ?x)');
  });

  it('fills a fully-ground read, which pins every position', () => {
    const { compiled } = compile(`${PREFIX}\nRULE { ?x :ok true } WHERE { ?x :p ?y . TUPLE(:rel, :a) }`);
    const s = new TupleStore();
    // Nothing matched: an empty VALUES has no solutions, so the read kills the
    // rule rather than asserting a tuple the store does not hold. The slot looks
    // identical filled and unfilled here, which is why the comment is the anchor.
    expect(injectTupleReads(compiled.program, s))
      .toContain('VALUES (?_read0_slot0 ?_read0_slot1) { }');

    s.add(['<http://example/rel>', '<http://example/a>']);
    expect(injectTupleReads(compiled.program, s))
      .toContain('VALUES (?_read0_slot0 ?_read0_slot1) { (<http://example/rel> <http://example/a>) }');
  });

  it('leaves a repeated position to the emitted filter, not to row selection', () => {
    const { compiled } = compile(`${PREFIX}\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x, ?x) }`);
    const s = new TupleStore();
    s.add(['<http://example/rel>', '<http://a>', '<http://a>']);
    s.add(['<http://example/rel>', '<http://a>', '<http://b>']);
    const out = injectTupleReads(compiled.program, s);
    // Both rows go in — arity and the pinned IRI are all the slot asks for.
    expect(out).toContain('{ (<http://example/rel> <http://a> <http://a>) (<http://example/rel> <http://a> <http://b>) }');
    // The disagreeing row is excluded by the query, which is what makes a filled
    // slot equivalent to the read.
    expect(out).toContain('FILTER(sameTerm(?x, ?_read0_slot2))');
  });

  it('matches a pinned literal containing spaces', () => {
    const { compiled } = compile(`${PREFIX}\nRULE { ?x :ok true } WHERE { TUPLE(:rel, "Port Douglas", ?x) }`);
    const s = new TupleStore();
    s.add(['<http://example/rel>', '"Port Douglas"', '<http://a>']);
    s.add(['<http://example/rel>', '"Cairns"', '<http://b>']);
    const out = injectTupleReads(compiled.program, s);
    expect(out).toContain('{ (<http://example/rel> "Port Douglas" <http://a>) }');
  });

  it('builds a grounded row from a write template plus bindings', () => {
    const { compiled } = compile(`${PREFIX}\nRULE { TUPLE(:rel, ?s, ?o) } WHERE { ?s :p ?o }`);
    const ref = compiled.tupleWrites[0];
    const row = TupleStore.rowFromTemplate(ref, (n) =>
      n === 's' ? '<http://a>' : n === 'o' ? '"x"' : undefined,
    );
    expect(row).toEqual(['<http://example/rel>', '<http://a>', '"x"']);
  });

  it('skips a row when a template variable is unbound (tuples must be ground)', () => {
    const { compiled } = compile(`${PREFIX}\nRULE { TUPLE(:rel, ?s, ?o) } WHERE { ?s :p ?o }`);
    const row = TupleStore.rowFromTemplate(compiled.tupleWrites[0], (n) => (n === 's' ? '<http://a>' : undefined));
    expect(row).toBeNull();
  });

  // Issue #165. Rows are matched by their rendered form, so an unexpanded term
  // is not a different spelling of the same tuple — it is a different tuple, and
  // the mismatch is silent: the stratifier expands, so it links the prefixed
  // writer to the absolute reader and calls the set well-formed, and only
  // execution comes back empty. Both ends of the store therefore refuse it.
  describe('expanded-term invariant', () => {
    it('refuses to store a prefixed name', () => {
      const s = new TupleStore();
      expect(() => s.add([':rel', '<http://a>'])).toThrow(/prefixed name/);
      expect(() => s.add([':rel', '<http://a>'])).toThrow(/expandIris/);
      expect(s.size).toBe(0);
    });

    it('refuses a literal shorthand and a prefixed datatype', () => {
      const s = new TupleStore();
      expect(() => s.add(['<http://example/rel>', '18'])).toThrow(/literal shorthand/);
      expect(() => s.add(['<http://example/rel>', '"18"^^xsd:integer'])).toThrow(/datatype/);
    });

    it('refuses an unground row — a tuple is a value, not a pattern', () => {
      expect(() => new TupleStore().add(['<http://example/rel>', '?x'])).toThrow(/must be ground/);
    });

    it('refuses a read whose constant slots are not expanded', () => {
      // Same document, compiled *without* expandIris: the read renders `:rel`.
      const rs = parseRuleSet(`${PREFIX}\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x) }`, { tuples: true });
      const ref = compileRule(rs.rules[0], rs.prologueText).tupleReads[0];
      expect(ref.terms[0]).toBe(':rel');
      const s = new TupleStore();
      s.add(['<http://example/rel>', '<http://a>']);
      expect(() => s.match(ref)).toThrow(/Cannot match TUPLE\(:rel, \?x\)/);
    });

    it('accepts every form the SRL path actually produces', () => {
      const s = new TupleStore();
      // Numeric and boolean shorthands are resolved to their datatype form by
      // the parser, so a seed row written `TUPLE(:t, 18, true)` arrives expanded.
      const seeded = groundTupleSeedRows(parseTupleSeeds(
        `${PREFIX}\nTUPLE(:t, 18, 23.0, true, "x"@en, :a)`,
        { tuples: true },
      ));
      expect(() => seeded.forEach((row) => s.add(row))).not.toThrow();
      // …and so do rows captured from a solution binding.
      expect(() => s.add([
        renderBindingValue({ type: 'uri', value: 'http://example/rel' }),
        renderBindingValue({ type: 'bnode', value: 'b0' }),
        renderBindingValue({ type: 'literal', value: '1', datatype: 'http://www.w3.org/2001/XMLSchema#integer' }),
      ])).not.toThrow();
    });
  });

  it('renders binding values as SPARQL terms', () => {
    expect(renderBindingValue({ type: 'uri', value: 'http://a' })).toBe('<http://a>');
    expect(renderBindingValue({ type: 'literal', value: 'x' })).toBe('"x"');
    expect(renderBindingValue({ type: 'literal', value: 'x', 'xml:lang': 'en' })).toBe('"x"@en');
    expect(renderBindingValue({ type: 'literal', value: '1', datatype: 'http://www.w3.org/2001/XMLSchema#integer' }))
      .toBe('"1"^^<http://www.w3.org/2001/XMLSchema#integer>');
  });
});
