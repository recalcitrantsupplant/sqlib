/**
 * The work-area half of a scratch item: load it, autosave it, flush it.
 *
 * Every section that can hold an unsaved body needs the same four things, and
 * each of them is a way to lose someone's work if it is written slightly
 * differently in four places:
 *
 * 1. **Hydrate without echoing.** Loading a record into the editor sets the
 *    same refs typing does. Without a guard the load reads as a keystroke and
 *    writes straight back over what it just read — harmless when the values
 *    match, destructive when hydration is partial.
 * 2. **Debounce every edit.** There is no Save button and no nav-away prompt,
 *    so the debounce *is* the safety net.
 * 3. **Flush before switching away.** A pending save that never lands is the
 *    last 500ms of typing, silently gone.
 * 4. **Say when it saved.** `savedAt` is what the "saved locally · 12s" line
 *    reads; unsaved work you cannot see saving is unsaved work you distrust.
 *
 * Extracted from `QueryWorkArea`, which had all four inline, when Rules, ETL
 * and Bench needed them too.
 */
import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref, type WatchSource } from 'vue';
import { toast } from 'vue-sonner';
import { useCallableDrafts, type CallableDraft, type CallableDraftInput } from './useCallableDrafts';

export interface ScratchRecordOptions {
  /** The record being edited; null when the work area is showing a saved entity. */
  scratchId: () => string | null | undefined;
  /** Read the record into the editor. Runs guarded, so it cannot echo back. */
  hydrate: (record: CallableDraft) => void;
  /**
   * What to write back, given what is stored. Merged over the stored record,
   * so a field that is not returned keeps its stored value — and the record is
   * passed in so a caller can fall back to it rather than returning
   * `undefined`, which would spread over the stored value and clear it.
   */
  collect: (record: CallableDraft) => Partial<CallableDraftInput>;
  /** The refs that count as an edit. Same shape `watch` takes. */
  track: WatchSource | WatchSource[];
  /** Shown when a `?scratch=` link names a record this browser does not hold. */
  missingMessage: string;
  /** Autosave delay. 500ms everywhere unless a section has a reason to differ. */
  delayMs?: number;
}

export interface ScratchRecord {
  isScratch: ComputedRef<boolean>;
  /** True while a record is being read in — watchers keyed on edits must skip. */
  hydrating: Ref<boolean>;
  /** ISO time of the last write, or null if nothing has been saved yet. */
  savedAt: Ref<string | null>;
  /** Write any pending edit out now. A no-op when nothing is pending. */
  flush: () => void;
  /** Write out now regardless of whether an edit is pending. */
  persist: () => void;
}

export function useScratchRecord(options: ScratchRecordOptions): ScratchRecord {
  const store = useCallableDrafts();
  const isScratch = computed(() => Boolean(options.scratchId()));
  const hydrating = ref(false);
  const savedAt = ref<string | null>(null);
  let saveHandle: ReturnType<typeof setTimeout> | null = null;
  /*
   * The record a pending save belongs to, captured when the save was armed
   * rather than read when it fires.
   *
   * Switching items changes `scratchId` before the pending write lands, so
   * reading it at fire time writes the editor's old contents *into the record
   * being opened* — and hydration then reads back what it just clobbered. The
   * one-item case hides this; it is the second item that loses its body.
   */
  let pendingId: string | null = null;

  function persist(targetId = options.scratchId() ?? null) {
    if (!targetId) return;
    const record = store.get(targetId);
    // Gone from under us — a discard in another tab, or a stale link. Writing
    // it back would resurrect a record the user chose to throw away.
    if (!record) return;
    store.save({ ...record, ...options.collect(record) });
    savedAt.value = new Date().toISOString();
  }

  function flush() {
    if (!saveHandle) return;
    clearTimeout(saveHandle);
    saveHandle = null;
    const target = pendingId;
    pendingId = null;
    persist(target ?? undefined);
  }

  function load(id: string) {
    const record = store.get(id);
    if (!record) {
      toast.error(options.missingMessage);
      return;
    }
    hydrating.value = true;
    options.hydrate(record);
    // Cleared on a microtask rather than synchronously: hydration usually sets
    // refs whose watchers have not run yet, and they run before this resolves.
    void Promise.resolve().then(() => { hydrating.value = false; });
  }

  /*
   * Deep, and it has to be. Every section but Queries holds its body in an
   * array or an object the editor mutates in place — a column mapping's target
   * variable, a benchmark's target row, a rule body at an index. A ref holding
   * an array only notifies on `.value` replacement, so a shallow watcher here
   * would autosave typing in the query editor and silently drop everything
   * typed in the other three.
   */
  watch(options.track, () => {
    if (!isScratch.value || hydrating.value) return;
    if (saveHandle) clearTimeout(saveHandle);
    const target = options.scratchId() ?? null;
    pendingId = target;
    saveHandle = setTimeout(() => {
      saveHandle = null;
      pendingId = null;
      persist(target);
    }, options.delayMs ?? 500);
  }, { deep: true });

  watch(
    () => options.scratchId(),
    (id, previousId) => {
      if (previousId) flush();
      if (id) load(id);
    },
    { immediate: true },
  );

  // Switching sections unmounts the work area. Without this the last edit
  // before the click is the one that never lands.
  onBeforeUnmount(flush);

  return { isScratch, hydrating, savedAt, flush, persist };
}
