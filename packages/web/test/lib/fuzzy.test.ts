import { describe, it, expect } from 'vitest';
import { fuzzyFilter, fuzzyMatches } from '@/lib/fuzzy';

const QUERIES = [
  { name: 'Reaches' },
  { name: 'query-group smoke' },
  { name: 'settings audit', description: 'counts every reachable node' },
];

describe('fuzzyFilter — the ranked form, for choosers', () => {
  it('returns everything in the caller’s order for an empty query', () => {
    expect(fuzzyFilter('  ', QUERIES, (q) => q.name).map((m) => m.item.name)).toEqual([
      'Reaches',
      'query-group smoke',
      'settings audit',
    ]);
  });

  it('matches a subsequence and marks the characters that hit', () => {
    const [match, ...rest] = fuzzyFilter('qgrp', QUERIES, (q) => q.name);
    expect(rest).toHaveLength(0);
    expect(match.item.name).toBe('query-group smoke');
    expect(match.segments.filter((s) => s.matched).map((s) => s.text).join('')).toBe('qgrp');
  });

  it('ranks best-first rather than in list order', () => {
    expect(fuzzyFilter('set', QUERIES, (q) => q.name)[0].item.name).toBe('settings audit');
  });
});

describe('fuzzyMatches — the predicate, for panes that keep their order', () => {
  it('keeps every row while the box is empty', () => {
    expect(fuzzyMatches('', 'anything')).toBe(true);
    expect(fuzzyMatches('   ', 'anything')).toBe(true);
  });

  it('matches a subsequence of the name, not just a substring', () => {
    expect(fuzzyMatches('qgrp', 'query-group smoke')).toBe(true);
    expect(fuzzyMatches('smoke', 'query-group smoke')).toBe(true);
    expect(fuzzyMatches('zzz', 'query-group smoke')).toBe(false);
  });

  it('is case-insensitive, like the box that feeds it', () => {
    expect(fuzzyMatches('REACH', 'Reaches')).toBe(true);
  });

  it('falls back to a literal substring of a detail — a description, an endpoint', () => {
    expect(fuzzyMatches('reachable', 'settings audit', 'counts every reachable node')).toBe(true);
    // …but only literally: a subsequence spread across prose matches anything.
    expect(fuzzyMatches('cvrn', 'settings audit', 'counts every reachable node')).toBe(false);
  });

  it('tolerates the details a row may not carry', () => {
    expect(fuzzyMatches('zzz', 'name', null, undefined)).toBe(false);
    expect(fuzzyMatches('name', 'name', null)).toBe(true);
  });
});
