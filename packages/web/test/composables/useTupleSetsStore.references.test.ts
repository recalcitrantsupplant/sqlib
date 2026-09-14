/**
 * Finding the tuple set behind a reference (issue #209).
 *
 * A reference attached in the browser names its set, so resolving it is one
 * request. A reference read back off a saved argument set names only the pinned
 * *version*, and there is no route from a version IRI to its set — the only
 * listing is `GET /tuple-sets/:id/versions`. So the sets are walked until the
 * wanted versions turn up, and the two things that matter are that the walk
 * stops as soon as it can and that it never repeats work the cache already has.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listTupleSets: vi.fn(),
  listTupleSetVersions: vi.fn(),
}));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

const LIBRARY = 'urn:sqlib:library:lib1';
const CITIES = 'urn:sqlib:tupleSet:cities';
const COUNTRIES = 'urn:sqlib:tupleSet:countries';
const CITIES_V1 = 'urn:sqlib:tupleSetVersion:cities-1';
const COUNTRIES_V1 = 'urn:sqlib:tupleSetVersion:countries-1';

const versionsOf: Record<string, Array<{ id: string; version: number }>> = {
  [CITIES]: [{ id: CITIES_V1, version: 1 }],
  [COUNTRIES]: [{ id: COUNTRIES_V1, version: 1 }],
};

/**
 * The store's caches are module-level, so the module is re-imported per test —
 * a version cached by one test would otherwise answer another test's lookup and
 * hide the request it was asserting on.
 */
let useTupleSetsStore: typeof import('@/composables/useTupleSetsStore')['useTupleSetsStore'];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  api.listTupleSets.mockResolvedValue([
    { id: CITIES, name: 'Cities', currentVersion: CITIES_V1 },
    { id: COUNTRIES, name: 'Countries', currentVersion: COUNTRIES_V1 },
  ]);
  api.listTupleSetVersions.mockImplementation(async (id: string) => versionsOf[id] ?? []);
  ({ useTupleSetsStore } = await import('@/composables/useTupleSetsStore'));
  await useTupleSetsStore().loadTupleSets({ library: LIBRARY });
  vi.clearAllMocks();
  api.listTupleSetVersions.mockImplementation(async (id: string) => versionsOf[id] ?? []);
});

describe('resolveReferences', () => {
  it('does nothing at all when a clause links no sets', async () => {
    await useTupleSetsStore().resolveReferences([]);
    expect(api.listTupleSetVersions).not.toHaveBeenCalled();
  });

  it('loads the versions of a set named directly', async () => {
    const store = useTupleSetsStore();
    await store.resolveReferences([{ tupleSetId: CITIES }], LIBRARY);

    expect(api.listTupleSetVersions).toHaveBeenCalledWith(CITIES);
    expect(store.tupleSetVersionById(CITIES_V1)?.set?.name).toBe('Cities');
  });

  it('walks the library to place a reference that carries only a version', async () => {
    const store = useTupleSetsStore();
    await store.resolveReferences([{ versionId: COUNTRIES_V1 }], LIBRARY);

    expect(store.tupleSetVersionById(COUNTRIES_V1)?.set?.id).toBe(COUNTRIES);
  });

  it('stops walking once every wanted version has been found', async () => {
    const store = useTupleSetsStore();
    await store.resolveReferences([{ versionId: CITIES_V1 }], LIBRARY);

    // `cities` is listed first and answers the only outstanding version, so the
    // second set is never asked for.
    expect(api.listTupleSetVersions).toHaveBeenCalledTimes(1);
    expect(api.listTupleSetVersions).toHaveBeenCalledWith(CITIES);
  });

  it('asks again for nothing the cache already holds', async () => {
    const store = useTupleSetsStore();
    await store.resolveReferences([{ tupleSetId: CITIES }], LIBRARY);
    api.listTupleSetVersions.mockClear();

    await store.resolveReferences([{ tupleSetId: CITIES }, { versionId: CITIES_V1 }], LIBRARY);
    expect(api.listTupleSetVersions).not.toHaveBeenCalled();
  });

  /*
   * Best-effort by construction: a set whose versions cannot be read leaves its
   * references undescribed rather than failing the panel drawn around them.
   */
  it('leaves a reference undescribed rather than throwing', async () => {
    api.listTupleSetVersions.mockRejectedValue(new Error('backend unreachable'));
    const store = useTupleSetsStore();

    await expect(store.resolveReferences([{ tupleSetId: CITIES }], LIBRARY)).resolves.toBeUndefined();
    expect(store.tupleSetVersionById(CITIES_V1)).toBeNull();
  });

  it('reports where a floating reference points right now', async () => {
    const store = useTupleSetsStore();
    expect(store.currentVersionIdOf(CITIES)).toBe(CITIES_V1);
    expect(store.currentVersionIdOf('urn:sqlib:tupleSet:absent')).toBeNull();
  });
});
