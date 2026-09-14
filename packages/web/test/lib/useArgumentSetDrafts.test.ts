import { describe, it, expect, beforeEach } from 'vitest';
import {
  useArgumentSetDrafts,
  newScratchId,
  ARGUMENT_SET_DRAFTS_STORAGE_KEY,
  SCRATCH_ID_PREFIX,
  type ArgumentSetDraftInput,
} from '@/composables/useArgumentSetDrafts';

function record(overrides: Partial<ArgumentSetDraftInput> = {}): ArgumentSetDraftInput {
  return {
    id: 'urn:ui-temp:argument-set:one',
    kind: 'scratch',
    scope: 'query',
    targetId: 'urn:query:cities',
    name: 'Untitled set 1',
    tupleBindings: [],
    scalarBindings: [],
    ...overrides,
  };
}

describe('useArgumentSetDrafts', () => {
  beforeEach(() => {
    localStorage.clear();
    useArgumentSetDrafts().clear();
  });

  it('round-trips a scratch set through storage', () => {
    useArgumentSetDrafts().save(record({ name: 'myargs' }));

    const reloaded = useArgumentSetDrafts();
    reloaded.reload();
    expect(reloaded.all.value).toHaveLength(1);
    expect(reloaded.all.value[0].name).toBe('myargs');
    expect(JSON.parse(localStorage.getItem(ARGUMENT_SET_DRAFTS_STORAGE_KEY) ?? '[]')).toHaveLength(1);
  });

  it('counts edits so the header can say how much is unsaved', () => {
    const store = useArgumentSetDrafts();
    store.save(record());
    expect(store.get(record().id)?.edits).toBe(0);
    store.save(record({ name: 'renamed' }));
    store.save(record({ name: 'renamed again' }));
    expect(store.get(record().id)?.edits).toBe(2);
  });

  it('scopes scratch sets to their target, newest first', () => {
    const store = useArgumentSetDrafts();
    store.save(record({ id: 'a', name: 'first' }));
    store.save(record({ id: 'b', name: 'second' }));
    store.save(record({ id: 'c', name: 'elsewhere', targetId: 'urn:query:other' }));

    const mine = store.scratchFor('urn:query:cities');
    expect(mine.map((entry) => entry.name)).toEqual(['second', 'first']);
    expect(store.scratchFor(null)).toEqual([]);
  });

  it('finds the draft layered on a saved set', () => {
    const store = useArgumentSetDrafts();
    store.save(record({ id: 'urn:set:1::draft', kind: 'draft', basedOn: 'urn:set:1', basedOnVersion: 2 }));

    expect(store.draftFor('urn:set:1')?.basedOnVersion).toBe(2);
    expect(store.draftFor('urn:set:2')).toBeNull();
    // A draft is not a scratch set and must never show up as one.
    expect(store.scratchFor('urn:query:cities')).toEqual([]);
  });

  it('drops records that do not parse rather than throwing', () => {
    localStorage.setItem(
      ARGUMENT_SET_DRAFTS_STORAGE_KEY,
      JSON.stringify([{ nonsense: true }, record({ id: 'good' })]),
    );
    const store = useArgumentSetDrafts();
    store.reload();
    expect(store.all.value.map((entry) => entry.id)).toEqual(['good']);
  });

  it('survives storage that is not an array at all', () => {
    localStorage.setItem(ARGUMENT_SET_DRAFTS_STORAGE_KEY, '{"not":"a list"}');
    const store = useArgumentSetDrafts();
    store.reload();
    expect(store.all.value).toEqual([]);
  });

  it('removes one record, or every record for a target', () => {
    const store = useArgumentSetDrafts();
    store.save(record({ id: 'a' }));
    store.save(record({ id: 'b' }));
    store.save(record({ id: 'c', targetId: 'urn:query:other' }));

    store.remove('a');
    expect(store.all.value.map((entry) => entry.id)).toEqual(['b', 'c']);

    store.removeForTarget('urn:query:cities');
    expect(store.all.value.map((entry) => entry.id)).toEqual(['c']);
  });

  it('mints distinct scratch ids carrying the temp marker', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newScratchId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.startsWith(SCRATCH_ID_PREFIX)).toBe(true);
  });
});
