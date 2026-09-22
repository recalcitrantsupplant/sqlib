import { computed } from 'vue';
import { usePrefixManager } from '@/composables/usePrefixManager';

/**
 * How a result table renders the IRIs in it.
 *
 * `prefixed` abbreviates against the prefix manager where a namespace matches;
 * `full` shows the IRI as it came back from the store.
 */
export type TermDisplayMode = 'prefixed' | 'full';

/**
 * Term display, for every table at once.
 *
 * One switch in the browser, not a setting per column and not a setting per
 * table: reading `rdf:type` in one table and
 * `http://www.w3.org/1999/02/22-rdf-syntax-ns#type` in the next is not a use
 * anyone has, and the per-column version cost a trip into a header menu for
 * each column before a table read the way you wanted it to.
 *
 * It is the same flag Settings → Abbreviate IRIs writes
 * (`usePrefixManager().enabled`), so the toolbar control and the setting are
 * two faces of one value, persisted in local storage and applied on the next
 * load.
 */
export function useTermDisplay() {
  const { enabled } = usePrefixManager();

  const mode = computed<TermDisplayMode>({
    get: () => (enabled.value ? 'prefixed' : 'full'),
    set: (next: TermDisplayMode) => {
      enabled.value = next === 'prefixed';
    },
  });

  /** Read in cell renderers, so a flip re-renders every table on screen. */
  const isPrefixed = computed(() => mode.value === 'prefixed');

  const setMode = (next: TermDisplayMode): void => {
    mode.value = next;
  };

  return {
    mode,
    isPrefixed,
    setMode,
  };
}
