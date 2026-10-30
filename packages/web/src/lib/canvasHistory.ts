/**
 * Undo and redo for the query group canvas.
 *
 * The canvas records whole snapshots rather than inverse commands: a graph is
 * small, and a snapshot cannot drift from what the commands did. Each entry
 * carries a `key` (the canvas fingerprint), so recording the state the canvas
 * already holds — after an undo puts it back, say — adds nothing.
 */

export interface HistoryEntry {
  key: string;
}

export interface SnapshotHistory<T extends HistoryEntry> {
  /** Start over from `entry`, with nothing to undo or redo. */
  reset: (entry: T | null) => void;
  /** The canvas changed to `entry`. False when it is the same state. */
  record: (entry: T) => boolean;
  /** The entry to put back, or null when there is nothing to undo. */
  undo: () => T | null;
  /** The entry to put back, or null when there is nothing to redo. */
  redo: () => T | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export function createSnapshotHistory<T extends HistoryEntry>(limit = 100): SnapshotHistory<T> {
  let past: T[] = [];
  let future: T[] = [];
  let present: T | null = null;

  return {
    reset(entry) {
      past = [];
      future = [];
      present = entry;
    },
    record(entry) {
      if (!present) {
        present = entry;
        return false;
      }
      if (entry.key === present.key) return false;
      past.push(present);
      if (past.length > limit) past.shift();
      present = entry;
      future = [];
      return true;
    },
    undo() {
      const previous = past.pop();
      if (!previous || !present) return null;
      future.push(present);
      present = previous;
      return previous;
    },
    redo() {
      const next = future.pop();
      if (!next || !present) return null;
      past.push(present);
      present = next;
      return next;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
