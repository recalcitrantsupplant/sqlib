import { describe, it, expect, beforeEach } from 'vitest';
import {
  useArgumentSetDrafts,
  newScratchId,
  ARGUMENT_SET_DRAFTS_STORAGE_KEY,
  SCRATCH_ID_PREFIX,
  type ArgumentSetDraftInput,
} from '@/composables/useArgumentSetDrafts';
import { useCallableDrafts, CALLABLE_DRAFTS_STORAGE_KEY } from '@/composables/useCallableDrafts';

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
    useCallableDrafts().clear();
  });

  it('round-trips a scratch set through storage', () => {
    useArgumentSetDrafts().save(record({ name: 'myargs' }));

    const reloaded = useArgumentSetDrafts();
    reloaded.reload();
    expect(reloaded.all.value).toHaveLength(1);
    expect(reloaded.all.value[0].name).toBe('myargs');
    expect(JSON.parse(localStorage.getItem(ARGUMENT_SET_DRAFTS_STORAGE_KEY) ?? '[]')).toHaveLength(1);
  });

  /*
   * The bug this module was rewritten for: the query screen wrote to one store
   * and the rail read another, so a set made on a query never reached the rail
   * in that session — and only appeared after a reload, because the legacy-key
   * migration runs at module load.
   */
  it('writes where the rail reads, with no reload in between', () => {
    useArgumentSetDrafts().save(record({ id: 'urn:ui-temp:argument-set:rail', name: 'seen by the rail' }));

    const rail = useCallableDrafts().scratchFor('argumentSet');
    expect(rail.map((entry) => entry.name)).toEqual(['seen by the rail']);
    expect(localStorage.getItem(ARGUMENT_SET_DRAFTS_STORAGE_KEY)).toBe(
      localStorage.getItem(CALLABLE_DRAFTS_STORAGE_KEY),
    );
  });

  it('keeps graph bindings, which a group set is mostly made of', () => {
    const store = useArgumentSetDrafts();
    store.save(record({ scope: 'queryGroup', graphBindings: [{ position: 0, dataGraphVersionId: 'urn:dgv:1' }] }));
    store.reload();
    expect(store.get(record().id)?.graphBindings).toEqual([{ position: 0, dataGraphVersionId: 'urn:dgv:1' }]);
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
