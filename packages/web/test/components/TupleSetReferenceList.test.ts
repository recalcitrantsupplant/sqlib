/**
 * How a linked tuple set reads beside the rows typed into the same clause
 * (issue #209 items 2 and 4).
 *
 * The point of drawing references apart from rows is that they behave
 * differently, so the list has to say *how*: a floating reference will take
 * whatever the set holds when it runs, a pinned one will not move, and a
 * reference contributing nothing — a deleted version, columns that line up with
 * nothing — has to say so rather than sit there looking healthy.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import TupleSetReferenceList from '@/components/query-work-area/TupleSetReferenceList.vue';

const store = vi.hoisted(() => ({
  resolveReferences: vi.fn(),
  tupleSetById: vi.fn(),
  tupleSetVersionById: vi.fn(),
  currentVersionIdOf: vi.fn(),
}));

vi.mock('@/composables/useTupleSetsStore', () => ({ useTupleSetsStore: () => store }));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: { value: 'urn:sqlib:library:lib1' } }),
}));

const CITIES = 'urn:sqlib:tupleSet:cities';
const V1 = 'urn:sqlib:tupleSetVersion:cities-1';
const V2 = 'urn:sqlib:tupleSetVersion:cities-2';

const set = (currentVersion: string | null) => ({ id: CITIES, name: 'Cities', currentVersion });

function version(id: string, versionNumber: number, columns = ['city'], rowCount = 3) {
  return {
    id,
    version: versionNumber,
    tupleColumns: columns,
    rowCount,
    contentString: JSON.stringify({ head: { vars: columns }, results: { bindings: [] } }),
  };
}

async function render(references: Array<Record<string, string>>, variables = ['city']) {
  const list = mount(TupleSetReferenceList, { props: { references, variables } });
  await flushPromises();
  return list;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resolveReferences.mockResolvedValue(undefined);
  store.tupleSetById.mockReturnValue(set(V2));
  store.tupleSetVersionById.mockImplementation((id: string) => {
    if (id === V1) return { set: set(V2), version: version(V1, 1) };
    if (id === V2) return { set: set(V2), version: version(V2, 2) };
    return null;
  });
});

describe('what the list says about a reference', () => {
  it('asks the store to load what it needs before describing anything', async () => {
    await render([{ tupleSetId: CITIES }]);
    expect(store.resolveReferences)
      .toHaveBeenCalledWith([{ tupleSetId: CITIES }], 'urn:sqlib:library:lib1');
  });

  it('names a floating reference and says it follows the set', async () => {
    const list = await render([{ tupleSetId: CITIES }]);
    const entry = list.get('[data-testid="tuple-set-reference"]');
    expect(entry.text()).toContain('Cities');
    expect(entry.text()).toContain('follows the set');
    expect(entry.text()).toContain('v2 now');
  });

  it('says which version a pinned reference is pinned to', async () => {
    const list = await render([{ tupleSetId: CITIES, versionId: V1 }]);
    expect(list.get('[data-testid="tuple-set-reference"]').text()).toContain('pinned to v1');
  });

  it('recovers the set behind a reference that carries only a version', async () => {
    // What a saved argument set returns: `tupleSetVersions` and nothing else.
    store.tupleSetById.mockReturnValue(null);
    const list = await render([{ versionId: V1 }]);
    expect(list.get('[data-testid="tuple-set-reference"]').text()).toContain('Cities');
  });

  it('reports the rows and columns the reference contributes', async () => {
    const list = await render([{ tupleSetId: CITIES, versionId: V1 }]);
    const text = list.get('[data-testid="tuple-set-reference"]').text();
    expect(text).toContain('3 rows');
    expect(text).toContain('?city');
  });
});

describe('when a reference contributes nothing', () => {
  it('says so when the pinned version has been deleted', async () => {
    store.tupleSetVersionById.mockReturnValue(null);
    const list = await render([{ tupleSetId: CITIES, versionId: 'urn:sqlib:tupleSetVersion:gone' }]);
    expect(list.get('.reference-warning').text()).toContain('no longer exists');
  });

  it('says so when the set has no saved version to follow', async () => {
    store.tupleSetById.mockReturnValue(set(null));
    store.tupleSetVersionById.mockReturnValue(null);
    const list = await render([{ tupleSetId: CITIES }]);
    expect(list.get('.reference-warning').text()).toContain('no saved version');
  });

  /*
   * Matching is by column name, and a set whose columns line up with none of
   * the clause's variables contributes nothing however many rows it holds.
   */
  it('says so when no column lines up with the clause', async () => {
    store.tupleSetVersionById.mockReturnValue({
      set: set(V2),
      version: version(V2, 2, ['country']),
    });
    const list = await render([{ tupleSetId: CITIES, versionId: V2 }], ['city']);
    expect(list.get('.reference-warning').text()).toContain('Nothing lines up');
  });
});

describe('the newer-version nudge', () => {
  it('offers to re-point a pin that is behind the set', async () => {
    const list = await render([{ tupleSetId: CITIES, versionId: V1 }]);
    expect(list.get('[data-testid="tuple-set-reference-repin"]').text()).toContain('v2 available');
  });

  /* The pin never moves on its own: the nudge asks, and the author answers. */
  it('moves the pin only when clicked, and only to the current version', async () => {
    const list = await render([{ tupleSetId: CITIES, versionId: V1 }]);
    await list.get('[data-testid="tuple-set-reference-repin"]').trigger('click');

    expect(list.emitted('repin')![0]).toEqual([{
      reference: { tupleSetId: CITIES, versionId: V1 },
      versionId: V2,
    }]);
  });

  it('stays quiet on a pin that is already current', async () => {
    const list = await render([{ tupleSetId: CITIES, versionId: V2 }]);
    expect(list.find('[data-testid="tuple-set-reference-repin"]').exists()).toBe(false);
  });

  it('stays quiet on a floating reference, which is never behind', async () => {
    const list = await render([{ tupleSetId: CITIES }]);
    expect(list.find('[data-testid="tuple-set-reference-repin"]').exists()).toBe(false);
  });
});

describe('unlinking', () => {
  it('emits the reference it was asked to remove, not its index', async () => {
    const list = await render([{ tupleSetId: CITIES, versionId: V1 }]);
    await list.get('[data-testid="tuple-set-reference-remove"]').trigger('click');

    expect(list.emitted('remove')![0]).toEqual([{ tupleSetId: CITIES, versionId: V1 }]);
  });

  it('draws nothing at all when a clause links no sets', async () => {
    const list = await render([]);
    expect(list.find('[data-testid="tuple-set-references"]').exists()).toBe(false);
  });
});
