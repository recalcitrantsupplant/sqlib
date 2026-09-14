/**
 * Materializing a tuple set version from an ETL run (issue #211), and the one
 * thing about it the browser has to read off the status line rather than the
 * body: whether a version was cut at all.
 *
 * A run that produced what the current version already holds answers 200 with
 * that version, and the body is indistinguishable from a 201's. So the
 * caller's "Saved" or "already holds" rests entirely on the status reaching
 * it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listTupleSets: vi.fn(),
  listTupleSetVersions: vi.fn(),
  createTupleSetVersionFromEtl: vi.fn(),
}));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

const LIBRARY = 'urn:sqlib:library:lib1';
const SET = 'urn:sqlib:tupleSet:cities';
const V1 = 'urn:sqlib:tupleSetVersion:cities-1';

/** The store's caches are module-level, so it is re-imported per test. */
let useTupleSetsStore: typeof import('@/composables/useTupleSetsStore')['useTupleSetsStore'];

const version1 = { id: V1, version: 1, rowCount: 2 };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  api.listTupleSets.mockResolvedValue([{ id: SET, name: 'Cities', currentVersion: V1 }]);
  api.listTupleSetVersions.mockResolvedValue([version1]);
  ({ useTupleSetsStore } = await import('@/composables/useTupleSetsStore'));
});

describe('createVersionFromEtl', () => {
  it('reports a cut version as not reused, and points the set at it', async () => {
    const v2 = { id: 'urn:sqlib:tupleSetVersion:cities-2', version: 2, rowCount: 3 };
    api.createTupleSetVersionFromEtl.mockResolvedValue({ data: v2, status: 201 });
    const store = useTupleSetsStore();
    await store.loadTupleSets({ library: LIBRARY });

    const result = await store.createVersionFromEtl(SET, { etlJobVersionId: 'urn:sqlib:etlJobVersion:j1' });

    expect(result).toEqual({ version: v2, reused: false });
    expect(store.tupleSets.value[0]?.currentVersion).toBe(v2.id);
  });

  it('reports a 200 as reused', async () => {
    api.createTupleSetVersionFromEtl.mockResolvedValue({ data: version1, status: 200 });
    const store = useTupleSetsStore();
    await store.loadTupleSets({ library: LIBRARY });

    const result = await store.createVersionFromEtl(SET, { etlJobVersionId: 'urn:sqlib:etlJobVersion:j1' });

    expect(result.reused).toBe(true);
    expect(result.version).toEqual(version1);
  });

  it('does not list the reused version twice', async () => {
    // The version answered by an unchanged re-run is one the cache may already
    // hold, unlike every other version this store records.
    api.createTupleSetVersionFromEtl.mockResolvedValue({ data: version1, status: 200 });
    const store = useTupleSetsStore();
    await store.loadTupleSets({ library: LIBRARY });
    await store.loadVersions(SET);

    await store.createVersionFromEtl(SET, { etlJobVersionId: 'urn:sqlib:etlJobVersion:j1' });

    expect(store.versionsFor(SET).value.filter(entry => entry.id === V1)).toHaveLength(1);
  });
});
