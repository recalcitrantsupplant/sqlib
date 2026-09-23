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
  getArgumentSet: vi.fn(),
  updateArgumentSet: vi.fn(),
  createArgumentSetVersion: vi.fn(),
}));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { useArgumentSets } = await import('@/composables/useArgumentSets');

const QUERY = 'urn:sqlib:query:q1';
const SCRATCH = 'urn:ui-temp:query-1';
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
    expect(api.listLibraryArgumentSets).not.toHaveBeenCalled();
  });

  /*
   * A scratch callable has no server id to ask about, and asking with the
   * scratch id would be asking about an entity the server has never seen. The
   * library's sets are the whole list it can have — and on a read-only
   * deployment, where nothing can be saved, the only list there is.
   */
  it('lists the library\'s sets for a scratch callable', async () => {
    api.listLibraryArgumentSets.mockResolvedValue([
      set('urn:sqlib:argument-set:seeded', 'Seeded', 'urn:sqlib:query:q2'),
    ]);

    const args = useArgumentSets(ref(''), 'query', () => LIBRARY, {
      scratchTargetId: () => SCRATCH,
    });
    await args.loadArgumentSets();

    expect(api.listArgumentSets).not.toHaveBeenCalled();
    expect(args.argumentSets.value.map((entry) => entry.id)).toEqual(['urn:sqlib:argument-set:seeded']);
  });
});

/**
 * Renaming a saved set.
 *
 * A name lives on the stable entity, so this writes through and no version is
 * involved. It used to write to the browser-local draft, which showed the new
 * name and then lost it: the save bar posts a version body carrying bindings
 * only, and the reload after the save re-read the server's unchanged name.
 */
describe('rename', () => {
  const SET = 'urn:sqlib:argument-set:s1';

  function openSaved() {
    const saved = { ...set(SET, 'Untitled set 1', QUERY), currentVersion: undefined };
    api.listArgumentSets.mockResolvedValue([saved]);
    api.listLibraryArgumentSets.mockResolvedValue([saved]);
    api.listArgumentSetVersions.mockResolvedValue([
      { id: `${SET}:v1`, isPartOf: SET, version: 1, tupleBindings: [], scalarBindings: [] },
    ]);
    api.getArgumentSet.mockImplementation(async () => ({ data: saved }));
    api.updateArgumentSet.mockImplementation(async (_id: string, input: { name?: string }) => {
      saved.name = input.name ?? saved.name;
      return { data: saved };
    });
    return saved;
  }

  it('writes the new name to the entity, not to a version', async () => {
    openSaved();
    const args = useArgumentSets(ref(QUERY), 'query', () => LIBRARY);
    await args.loadArgumentSets();
    await args.selectSet(SET);

    await args.rename('City seeds');

    expect(api.updateArgumentSet).toHaveBeenCalledWith(SET, { name: 'City seeds' });
    expect(api.createArgumentSetVersion).not.toHaveBeenCalled();
    expect(args.name.value).toBe('City seeds');
  });

  /* A rename is not an edit to the body, so it must not make the set dirty. */
  it('leaves the set clean', async () => {
    openSaved();
    const args = useArgumentSets(ref(QUERY), 'query', () => LIBRARY);
    await args.loadArgumentSets();
    await args.selectSet(SET);

    await args.rename('City seeds');

    expect(args.hasDraft.value).toBe(false);
  });

  it('keeps the new name across a later save', async () => {
    openSaved();
    api.createArgumentSetVersion.mockResolvedValue({ data: { id: `${SET}:v2`, version: 2 } });
    const args = useArgumentSets(ref(QUERY), 'query', () => LIBRARY);
    await args.loadArgumentSets();
    await args.selectSet(SET);

    await args.rename('City seeds');
    expect(await args.save()).toBe(true);

    expect(args.name.value).toBe('City seeds');
  });

  it('puts the old name back when the write is refused', async () => {
    openSaved();
    api.updateArgumentSet.mockRejectedValue(new Error('403'));
    const args = useArgumentSets(ref(QUERY), 'query', () => LIBRARY);
    await args.loadArgumentSets();
    await args.selectSet(SET);

    expect(await args.rename('City seeds')).toBe(false);
    expect(args.name.value).toBe('Untitled set 1');
    expect(args.error.value).toBe('403');
  });

  /* A scratch set has no server identity to rename. */
  it('keeps a scratch set local', async () => {
    api.listArgumentSets.mockResolvedValue([]);
    api.listLibraryArgumentSets.mockResolvedValue([]);
    const args = useArgumentSets(ref(QUERY), 'query', () => LIBRARY);
    await args.loadArgumentSets();
    args.createScratch();

    await args.rename('Local name');

    expect(api.updateArgumentSet).not.toHaveBeenCalled();
    expect(args.name.value).toBe('Local name');
  });
});
