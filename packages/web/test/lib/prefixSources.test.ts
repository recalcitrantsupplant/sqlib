import { describe, it, expect } from 'vitest';
import {
  parsePrefixSource,
  prefixSourceLabel,
  prefixSourceRoute,
  prefixSourceToken,
} from '@/lib/prefixSources';

describe('prefixSources', () => {
  it('round-trips a saved entity', () => {
    const token = prefixSourceToken('rule-set', 'urn:sqlib:ruleset:1')!;
    const source = parsePrefixSource(token)!;

    expect(source).toEqual({ kind: 'rule-set', id: 'urn:sqlib:ruleset:1', draft: false });
    expect(prefixSourceLabel(source)).toBe('Rule set');
    expect(prefixSourceRoute(source)).toEqual({
      path: '/',
      query: { ruleSet: 'urn:sqlib:ruleset:1' },
    });
  });

  it('names an unsaved item by what it is, and still links to it', () => {
    const source = parsePrefixSource(prefixSourceToken('query', 'urn:ui-temp:abc')!)!;

    expect(source.draft).toBe(true);
    expect(prefixSourceLabel(source)).toBe('Query (draft)');
    expect(prefixSourceRoute(source)).toEqual({ path: '/', query: { scratch: 'urn:ui-temp:abc' } });
  });

  it('records nothing for an item with no id yet', () => {
    expect(prefixSourceToken('query', null)).toBeNull();
    expect(prefixSourceToken('query', '')).toBeNull();
  });

  it('reads the shapes older builds wrote', () => {
    expect(parsePrefixSource('urn:sqlib:query:7')).toEqual({
      kind: 'query',
      id: 'urn:sqlib:query:7',
      draft: false,
    });
    expect(parsePrefixSource('rule-set:urn:sqlib:ruleset:7')).toEqual({
      kind: 'rule-set',
      id: 'urn:sqlib:ruleset:7',
      draft: false,
    });
    // The one this changes: a scratch rule set reads as a rule set.
    const legacyScratch = parsePrefixSource('scratch:rules:urn:ui-temp:9')!;
    expect(legacyScratch.kind).toBe('rule-set');
    expect(prefixSourceLabel(legacyScratch)).toBe('Rule set (draft)');
    expect(prefixSourceRoute(legacyScratch)).toEqual({
      path: '/',
      query: { scratch: 'urn:ui-temp:9' },
    });
  });

  it('leaves an unrecognised token alone', () => {
    expect(parsePrefixSource('some-backend-id')).toBeNull();
    expect(parsePrefixSource('')).toBeNull();
    expect(parsePrefixSource(null)).toBeNull();
  });

  it('has no route for a response, which is not a place', () => {
    const source = parsePrefixSource(prefixSourceToken('results', 'backend-1')!)!;
    expect(prefixSourceLabel(source)).toBe('Query results');
    expect(prefixSourceRoute(source)).toBeNull();
  });
});
