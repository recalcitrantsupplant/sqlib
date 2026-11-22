/**
 * The library the workspace is currently pointed at.
 *
 * A library contains queries, groups, rules and ETL, so it is one level up
 * from all of them and must not render as another filter inside any one list
 * (nav doc §2, addendum 4). That makes it app state rather than list state: the
 * switcher at the head of the nav rail sets it, every list and screen reads it,
 * and — the reason it is shared at all — saving a scratch item puts the new
 * entity in it.
 *
 * Scratch items are deliberately *not* scoped by it. They read `unassigned`
 * until the save moment, so switching libraries changes the saved list and
 * leaves the scratch cluster alone.
 */
import { ref, computed, watch, getCurrentScope, onScopeDispose } from 'vue';
import { useLibrariesStore } from './useLibrariesStore';

const STORAGE_KEY = 'sparql-query-lib-active-library';

function readStored(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

// Module-level: the strip, the saved list and Save are one selection.
const activeLibraryId = ref<string | null>(readStored());
let watching = false;

/** What each open screen does when the user picks another library. */
type SwitchHandler = (libraryId: string) => void;
const switchHandlers = new Set<SwitchHandler>();

export function useActiveLibrary() {
  const librariesStore = useLibrariesStore();

  if (!watching) {
    watching = true;
    watch(activeLibraryId, (id) => {
      if (typeof localStorage === 'undefined') return;
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    });
  }

  /**
   * The libraries the switcher offers.
   *
   * Hofstadter mode is what decides whether the System Library is one of them.
   * The old tree honoured it and the old library strip did not, which meant the
   * setting hid the system library from one list and left it selectable — and
   * therefore savable into — from the other.
   */
  const libraries = computed(() => librariesStore.visibleLibraries.value);

  /**
   * The stored id only counts if that library still exists — a library deleted
   * in another tab would otherwise leave the strip naming something gone and
   * Save targeting it.
   */
  const activeLibrary = computed(() => {
    const stored = libraries.value.find((library) => library.id === activeLibraryId.value);
    return stored ?? libraries.value[0] ?? null;
  });

  const activeLibraryName = computed(() => activeLibrary.value?.name ?? 'No library');

  /**
   * Point the workspace at a library without changing what is open. For a
   * record that names its own library, and for a link that names one.
   */
  function setActiveLibrary(id: string | null) {
    activeLibraryId.value = id;
  }

  /**
   * The user picked a library. The active library changes, and each open
   * screen then lands on its new list (see `useLibrarySwitchLanding`).
   *
   * This is separate from `setActiveLibrary` because the app also sets the
   * library itself: opening a record from another library follows the record,
   * and must not then close it to land on the first row.
   */
  function switchLibrary(id: string) {
    if (id === activeLibrary.value?.id) return;
    activeLibraryId.value = id;
    for (const handler of [...switchHandlers]) handler(id);
  }

  /** Run `handler` after each `switchLibrary`, until the calling component unmounts. */
  function onLibrarySwitch(handler: SwitchHandler) {
    switchHandlers.add(handler);
    if (getCurrentScope()) onScopeDispose(() => switchHandlers.delete(handler));
  }

  async function ensureLoaded() {
    if (libraries.value.length === 0) {
      await librariesStore.loadLibraries();
    }
  }

  return {
    libraries,
    activeLibraryId: computed(() => activeLibrary.value?.id ?? null),
    activeLibrary,
    activeLibraryName,
    setActiveLibrary,
    switchLibrary,
    onLibrarySwitch,
    ensureLoaded,
  };
}

export const ACTIVE_LIBRARY_STORAGE_KEY = STORAGE_KEY;
