import { describe, expect, it } from 'vitest';
import { checkWellFormed, parseRuleSet, stratify } from '../src/index.js';

const PREFIX = 'PREFIX : <http://example/>';

/** Parse a document and hand each rule a stable id by index. */
function strat(doc: string) {
  const rs = parseRuleSet(doc);
  return stratify(rs.rules.map((ast, i) => ({ id: `r${i}`, ast })));
}

describe('SRL stratification', () => {
  it('a single monotone rule has no issues and stratum 0', () => {
    const r = strat(`${PREFIX}\nRULE { :x :q ?o } WHERE { :s :p ?o }`);
    expect(r.issues).toEqual([]);
    expect(r.strata.r0).toBe(0);
    expect(r.monotonicity.r0).toBe('monotone');
  });

  it('positive dependency keeps reader at or above producer', () => {
    // r1 reads :q which r0 produces -> positive edge r1 -> r0
    const r = strat(`${PREFIX}
RULE { ?s :q ?o } WHERE { ?s :p ?o }
RULE { ?s :r ?o } WHERE { ?s :q ?o }`);
    expect(r.issues).toEqual([]);
    const edge = r.edges.find((e) => e.from === 'r1' && e.to === 'r0');
    expect(edge?.label).toBe('positive');
  });

  it('flags a negative self-cycle as non-stratifiable (W3C stratification-bad-01)', () => {
    // RULE { ?s :p "ABC" } WHERE { ?s :data "" . NOT { ?s :p "ABC" } }
    const r = strat(`${PREFIX}\nRULE { ?s :p "ABC" } WHERE { ?s :data ?d . NOT { ?s :p "ABC" } }`);
    expect(r.monotonicity.r0).toBe('negation');
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues[0]).toMatch(/non-stratifiable/i);
  });

  it('ordinary rules are not run-once', () => {
    const r = strat(`${PREFIX}\nRULE { :x :q ?o } WHERE { :s :p ?o }`);
    expect(r.runOnce.r0).toBe(false);
  });

  it('stratifiable negation lands the reader in a later stratum', () => {
    // r1 negatively depends on r0's head -> r1 stratum > r0 stratum
    const r = strat(`${PREFIX}
RULE { ?s :classified true } WHERE { ?s :p ?o }
RULE { ?s :unknown true } WHERE { ?s :thing ?o . NOT { ?s :classified true } }`);
    expect(r.issues).toEqual([]);
    expect(r.strata.r1).toBeGreaterThan(r.strata.r0);
  });
});

describe('SRL well-formedness', () => {
  it('accepts a well-formed rule', () => {
    const rs = parseRuleSet(`${PREFIX}\nRULE { ?s :q ?o } WHERE { ?s :p ?o }`);
    expect(checkWellFormed(rs)).toEqual([]);
  });

  it('rejects an unbound head variable', () => {
    const rs = parseRuleSet(`${PREFIX}\nRULE { ?s :q ?missing } WHERE { ?s :p ?o }`);
    const issues = checkWellFormed(rs);
    expect(issues.map((i) => i.category)).toContain('unbound-head');
  });

  it('rejects SET re-binding an already-bound variable (W3C wellformed-bad-01)', () => {
    // RULE { ?s ?p ?o } WHERE { ?s ?p ?o SET(?o := 123) }
    const rs = parseRuleSet(`${PREFIX}\nRULE { ?s :q ?o } WHERE { ?s :p ?o SET ( ?o := 123 ) }`);
    const issues = checkWellFormed(rs);
    expect(issues.map((i) => i.category)).toContain('set-rebinds');
  });
});

describe('SRL conformance edge cases', () => {
  it('rejects an invalid base direction (uppercase --LTR)', () => {
    // W3C syntax-{template,rule-terms,pattern}-bad-01. Traqula normalizes the
    // direction to lowercase, so this must be caught at the source level.
    expect(() => parseRuleSet(`${PREFIX}\nRULE { :s :p "abc"@en--LTR } WHERE { ?a ?b ?c }`)).toThrow(
      /invalid base direction/i,
    );
  });

  it('accepts valid base directions', () => {
    expect(() => parseRuleSet(`${PREFIX}\nRULE { :s :p "abc"@en--ltr } WHERE { ?a ?b ?c }`)).not.toThrow();
    expect(() => parseRuleSet(`${PREFIX}\nRULE { :s :p "abc"@ar--rtl } WHERE { ?a ?b ?c }`)).not.toThrow();
  });

  it('rejects use-before-bind in a FILTER (W3C wellformed-bad-03)', () => {
    const rs = parseRuleSet(`${PREFIX}\nRULE { ?s ?p ?o } WHERE { FILTER(?o < 50) ?s ?p ?o }`);
    expect(checkWellFormed(rs).map((i) => i.category)).toContain('use-before-bind');
  });

  it('allows a FILTER after the binding pattern (W3C wellformed-02)', () => {
    const rs = parseRuleSet(`${PREFIX}\nRULE { ?s ?p ?o } WHERE { ?s ?p ?o . FILTER(?o < 50) }`);
    expect(checkWellFormed(rs)).toEqual([]);
  });

  it('allows NOT to introduce its own variables (W3C wellformed-04)', () => {
    const rs = parseRuleSet(
      `${PREFIX}\nRULE { ?s ?p ?o } WHERE { ?s :p :z . NOT { ?s :q ?y } ?s :q ?o SET(?p := :p) }`,
    );
    expect(checkWellFormed(rs)).toEqual([]);
  });

  it('flags a blank-node-generating rule in a positive cycle (W3C stratification-bad-03)', () => {
    // Fresh blank node per firing => no fixpoint.
    const r = strat(`${PREFIX}\nRULE { [] :q "Rule" } WHERE { ?s :q ?o }`);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.join(' ')).toMatch(/blank-node/i);
  });

  it('allows a blank-node head when it is not in a cycle', () => {
    const r = strat(`${PREFIX}\nRULE { [] :q "Rule" } WHERE { ?s :p ?o }`);
    expect(r.issues).toEqual([]);
  });
});

/**
 * Run-once (`SL.once`) rules: a blank-node head or a `SET` makes every firing
 * derive a fresh answer, so the rule is evaluated once — and, for that single
 * firing to be complete, strictly above everything it reads. The spec gets the
 * ordering by promoting such a rule's dependencies to "closed" edges.
 */
describe('SRL run-once rules and closed dependencies', () => {
  it('flags a blank-node head as run-once', () => {
    const r = strat(`${PREFIX}\nRULE { [] :q "Rule" } WHERE { ?s :p ?o }`);
    expect(r.runOnce.r0).toBe(true);
  });

  it('flags a SET body as run-once', () => {
    const r = strat(`${PREFIX}\nRULE { ?s :q ?v } WHERE { ?s :p ?o SET ( ?v := ?o + 1 ) }`);
    expect(r.runOnce.r0).toBe(true);
  });

  it('closes a blank-node rule\'s dependency and lifts it a stratum', () => {
    const r = strat(`${PREFIX}
RULE { ?s :q ?o } WHERE { ?s :p ?o }
RULE { [] :seen ?s } WHERE { ?s :q ?o }`);
    expect(r.issues).toEqual([]);
    expect(r.edges.find((e) => e.from === 'r1' && e.to === 'r0')?.label).toBe('closed');
    expect(r.strata.r1).toBeGreaterThan(r.strata.r0);
  });

  it('closes a SET rule\'s dependency and lifts it a stratum', () => {
    const r = strat(`${PREFIX}
RULE { ?s :q ?o } WHERE { ?s :p ?o }
RULE { ?s :scaled ?v } WHERE { ?s :q ?o SET ( ?v := ?o * 2 ) }`);
    expect(r.issues).toEqual([]);
    expect(r.edges.find((e) => e.from === 'r1' && e.to === 'r0')?.label).toBe('closed');
    expect(r.strata.r1).toBeGreaterThan(r.strata.r0);
  });

  it('keeps a negative edge negative even when the reader is run-once', () => {
    const r = strat(`${PREFIX}
RULE { ?s :classified true } WHERE { ?s :p ?o }
RULE { [] :missing ?s } WHERE { ?s :thing ?o . NOT { ?s :classified true } }`);
    expect(r.edges.find((e) => e.from === 'r1' && e.to === 'r0')?.label).toBe('negative');
    expect(r.strata.r1).toBeGreaterThan(r.strata.r0);
  });

  it('rejects a SET rule that reads its own head', () => {
    // A closed edge in a cycle is non-stratifiable, exactly as a negative one is.
    const r = strat(`${PREFIX}\nRULE { ?s :p ?v } WHERE { ?s :p ?o SET ( ?v := ?o + 1 ) }`);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.join(' ')).toMatch(/run-once/i);
    expect(r.issues.join(' ')).toMatch(/assignment/i);
  });
});

/**
 * A non-stratifiable document has no layering. What it has instead is the
 * cycles that stop it, reported as data a client can point at.
 */
describe('SRL non-stratifiable reports', () => {
  const MUTUAL = `${PREFIX}
RULE { ?s :p "abc" } WHERE { ?s :data "" . NOT { ?s :p "ABC" } }
RULE { :s :p "ABC" } WHERE { NOT { ?x :p "abc" } ?s :data "" }`;

  it('withholds strata rather than reporting where the layering gave up', () => {
    const r = strat(MUTUAL);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.strata).toEqual({});
  });

  it('reports a mutual negation as one cycle naming both rules and both edges', () => {
    const r = strat(MUTUAL);
    expect(r.cycles).toHaveLength(1);
    const [cycle] = r.cycles;
    expect(cycle.kind).toBe('negation');
    expect(cycle.rules).toEqual(['r0', 'r1']);
    const pairs = cycle.edges.map((e) => `${e.from}->${e.to}:${e.label}`).sort();
    expect(pairs).toEqual(['r0->r1:negative', 'r1->r0:negative']);
    // The triple pair that made each edge is carried through for display.
    const r0 = cycle.edges.find((e) => e.from === 'r0');
    expect(r0?.reasons[0].body.object).toBe('"ABC"');
    expect(r0?.reasons[0].head.subject).toBe(':s');
  });

  it('reports a negative self-loop as a one-rule cycle', () => {
    const r = strat(`${PREFIX}\nRULE { ?s :p "ABC" } WHERE { ?s :data ?d . NOT { ?s :p "ABC" } }`);
    expect(r.cycles).toEqual([
      expect.objectContaining({ kind: 'negation', rules: ['r0'] }),
    ]);
  });

  it('names the run-once rule, and why, in a run-once cycle', () => {
    const r = strat(`${PREFIX}\nRULE { ?s :p ?v } WHERE { ?s :p ?o SET ( ?v := ?o + 1 ) }`);
    expect(r.cycles).toEqual([
      expect.objectContaining({
        kind: 'run-once',
        rules: ['r0'],
        runOnce: [{ rule: 'r0', reasons: ['assignment (SET)'] }],
      }),
    ]);
    expect(r.strata).toEqual({});
  });

  it('reports no cycles for a stratifiable document', () => {
    const r = strat(`${PREFIX}
RULE { ?s :classified true } WHERE { ?s :p ?o }
RULE { ?s :unknown true } WHERE { ?s :thing ?o . NOT { ?s :classified true } }`);
    expect(r.cycles).toEqual([]);
  });
});

/*
 * Turtle's shorthand in a head or a body: `[ … ]`, `( … )`, `<< … >>`,
 * `~ :r` and `{| … |}`. The parser keeps these nested, and stratification has
 * to see the triples they stand for (RDF 1.2), not a collection with no terms.
 */
describe('SRL stratification through Turtle shorthand', () => {
  it('sees a triple written inside [ … ] in a head', () => {
    const r = strat(`${PREFIX}
RULE { [ :made ?o ] :q 1 } WHERE { ?s :p ?o }
RULE { ?s :r ?o } WHERE { ?s :made ?o }`);
    expect(r.edges.find((e) => e.from === 'r1' && e.to === 'r0')).toBeDefined();
  });

  it('sees a triple written inside [ … ] in a body', () => {
    const r = strat(`${PREFIX}
RULE { ?s :made ?o } WHERE { ?s :p ?o }
RULE { ?x :r ?y } WHERE { [ :made ?x ] :q ?y }`);
    expect(r.edges.find((e) => e.from === 'r1' && e.to === 'r0')).toBeDefined();
  });

  it('does not treat << s p o >> as asserting s p o', () => {
    const r = strat(`${PREFIX}
RULE { << :a :made :b >> :src :x } WHERE { ?s :p ?o }
RULE { ?s :r ?o } WHERE { ?s :made ?o }`);
    expect(r.edges.find((e) => e.from === 'r1' && e.to === 'r0')).toBeUndefined();
  });

  it('treats an annotated triple as asserted, and its annotation as about the reifier', () => {
    const r = strat(`${PREFIX}
RULE { :a :made :b {| :src :x |} } WHERE { ?s :p ?o }
RULE { ?s :r ?o } WHERE { ?s :made ?o }
RULE { ?s :r2 ?o } WHERE { ?s :src ?o }`);
    expect(r.edges.find((e) => e.from === 'r1' && e.to === 'r0')).toBeDefined();
    expect(r.edges.find((e) => e.from === 'r2' && e.to === 'r0')).toBeDefined();
  });

  it('no longer matches a pattern against a collection as if it were a triple with no terms', () => {
    // syntax-template-15: the head is two reified triples.
    const r = strat(`${PREFIX}\nRULE { << :s :p :o >> :q << ?a ?b ?c >> } WHERE { ?a ?b ?c }`);
    const reasons = r.edges.flatMap((e) => e.reasons);
    for (const reason of reasons) {
      expect([reason.head.subject, reason.head.predicate, reason.head.object]).not.toContain('');
    }
    expect(reasons.map((reason) => reason.head.subject)).toContain('<< :s :p :o >>');
  });

  it('writes blank nodes and triple terms the way they were written', () => {
    const r = strat(`${PREFIX}
RULE { [] :q ?o } WHERE { ?s :p ?o }
RULE { _:b :q2 ?o } WHERE { ?s :q ?o }
RULE { :s :q3 <<( :a :b :c )>> } WHERE { ?s :q2 ?o }
RULE { ?s :r ?o } WHERE { ?s :q3 ?o }`);
    const head = (from: string, to: string) => r.edges.find((e) => e.from === from && e.to === to)?.reasons[0].head;
    expect(head('r1', 'r0')?.subject).toBe('[]');
    expect(head('r2', 'r1')?.subject).toBe('_:b');
    expect(head('r3', 'r2')?.object).toBe('<<( :a :b :c )>>');
  });
});

describe('SRL non-stratifiable witness', () => {
  it('explains W3C stratification-bad-04 with the two rules that make the loop', () => {
    const r = strat(`${PREFIX}
RULE { [] :q ?o } WHERE { ?s :p ?o }
RULE { ?s :p "Rule" } WHERE { ?s ?p "Rule" }
RULE { ?s :q "Rule" } WHERE { ?s :q ?o }`);
    const [cycle] = r.cycles;
    // All three are strongly connected…
    expect(cycle.rules).toEqual(['r0', 'r1', 'r2']);
    // …but the loop that shows the problem is r0 (run once) reading r1, which reads r0.
    expect(cycle.witness.map((e) => `${e.from}->${e.to}:${e.label}`)).toEqual(['r0->r1:closed', 'r1->r0:positive']);
    expect(cycle.witness[1].reasons[0].head.subject).toBe('[]');
  });

  it('is a path: each edge ends where the next begins, and it closes', () => {
    const r = strat(`${PREFIX}
RULE { ?s :a 1 } WHERE { ?s :c 1 . NOT { ?s :b 1 } }
RULE { ?s :b 1 } WHERE { ?s :a 1 }
RULE { ?s :c 1 } WHERE { ?s :b 1 }`);
    const { witness } = r.cycles[0];
    expect(witness.length).toBeGreaterThan(0);
    witness.forEach((edge, index) => expect(edge.to).toBe(witness[(index + 1) % witness.length].from));
    expect(witness.some((edge) => edge.label === 'negative')).toBe(true);
  });

  it('is the self-loop when a rule negates its own output', () => {
    const r = strat(`${PREFIX}\nRULE { ?s :p "ABC" } WHERE { ?s :data ?d . NOT { ?s :p "ABC" } }`);
    expect(r.cycles[0].witness.map((e) => `${e.from}->${e.to}`)).toEqual(['r0->r0']);
  });
});

describe('SRL stratification reasons', () => {
  it('states a reifier named twice (`~ :r {| … |}`) once', () => {
    const r = strat(`${PREFIX}\nRULE { :s :p :o ~:r1 {| :q1 :z1 |} } WHERE { ?a ?b ?c }`);
    const heads = r.edges.flatMap((e) => e.reasons).map((reason) => `${reason.head.subject} ${reason.head.predicate} ${reason.head.object}`);
    expect(new Set(heads).size).toBe(heads.length);
  });
});
