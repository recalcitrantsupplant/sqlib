import { computed, ref } from 'vue';
import { usePrefixManager } from '@/composables/usePrefixManager';

/**
 * How one column renders the IRIs in it.
 *
 * `prefixed` abbreviates against the prefix manager where a namespace matches;
 * `full` shows the IRI as it came back from the store.
 */
export type TermDisplayMode = 'prefixed' | 'full';

/**
 * Per-column term display for a single table.
 *
 * There is deliberately no table-wide control: a table renders prefixed names
 * (the app default from Settings → Result tables), and a reader who wants the
 * IRIs for one column says so in that column's header menu — the menu that
 * already owns sort and filter. Term display is a column property like those
 * two, so `s` can show full IRIs while `p` and `o` stay narrow.
 *
 * State is per table instance, not persisted: it is a way of reading the rows
 * in front of you, not a setting. The app-wide default still lives in
 * `usePrefixManager().enabled`, and a column that was never touched follows it.
 */
export function useTermDisplay() {
  const { enabled } = usePrefixManager();

  /** Columns the reader has decided about; everything else follows the default. */
  const overrides = ref<Record<string, TermDisplayMode>>({});

  const defaultMode = computed<TermDisplayMode>(() =>
    enabled.value ? 'prefixed' : 'full',
  );

  const modeFor = (columnKey: string): TermDisplayMode =>
    overrides.value[columnKey] ?? defaultMode.value;

  const isPrefixed = (columnKey: string): boolean =>
    modeFor(columnKey) === 'prefixed';

  const setMode = (columnKey: string, mode: TermDisplayMode): void => {
    // Replaced wholesale rather than mutated: the cell renderers read this ref
    // during the table's render, and a new object is what re-runs them.
    overrides.value = { ...overrides.value, [columnKey]: mode };
  };

  const applyToAll = (columnKeys: string[], mode: TermDisplayMode): void => {
    const next: Record<string, TermDisplayMode> = { ...overrides.value };
    for (const key of columnKeys) {
      next[key] = mode;
    }
    overrides.value = next;
  };

  return {
    defaultMode,
    modeFor,
    isPrefixed,
    setMode,
    applyToAll,
  };
}
