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
