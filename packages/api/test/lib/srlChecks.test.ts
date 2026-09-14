import { describe, it, expect } from 'vitest';
import { runSrlCheck, isSrlCheck, SRL_CHECKS } from '../../src/lib/srlChecks.js';
import { compareAnalysis } from '../../src/lib/testComparators.js';

const PREFIX = 'PREFIX : <http://ex/>';

describe('runSrlCheck', () => {
  it('accepts a document that parses', () => {
    const verdict = runSrlCheck(`${PREFIX}\nRULE { ?x :reaches ?y } WHERE { ?x :edge ?y }`, 'syntax');
    expect(verdict).toMatchObject({ check: 'syntax', accepted: true, reason: '' });
  });

  it('rejects one that does not, and says why', () => {
    const verdict = runSrlCheck(`${PREFIX}\nRULE { ?x :reaches ?y } WHERE {`, 'syntax');
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).not.toBe('');
  });

  it('treats a document with no rules as legal', () => {
    // Three positive syntax tests in the W3C suite are exactly this — one of
    // them a zero-byte file — so an empty-text guard here would fail the suite
    // on documents the spec says are fine.
    expect(runSrlCheck('', 'syntax').accepted).toBe(true);
    expect(runSrlCheck(`${PREFIX}\n`, 'syntax').accepted).toBe(true);
  });

  it('does not parse the tuples extension, so our own syntax stays non-conformant', () => {
    // TUPLE(…) is ours, not the spec's. Accepting it under a conformance check
    // would report conformance we do not have.
    const verdict = runSrlCheck(`${PREFIX}\nRULE { ?x :p ?y } WHERE { TUPLE(:t ?x ?y) }`, 'syntax');
    expect(verdict.accepted).toBe(false);
  });

  it('separates parsing from well-formedness', () => {
    // Legal syntax, re-binding an already-bound variable: the syntax check
    // accepts it and the well-formedness check does not. Conflating the two is
    // what the named check exists to prevent.
    const document = `${PREFIX}\nRULE { ?s :p ?o } WHERE { ?s :q ?o . SET (?o := 1) }`;
    expect(runSrlCheck(document, 'syntax').accepted).toBe(true);
    expect(runSrlCheck(document, 'wellformed').accepted).toBe(false);
  });

  it('reports a document that cannot be stratified', () => {
    const document = `${PREFIX}\nRULE { ?x :p ?y } WHERE { ?x :edge ?y . NOT { ?x :p ?y } }`;
    const verdict = runSrlCheck(document, 'stratification');
    expect(verdict.check).toBe('stratification');
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).not.toBe('');
  });

  it('names every check it knows', () => {
    expect(SRL_CHECKS.every(isSrlCheck)).toBe(true);
    expect(isSrlCheck('execution')).toBe(false);
  });
});

describe('compareAnalysis', () => {
  const accepted = { check: 'syntax' as const, accepted: true, reason: '' };
  const rejected = { check: 'syntax' as const, accepted: false, reason: 'Unexpected token' };

  it('passes when the check said what the test expected', () => {
    expect(compareAnalysis(accepted, '{"check":"syntax","accepted":true}').passed).toBe(true);
    expect(compareAnalysis(rejected, '{"check":"syntax","accepted":false}').passed).toBe(true);
  });

  it('carries the reason when something expected to be accepted was not', () => {
    const result = compareAnalysis(rejected, '{"check":"syntax","accepted":true}');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Unexpected token');
  });

  it('says plainly when something expected to be rejected was accepted', () => {
    const result = compareAnalysis(accepted, '{"check":"syntax","accepted":false}');
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/reject the document, but it was accepted/);
  });

  it('refuses to judge when a different check was run', () => {
    // Not a pass: "accepted" is three different claims, and matching the wrong
    // one would report conformance the test never asserted.
    const result = compareAnalysis(accepted, '{"check":"stratification","accepted":true}');
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/Expected the stratification check/);
  });

  it('rejects a malformed expectation rather than reading past it', () => {
    expect(compareAnalysis(accepted, 'not json').message).toMatch(/not valid JSON/);
    expect(compareAnalysis(accepted, '{"accepted":true}').message).toMatch(/needs \{"check"/);
    expect(compareAnalysis(accepted, '{"check":"syntax"}').message).toMatch(/needs \{"check"/);
  });
});
