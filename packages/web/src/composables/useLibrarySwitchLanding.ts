/**
 * What an entity screen shows after the user picks another library.
 *
 * One rule for every screen that lists a library's entities: close what is
 * open, load the new library's list, and open its first row. With no rows,
 * nothing opens, and the screen shows its own empty state, which names the
 * entity and has the button that adds one.
 *
 * Each screen says how to do the three steps for its own list. This composable
 * owns the order, and drops a landing that a later switch has replaced: two
 * quick switches must open the second library's first row, not the first's.
 *
 * It runs only after `switchLibrary`, the user's choice. A record opened from
 * another library also moves the active library (`setActiveLibrary`), and that
 * must leave the record open.
 */
import { ref } from 'vue';
import { useActiveLibrary } from './useActiveLibrary';

export interface LibrarySwitchScreen<Row> {
  /**
   * Whether the screen's list depends on the library right now. A screen
   * whose list is the same in every library (Bench, Backends) keeps what is
   * open. Default: always.
   */
  scoped?: () => boolean;
  /** Close the open entity, so the old library's record does not stay on screen. */
  close: () => void;
  /** Load the list for `libraryId` and return its rows in the order the list shows them. */
  rows: (libraryId: string) => Promise<readonly Row[]>;
  /** Open one row. */
  open: (row: Row) => void | Promise<void>;
}

export function useLibrarySwitchLanding<Row>(screen: LibrarySwitchScreen<Row>) {
  const { onLibrarySwitch } = useActiveLibrary();

  /** True from the switch until the new list has answered. */
  const landing = ref(false);
  let generation = 0;

  async function land(libraryId: string): Promise<void> {
    if (screen.scoped && !screen.scoped()) return;
    const mine = ++generation;
    landing.value = true;
    try {
      screen.close();
      const rows = await screen.rows(libraryId);
      if (mine !== generation) return;
      const first = rows[0];
      if (first !== undefined) await screen.open(first);
    } catch (err) {
      // The list could not be read. Nothing opens, so the screen shows its
      // empty state and the list shows its own error.
      console.error('[useLibrarySwitchLanding] Landing failed:', err);
    } finally {
      if (mine === generation) landing.value = false;
    }
  }

  onLibrarySwitch((libraryId) => { void land(libraryId); });

  return { landing, land };
}
