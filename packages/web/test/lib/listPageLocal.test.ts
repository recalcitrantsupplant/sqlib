/**
 * The list controls applied in the browser, for an answer with no
 * `X-Total-Count` (#197).
 */
import { describe, it, expect } from 'vitest';
import { applyListPageLocally } from '@/lib/listPageLocal';

const rows = [
  { id: 'a', name: 'Perth stations', isPartOf: ['lib1'], tags: ['t1'], dateModified: '2026-01-03T00:00:00Z' },
  { id: 'b', name: 'Hobart', isPartOf: 'lib1', tags: [], dateModified: '2026-01-01T00:00:00Z' },
  { id: 'c', name: 'Adelaide', libraryId: 'lib2', dateModified: '2026-01-02T00:00:00Z' },
];

describe('applyListPageLocally', () => {
  it('filters by library, ids, tag and name, and counts the matches', () => {
    expect(applyListPageLocally(rows, { library: 'lib1' }).items.map((row) => row.id)).toEqual(['a', 'b']);
    expect(applyListPageLocally(rows, { library: 'lib2' }).items.map((row) => row.id)).toEqual(['c']);
    expect(applyListPageLocally(rows, { ids: ['c'] }).items.map((row) => row.id)).toEqual(['c']);
    expect(applyListPageLocally(rows, { tag: ['t1'] }).items.map((row) => row.id)).toEqual(['a']);
    expect(applyListPageLocally(rows, { q: 'pst' })).toEqual({ items: [rows[0]], total: 1 });
  });

  it('sorts and cuts the page', () => {
    const page = applyListPageLocally(rows, { sort: 'modified', limit: 2, offset: 0 });
    expect(page.items.map((row) => row.id)).toEqual(['a', 'c']);
    expect(page.total).toBe(3);
    expect(applyListPageLocally(rows, { sort: 'name', limit: 2, offset: 2 }).items.map((row) => row.id)).toEqual(['a']);
  });
});
