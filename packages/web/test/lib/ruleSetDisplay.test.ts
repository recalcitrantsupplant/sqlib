import { describe, it, expect } from 'vitest';
import { nquadsAsTurtle, srlPrefixes, summarizeRuleRun } from '@/lib/ruleSetDisplay';

describe('srlPrefixes', () => {
  it('reads the PREFIX declarations of the prologue, including the empty prefix', () => {
    const srl = 'PREFIX ex: <http://example.org/>\nprefix : <http://base/>\n\nRULE { ?a ex:p ?b } WHERE { ?a ex:q ?b }';
    expect(srlPrefixes(srl)).toEqual({ ex: 'http://example.org/', '': 'http://base/' });
  });
});

describe('nquadsAsTurtle', () => {
  it('writes the triples with the given prefixes, grouped by subject', () => {
    const nquads = [
      '<http://example.org/b> <http://example.org/p> <http://example.org/c> .',
      '<http://example.org/a> <http://example.org/p> "x" .',
      '<http://example.org/a> <http://example.org/p> <http://example.org/c> <http://example.org/g> .',
    ].join('\n');
    const turtle = nquadsAsTurtle(nquads, { ex: 'http://example.org/' });
    expect(turtle).toContain('@prefix ex: <http://example.org/>.');
    expect(turtle!.indexOf('ex:a')).toBeLessThan(turtle!.indexOf('ex:b'));
    expect(turtle).not.toContain('ex:g');
  });

  it('returns null for content that does not parse', () => {
    expect(nquadsAsTurtle('not rdf', {})).toBeNull();
  });
});

describe('summarizeRuleRun', () => {
  it('sums each rule across iterations, in first-run order, named by the server', () => {
    const summary = summarizeRuleRun(
      [
        { rules: [{ ruleVersionId: 'v1', triplesInserted: 6 }, { ruleVersionId: 'v2', triplesInserted: 4, triplesDeleted: 1 }] },
        { rules: [{ ruleVersionId: 'v1', triplesInserted: 1 }, { ruleVersionId: 'v2', triplesInserted: 0 }] },
      ],
      { v1: 'rule-1-contains' },
    );
    expect(summary).toEqual({
      iterations: 2,
      rules: [
        { ruleVersionId: 'v1', name: 'rule-1-contains', inserted: 7, deleted: 0 },
        { ruleVersionId: 'v2', name: 'Rule 2', inserted: 4, deleted: 1 },
      ],
    });
  });

  it('falls back to the rule IRI before the position', () => {
    const summary = summarizeRuleRun([{ rules: [{ ruleVersionId: 'v1', ruleIri: 'http://example.org/r' }] }], null);
    expect(summary.rules[0]!.name).toBe('http://example.org/r');
  });
});
