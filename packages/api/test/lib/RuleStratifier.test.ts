import { describe, it, expect } from 'vitest';
import { RuleStratifier } from '../../src/lib/RuleStratifier.js';
import type { LdkitRuleVersion } from '../../src/persistence/schemas/RuleVersionSchema.js';

const PREFIX = 'PREFIX : <http://example/> ';

function rv(id: string, grammarType: string, ruleString: string): LdkitRuleVersion {
  return {
    $id: id,
    '@type': 'RuleVersion',
    isPartOf: 'r',
    version: 1,
    ruleString,
    grammarType,
  };
}

describe('RuleStratifier', () => {
  // NOTE: aggregation was dropped in the SRL rewrite (no SHACL engine / not
  // needed), so monotonicity is monotone|negation only.
  it('computes strata and monotonicity for mixed monotone/negation rules', () => {
    const stratifier = new RuleStratifier();
    const monotone = rv(
      'r1',
      'srl',
      `${PREFIX}RULE { ?s :p ?o } WHERE { ?s :p ?o }`,
    );
    const negation = rv(
      'r2',
      'srl',
      `${PREFIX}RULE { ?s :q ?o } WHERE { NOT { ?s :p ?o } }`,
    );

    const report = stratifier.analyzeRuleVersions([monotone, negation]);

    expect(report.issues).toEqual([]);
    expect(report.monotonicity).toEqual({
      r1: 'monotone',
      r2: 'negation',
    });
    expect(report.strata.r1).toBe(0);
    expect(report.strata.r2).toBeGreaterThan(report.strata.r1); // negative dependency on producer
    expect(report.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'r2',
          to: 'r1',
          label: 'negative',
          reasons: expect.arrayContaining([
            expect.objectContaining({
              body: { subject: '?s', predicate: '<http://example/p>', object: '?o' },
              head: { subject: '?s', predicate: '<http://example/p>', object: '?o' },
              label: 'negative',
            }),
          ]),
        }), // consumes :p from r1
      ]),
    );
  });

  it('flags non-stratifiable cycles with negation', () => {
    const stratifier = new RuleStratifier();
    const a = rv(
      'a',
      'rules-with-negation',
      `${PREFIX}RULE { ?s :a ?o } WHERE { NOT { ?s :b ?o } }`,
    );
    const b = rv(
      'b',
      'rules-with-negation',
      `${PREFIX}RULE { ?s :b ?o } WHERE { NOT { ?s :a ?o } }`,
    );

    const report = stratifier.analyzeRuleVersions([a, b]);
    expect(report.issues.some(issue => issue.toLowerCase().includes('non-stratifiable'))).toBe(true);
  });

  it('handles empty SRL rule bodies without throwing', () => {
    const stratifier = new RuleStratifier();
    const empty = rv('empty', 'shacl-rules', 'RULE {} WHERE {}');

    expect(() => stratifier.analyzeRuleVersions([empty])).not.toThrow();
  });

  it('keeps disconnected non-monotone rules in stratum 0', () => {
    const stratifier = new RuleStratifier();
    const neg = rv(
      'neg',
      'srl',
      `${PREFIX}RULE { ?s :q ?o } WHERE { NOT { ?s :p ?o } }`,
    );
    // Another negation rule over an unrelated predicate — disconnected from `neg`.
    const neg2 = rv(
      'neg2',
      'srl',
      `${PREFIX}RULE { ?s :count ?c } WHERE { ?s :r ?o . NOT { ?s :s ?o } }`,
    );

    const report = stratifier.analyzeRuleVersions([neg, neg2]);
    expect(report.issues).toEqual([]);
    expect(report.strata.neg).toBe(0);
    expect(report.strata.neg2).toBe(0);
  });

  it('keeps positive consumers of non-monotone producers in the same stratum', () => {
    const stratifier = new RuleStratifier();
    const nonMonoProducer = rv(
      'nonMonoProducer',
      'rules-with-negation',
      `${PREFIX}RULE { ?s :x ?o } WHERE { NOT { ?s :p ?o } }`,
    );
    const consumer = rv(
      'consumer',
      'shacl-rules',
      `${PREFIX}RULE { ?s :z ?o } WHERE { ?s :x ?o }`,
    );

    const report = stratifier.analyzeRuleVersions([nonMonoProducer, consumer]);
    expect(report.issues).toEqual([]);
    expect(report.strata.nonMonoProducer).toBe(0);
    expect(report.strata.consumer).toBe(0);
    expect(report.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'consumer',
          to: 'nonMonoProducer',
          label: 'positive',
        }),
      ]),
    );
  });

  it('treats positive-only cycles as stratifiable at same stratum', () => {
    const stratifier = new RuleStratifier();
    const a = rv(
      'a',
      'shacl-rules',
      `${PREFIX}RULE { ?s :a ?o } WHERE { ?s :b ?o }`,
    );
    const b = rv(
      'b',
      'shacl-rules',
      `${PREFIX}RULE { ?s :b ?o } WHERE { ?s :a ?o }`,
    );

    const report = stratifier.analyzeRuleVersions([a, b]);
    expect(report.issues).toEqual([]);
    expect(report.strata.a).toBe(0);
    expect(report.strata.b).toBe(0);
    expect(report.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'a', to: 'b', label: 'positive' }),
        expect.objectContaining({ from: 'b', to: 'a', label: 'positive' }),
      ]),
    );
  });

  it('uses negative label when both positive and negative evidence exist', () => {
    const stratifier = new RuleStratifier();
    const producer = rv(
      'producer',
      'shacl-rules',
      `${PREFIX}RULE { ?s :a ?o } WHERE { ?s :p ?o }`,
    );
    const mixedConsumer = rv(
      'mixed',
      'rules-with-negation',
      `${PREFIX}RULE { ?s :x ?o } WHERE { ?s :a ?o . NOT { ?s :a ?o } }`,
    );

    const report = stratifier.analyzeRuleVersions([producer, mixedConsumer]);
    expect(report.issues).toEqual([]);
    const edge = report.edges.find(e => e.from === 'mixed' && e.to === 'producer');
    expect(edge).toBeTruthy();
    expect(edge?.label).toBe('negative');
    expect(edge?.reasons?.some(r => r.label === 'positive')).toBe(true);
    expect(edge?.reasons?.some(r => r.label === 'negative')).toBe(true);
    expect(report.strata.producer).toBe(0);
    expect(report.strata.mixed).toBe(1);
  });
});

// An SRL document is a *ruleset*, so a ruleString may contain several rules.
// Analysing only the first would hide a NOT in a later rule from stratification.
describe('RuleStratifier - multi-rule ruleStrings', () => {
  it('sees negation in a later rule of the same version', () => {
    const stratifier = new RuleStratifier();
    const multi = rv(
      'rv1',
      'srl',
      `${PREFIX}RULE { ?s :q ?o } WHERE { ?s :p ?o }\nRULE { ?s :r ?o } WHERE { ?s :t ?o . NOT { ?s :q ?o } }`,
    );
    const report = stratifier.analyzeRuleVersions([multi]);
    // Previously reported 'monotone' because only rule 1 was parsed.
    expect(report.monotonicity.rv1).toBe('negation');
  });

  it('flags a version whose rules span multiple strata as unorderable', () => {
    const stratifier = new RuleStratifier();
    const multi = rv(
      'rv1',
      'srl',
      `${PREFIX}RULE { ?s :q ?o } WHERE { ?s :p ?o }\nRULE { ?s :r ?o } WHERE { ?s :t ?o . NOT { ?s :q ?o } }`,
    );
    const report = stratifier.analyzeRuleVersions([multi]);
    expect(report.issues.join(' ')).toMatch(/cannot be ordered independently/i);
    expect(report.issues.join(' ')).toMatch(/Split it into separate rules/i);
  });

  it('does not flag a multi-rule version whose rules share a stratum', () => {
    const stratifier = new RuleStratifier();
    const multi = rv(
      'rv1',
      'srl',
      `${PREFIX}RULE { ?s :q ?o } WHERE { ?s :p ?o }\nRULE { ?s :r ?o } WHERE { ?s :t ?o }`,
    );
    const report = stratifier.analyzeRuleVersions([multi]);
    expect(report.issues).toEqual([]);
    expect(report.strata.rv1).toBe(0);
  });

  it('stratifies the same rules correctly once split across versions', () => {
    const stratifier = new RuleStratifier();
    const producer = rv('rvA', 'srl', `${PREFIX}RULE { ?s :q ?o } WHERE { ?s :p ?o }`);
    const consumer = rv('rvB', 'srl', `${PREFIX}RULE { ?s :r ?o } WHERE { ?s :t ?o . NOT { ?s :q ?o } }`);
    const report = stratifier.analyzeRuleVersions([producer, consumer]);
    expect(report.issues).toEqual([]);
    expect(report.strata.rvB).toBeGreaterThan(report.strata.rvA);
    // Edges are reported per RuleVersion, not per internal rule index.
    expect(report.edges.some((e) => e.from === 'rvB' && e.to === 'rvA' && e.label === 'negative')).toBe(true);
  });
});
