/**
 * The System Library is the app describing itself, so it belongs on screen only
 * when Hofstadter mode is on. Every picker reads `visibleLibraries`; these tests
 * pin that filter and the switcher built on top of it, because the failure mode
 * is silent — a surface reading the raw list looks fine until someone saves
 * into the system library from it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SYSTEM_LIBRARY_ID } from '../../lib/constants';

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

const SYSTEM = { id: SYSTEM_LIBRARY_ID, name: 'System Library' };
const USER = { id: 'urn:library:mine', name: 'My Library' };

async function load() {
  const { useLibrariesStore } = await import('../useLibrariesStore');
  const { useSettings } = await import('../useSettings');
  const store = useLibrariesStore();
  await store.loadLibraries();
  return { store, settings: useSettings() };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  listLibraries.mockResolvedValue([SYSTEM, USER]);
});

describe('system library visibility', () => {
  it('hides the system library while Hofstadter mode is off', async () => {
    const { store } = await load();
    expect(store.libraries.value).toHaveLength(2);
    expect(store.visibleLibraries.value.map((library) => library.id)).toEqual([USER.id]);
  });

  it('shows it once Hofstadter mode is on', async () => {
    const { store, settings } = await load();
    settings.setHofstadterMode(true);
    expect(store.visibleLibraries.value.map((library) => library.id)).toEqual([SYSTEM.id, USER.id]);
  });

  it('keeps it out of the library switcher, so it cannot be saved into', async () => {
    const { settings } = await load();
    const { useActiveLibrary } = await import('../useActiveLibrary');
    const active = useActiveLibrary();

    expect(active.libraries.value.map((library) => library.id)).toEqual([USER.id]);
    // Selecting it while hidden falls back to a visible library rather than
    // leaving Save pointed at the system library.
    active.setActiveLibrary(SYSTEM_LIBRARY_ID);
    expect(active.activeLibraryId.value).toBe(USER.id);

    settings.setHofstadterMode(true);
    expect(active.activeLibraryId.value).toBe(SYSTEM_LIBRARY_ID);
  });
});
