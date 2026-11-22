/**
 * After the user picks another library, a screen closes what is open and opens
 * the new library's first row, or nothing when the list is empty. A library
 * set by the app itself (a record link) leaves the screen alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope } from 'vue';

const listLibraries = vi.fn();

vi.mock('../useApiClient.js', () => ({
  useApiClient: () => ({
    listLibraries,
    getLibrary: vi.fn(),
    createLibrary: vi.fn(),
    updateLibrary: vi.fn(),
    deleteLibrary: vi.fn(),
  }),
}));

const A = { id: 'urn:library:a', name: 'A' };
const B = { id: 'urn:library:b', name: 'B' };
const C = { id: 'urn:library:c', name: 'C' };

interface Row { id: string }

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function setUp(rowsFor: (libraryId: string) => Promise<Row[]>, scoped = () => true) {
  const { useLibrariesStore } = await import('../useLibrariesStore');
  await useLibrariesStore().loadLibraries();
  const { useActiveLibrary } = await import('../useActiveLibrary');
  const { useLibrarySwitchLanding } = await import('../useLibrarySwitchLanding');
  const active = useActiveLibrary();
  active.setActiveLibrary(A.id);

  const opened: string[] = [];
  const close = vi.fn();
  const scope = effectScope();
  const landing = scope.run(() => useLibrarySwitchLanding<Row>({
    scoped,
    close,
    rows: rowsFor,
    open: (row) => { opened.push(row.id); },
  }))!;
  return { active, landing, opened, close, scope };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  listLibraries.mockResolvedValue([A, B, C]);
});

describe('library switch landing', () => {
  it('closes the open entity and opens the first row of the new library', async () => {
    const { active, opened, close, landing } = await setUp(async (id) => (id === B.id ? [{ id: 'b1' }, { id: 'b2' }] : []));

    active.switchLibrary(B.id);
    expect(close).toHaveBeenCalledTimes(1);
    expect(landing.landing.value).toBe(true);
    await flush();

    expect(opened).toEqual(['b1']);
    expect(landing.landing.value).toBe(false);
    expect(active.activeLibraryId.value).toBe(B.id);
  });

  it('opens nothing when the new library has no rows', async () => {
    const { active, opened, close } = await setUp(async () => []);

    active.switchLibrary(B.id);
    await flush();

    expect(close).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([]);
  });

  it('opens the last library picked when two switches overlap', async () => {
    const slowB = deferred<Row[]>();
    const { active, opened } = await setUp((id) => (id === B.id ? slowB.promise : Promise.resolve([{ id: 'c1' }])));

    active.switchLibrary(B.id);
    active.switchLibrary(C.id);
    await flush();
    slowB.resolve([{ id: 'b1' }]);
    await flush();

    expect(opened).toEqual(['c1']);
  });

  it('leaves the screen alone when the library is set by the app', async () => {
    const { active, opened, close } = await setUp(async () => [{ id: 'b1' }]);

    active.setActiveLibrary(B.id);
    await flush();

    expect(close).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
  });

  it('leaves the screen alone when its list does not depend on the library', async () => {
    const { active, opened, close } = await setUp(async () => [{ id: 'x' }], () => false);

    active.switchLibrary(B.id);
    await flush();

    expect(close).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
  });

  it('ignores a pick of the library already active', async () => {
    const { active, close } = await setUp(async () => []);

    active.switchLibrary(A.id);

    expect(close).not.toHaveBeenCalled();
  });

  it('stops landing after the screen unmounts', async () => {
    const { active, close, scope } = await setUp(async () => []);

    scope.stop();
    active.switchLibrary(B.id);

    expect(close).not.toHaveBeenCalled();
  });
});
