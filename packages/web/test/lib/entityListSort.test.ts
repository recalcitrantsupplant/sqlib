import { describe, it, expect } from 'vitest';
import { normalizeSort, sortEntities, DEFAULT_SORT } from '@/lib/entityListSort';

const ROWS = [
  { id: 'a', name: 'beta', dateCreated: '2026-10-01T00:00:00Z', dateModified: '2026-11-10T00:00:00Z', createdBy: 'urn:u:sam', currentVersionNumber: 2 },
  { id: 'b', name: 'Alpha', dateCreated: '2026-09-01T00:00:00Z', dateModified: '2026-11-15T00:00:00Z', createdBy: 'urn:u:ann', currentVersionNumber: 7 },
  { id: 'c', name: 'gamma', dateCreated: null, dateModified: null, createdBy: null, currentVersionNumber: null },
  { id: 'd', name: 'delta', dateCreated: '2026-11-01T00:00:00Z', dateModified: '2026-11-01T00:00:00Z', createdBy: 'urn:u:ann', currentVersionNumber: 1 },
];
const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id).join('');

describe('sortEntities', () => {
  it('sorts by name without case, A to Z and Z to A', () => {
    expect(ids(sortEntities(ROWS, DEFAULT_SORT))).toBe('badc');
    expect(ids(sortEntities(ROWS, { key: 'name', dir: 'desc' }))).toBe('cdab');
  });

  it('puts the newest modified first and rows without a date last', () => {
    expect(ids(sortEntities(ROWS, { key: 'modified', dir: 'desc' }))).toBe('badc');
    expect(ids(sortEntities(ROWS, { key: 'modified', dir: 'asc' }))).toBe('dabc');
  });

  it('sorts by created date', () => {
    expect(ids(sortEntities(ROWS, { key: 'created', dir: 'desc' }))).toBe('dabc');
  });

  it('sorts by creator display name, then by entity name', () => {
    const names: Record<string, string> = { 'urn:u:sam': 'Sam', 'urn:u:ann': 'Ann' };
    const sorted = sortEntities(ROWS, { key: 'creator', dir: 'asc' }, { nameOf: (iri) => names[iri] });
    expect(ids(sorted)).toBe('bdac');
  });

  it('sorts by last opened in this browser', () => {
    const opened: Record<string, number> = { c: 30, a: 10 };
    const sorted = sortEntities(ROWS, { key: 'opened', dir: 'desc' }, { openedAt: (id) => opened[id] });
    expect(ids(sorted)).toBe('cabd');
  });

  it('sorts by version count', () => {
    expect(ids(sortEntities(ROWS, { key: 'versions', dir: 'desc' }))).toBe('badc');
  });
});

describe('normalizeSort', () => {
  it('reads an unknown key as the default', () => {
    expect(normalizeSort({ key: 'colour', dir: 'asc' })).toEqual(DEFAULT_SORT);
    expect(normalizeSort(null)).toEqual(DEFAULT_SORT);
  });

  it('gives a known key its own direction when the stored one is bad', () => {
    expect(normalizeSort({ key: 'modified', dir: 'up' })).toEqual({ key: 'modified', dir: 'desc' });
  });
});
