/**
 * Which argument sets a callable's switcher offers.
 *
 * It used to list only sets whose `targetEntity` was this callable, which made
 * the fits/partial/mismatch verdict beside each row incapable of saying
 * anything but "fits" — there was nothing else in the list to judge. Scope has
 * always been provenance rather than a fence, and the query arguments design
 * wanted this listing and could not have it before `GET /argument-sets?libraryId=`
 * existed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

const api = vi.hoisted(() => ({
  listArgumentSets: vi.fn(),
  listLibraryArgumentSets: vi.fn(),
  listArgumentSetVersions: vi.fn(),
}));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { useArgumentSets } = await import('@/composables/useArgumentSets');

const QUERY = 'urn:sqlib:query:q1';
const LIBRARY = 'urn:sqlib:library:lib1';

function set(id: string, name: string, targetId: string | null) {
  return {
    id, name, targetId, scope: 'query' as const, libraryId: LIBRARY,
    tupleBindings: [], scalarBindings: [], dateCreated: '', dateModified: '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listArgumentSetVersions.mockResolvedValue([]);
});

describe('loadArgumentSets', () => {
  it('lists this callable\'s sets and the library\'s, without duplicating', async () => {
    const own = set('urn:sqlib:argument-set:mine', 'Made here', QUERY);
    api.listArgumentSets.mockResolvedValue([own]);
    api.listLibraryArgumentSets.mockResolvedValue([
      own,
      set('urn:sqlib:argument-set:other', 'Made elsewhere', 'urn:sqlib:query:q2'),
    ]);

    const args = useArgumentSets(ref(QUERY), 'query', () => LIBRARY);
    await args.loadArgumentSets();

    expect(args.argumentSets.value.map((entry) => entry.id)).toEqual([
      'urn:sqlib:argument-set:mine',
      'urn:sqlib:argument-set:other',
    ]);
  });

  it('puts this callable\'s sets first, whatever order the library returns', async () => {
    api.listArgumentSets.mockResolvedValue([set('urn:sqlib:argument-set:mine', 'Made here', QUERY)]);
    api.listLibraryArgumentSets.mockResolvedValue([
      set('urn:sqlib:argument-set:a', 'A', 'urn:sqlib:query:q2'),
      set('urn:sqlib:argument-set:mine', 'Made here', QUERY),
    ]);

    const args = useArgumentSets(ref(QUERY), 'query', () => LIBRARY);
    await args.loadArgumentSets();

    expect(args.argumentSets.value[0].id).toBe('urn:sqlib:argument-set:mine');
  });

  /*
   * Losing the sets made on this very screen would be worse than not offering
   * the others, so the library read is best-effort.
   */
  it('keeps the target-scoped list when the library listing fails', async () => {
    api.listArgumentSets.mockResolvedValue([set('urn:sqlib:argument-set:mine', 'Made here', QUERY)]);
    api.listLibraryArgumentSets.mockRejectedValue(new Error('nope'));

    const args = useArgumentSets(ref(QUERY), 'query', () => LIBRARY);
    await args.loadArgumentSets();

    expect(args.argumentSets.value.map((entry) => entry.id)).toEqual(['urn:sqlib:argument-set:mine']);
    expect(args.error.value).toBeNull();
  });

  /* A caller that passes no library gets what this always returned. */
  it('does not reach for the library when none is given', async () => {
    api.listArgumentSets.mockResolvedValue([set('urn:sqlib:argument-set:mine', 'Made here', QUERY)]);

    const args = useArgumentSets(ref(QUERY), 'query');
    await args.loadArgumentSets();

    expect(api.listLibraryArgumentSets).not.toHaveBeenCalled();
    expect(args.argumentSets.value).toHaveLength(1);
  });

  it('lists nothing when there is no callable open', async () => {
    const args = useArgumentSets(ref(null), 'query', () => LIBRARY);
    await args.loadArgumentSets();

    expect(args.argumentSets.value).toEqual([]);
    expect(api.listArgumentSets).not.toHaveBeenCalled();
  });
});
