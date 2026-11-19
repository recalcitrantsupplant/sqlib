/**
 * The list controls of `lib/listPage.ts` (#197): filter, sort and cut a page.
 */
import { describe, it, expect } from 'vitest';
import { applyListPage, nameMatches, type ListPageQuery } from '../../src/lib/listPage.js';

const rows = [
  { $id: 'a', name: 'Perth stations', isPartOf: 'lib1', tags: ['t1'], dateModified: '2026-01-03T00:00:00Z', createdBy: 'urn:p:bo' },
  { $id: 'b', name: 'Hobart', isPartOf: ['lib1'], tags: ['t1', 't2'], dateModified: '2026-01-01T00:00:00Z' },
  { $id: 'c', name: 'adelaide', isPartOf: 'lib2', dateModified: '2026-01-02T00:00:00Z', createdBy: 'urn:p:al' },
];

const page = (query: Partial<ListPageQuery>) =>
  applyListPage(rows, { offset: 0, ...query }, { versionOf: (row) => ({ a: 3, b: 1 } as Record<string, number>)[row.$id] });
const ids = (query: Partial<ListPageQuery>) => page(query).items.map((row) => row.$id);

describe('applyListPage', () => {
  it('returns every row in input order when asked for nothing', () => {
    expect(page({})).toEqual({ items: rows, total: 3 });
  });

  it('cuts a page and counts every match', () => {
    expect(page({ sort: 'name', limit: 2 })).toMatchObject({ total: 3 });
    expect(ids({ sort: 'name', limit: 2 })).toEqual(['c', 'b']);
    expect(ids({ sort: 'name', limit: 2, offset: 2 })).toEqual(['a']);
  });

  it('filters by name, ids, library and every tag', () => {
    expect(ids({ q: 'pst' })).toEqual(['a']);
    expect(ids({ ids: ['c', 'a'] })).toEqual(['a', 'c']);
    expect(ids({ library: 'lib1' })).toEqual(['a', 'b']);
    expect(ids({ tags: ['t1', 't2'] })).toEqual(['b']);
  });

  it('keeps rows with any named tag under tagMatch any', () => {
    expect(ids({ tags: ['t2', 'tx'], tagMatch: 'any' })).toEqual(['b']);
    expect(ids({ tags: ['t1', 't2'], tagMatch: 'any' })).toEqual(['a', 'b']);
    expect(ids({ tags: ['t2', 'tx'], tagMatch: 'all' })).toEqual([]);
  });

  it('keeps only rows that also carry every withTag', () => {
    expect(ids({ tags: ['t1', 'tx'], tagMatch: 'any', withTags: ['t2'] })).toEqual(['b']);
    expect(ids({ withTags: ['t1'] })).toEqual(['a', 'b']);
  });

  it('sorts newest first by default for dates, and puts missing values last', () => {
    expect(ids({ sort: 'modified' })).toEqual(['a', 'c', 'b']);
    expect(ids({ sort: 'modified', order: 'asc' })).toEqual(['b', 'c', 'a']);
    expect(ids({ sort: 'creator' })).toEqual(['c', 'a', 'b']);
    expect(ids({ sort: 'creator', order: 'desc' })).toEqual(['a', 'c', 'b']);
    expect(ids({ sort: 'versions' })).toEqual(['a', 'b', 'c']);
  });
});

describe('nameMatches', () => {
  it('matches characters in order, ignoring case and spaces', () => {
    expect(nameMatches('qgrp', 'Query group')).toBe(true);
    expect(nameMatches('Per th', 'perth')).toBe(true);
    expect(nameMatches('htrp', 'Perth')).toBe(false);
  });
});
