import { describe, it, expect, beforeEach } from 'vitest';
import {
  nextUntitledName,
  useScratchItems,
  migratePlaygroundTabs,
  SCRATCH_MIGRATION_KEY,
} from '@/composables/useScratchItems';
import { useCallableDrafts, type CallableDraft } from '@/composables/useCallableDrafts';

function item(name: string): CallableDraft {
  return { name } as CallableDraft;
}

describe('nextUntitledName', () => {
  it('starts at 1', () => {
    expect(nextUntitledName([], 'query')).toBe('Untitled query 1');
  });

  it('takes the next free ordinal, not the count', () => {
    // 1 and 3 present with 2 discarded must give 4 — two rows called
    // "Untitled query 3" is how the wrong one gets thrown away.
    expect(nextUntitledName([item('Untitled query 1'), item('Untitled query 3')], 'query'))
      .toBe('Untitled query 4');
  });

  it('ignores names that merely start the same way', () => {
    expect(nextUntitledName([item('Untitled query 2 (copy)'), item('Untitled query')], 'query'))
      .toBe('Untitled query 1');
  });

  it('names by section', () => {
    expect(nextUntitledName([], 'rule')).toBe('Untitled rule set 1');
    expect(nextUntitledName([], 'etl')).toBe('Untitled pipeline 1');
  });
});

describe('scratch items', () => {
  beforeEach(() => {
    localStorage.clear();
    useCallableDrafts().clear();
  });

  it('creates an unassigned scratch record and returns it', () => {
    const created = useScratchItems('query').create('SELECT 1');

    expect(created.kind).toBe('scratch');
    expect(created.section).toBe('query');
    // Not library-scoped: the save moment picks the library, not creation.
    expect(created.libraryId).toBe('unassigned');
    expect(created.body).toBe('SELECT 1');
    expect(created.queryString).toBe('SELECT 1');
  });

  it('asks before discarding a body, and not before discarding nothing', () => {
    const scratch = useScratchItems('query');
    const empty = scratch.create('');
    const typed = scratch.create('ASK {}');

    expect(scratch.needsDiscardConfirm(empty.id)).toBe(false);
    expect(scratch.needsDiscardConfirm(typed.id)).toBe(true);
    // Whitespace is nothing.
    useCallableDrafts().save({ ...typed, body: '   ' });
    expect(scratch.needsDiscardConfirm(typed.id)).toBe(false);
  });
});

describe('playground tab migration', () => {
  beforeEach(() => {
    localStorage.clear();
    useCallableDrafts().clear();
  });

  it('converts tabs to scratch records, keeping names and times', () => {
    localStorage.setItem('playground.queries.v2.tabs', JSON.stringify([
      { id: 'tab-1', name: 'wikidata poke', content: { query: 'SELECT ?s {}' }, createdAt: 1754000000000, updatedAt: 1754000100000 },
    ]));

    expect(migratePlaygroundTabs()).toBe(1);

    const [record] = useCallableDrafts().scratchFor('query');
    expect(record!.name).toBe('wikidata poke');
    expect(record!.body).toBe('SELECT ?s {}');
    // The tab's own last-touched time, not the migration's: a tab last edited
    // weeks ago must not arrive looking like the newest thing in the list.
    expect(record!.updatedAt).toBe(new Date(1754000100000).toISOString());
    expect(record!.createdAt).toBe(new Date(1754000000000).toISOString());
  });

  it('skips the empty tab the strip always kept open', () => {
    localStorage.setItem('playground.queries.v2.tabs', JSON.stringify([
      { id: 'tab-1', name: 'Untitled Query', content: { query: '  ' }, createdAt: 1, updatedAt: 1 },
    ]));

    expect(migratePlaygroundTabs()).toBe(0);
    expect(useCallableDrafts().scratchFor('query')).toHaveLength(0);
  });

  it('carries rules tabs across as rule-section scratch', () => {
    localStorage.setItem('playground.rules.v2.tabs', JSON.stringify([
      { id: 'r1', name: 'transitive closure', content: { dataBlocks: ['a'], rules: ['b'] }, createdAt: 1, updatedAt: 1 },
    ]));

    migratePlaygroundTabs();
    const [record] = useCallableDrafts().scratchFor('rule');
    expect(record!.body).toEqual({ dataBlocks: ['a'], rules: ['b'] });
  });

  it('runs once, and leaves the old keys in place', () => {
    localStorage.setItem('playground.queries.v2.tabs', JSON.stringify([
      { id: 'tab-1', name: 'poke', content: { query: 'SELECT ?s {}' }, createdAt: 1, updatedAt: 1 },
    ]));

    expect(migratePlaygroundTabs()).toBe(1);
    expect(migratePlaygroundTabs()).toBe(0);
    expect(useCallableDrafts().scratchFor('query')).toHaveLength(1);
    expect(localStorage.getItem(SCRATCH_MIGRATION_KEY)).not.toBeNull();
    // Non-destructive: a rollback must not cost anyone their work.
    expect(localStorage.getItem('playground.queries.v2.tabs')).not.toBeNull();
  });

  it('ignores storage that is not a tab list rather than throwing', () => {
    localStorage.setItem('playground.queries.v2.tabs', '{ not json');
    expect(migratePlaygroundTabs()).toBe(0);
  });
});
