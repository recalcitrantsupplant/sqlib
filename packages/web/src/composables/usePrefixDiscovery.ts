import { onBeforeUnmount, watch } from 'vue';
import { usePrefixManager } from '@/composables/usePrefixManager';

/**
 * Learn prefixes from whatever is being typed in an editor.
 *
 * Discovery used to be wired per screen — the query work area learned prefixes
 * only when a saved version was loaded, the rules screen only when a rule set
 * was run, and every other editor in the app (tests, data graphs, tuple sets,
 * ETL) never learned any at all. So the same PREFIX block taught the app
 * something in one panel and nothing in the next.
 *
 * This is that behaviour as one thing an editor *has*, rather than something a
 * screen remembers to do: hand it the text and where the text lives, and the
 * declarations in it are registered.
 *
 * Debounced because the source is a keystroke stream: a person typing a
 * namespace passes through a dozen incomplete-but-parseable states, and only
 * the one they stop on is worth recording.
 *
 * `source` distinguishes three answers, not two. A token records provenance;
 * `null` discovers with none, which is the honest answer for an item that has
 * no identity yet; `undefined` means this text is not RDF at all — a JSON
 * body, a description — and nothing is read from it.
 */
export function usePrefixDiscovery(
  text: () => string | null | undefined,
  source: () => string | null | undefined,
  options: { delay?: number } = {},
) {
  const { autoDiscoverFromText } = usePrefixManager();
  const delay = options.delay ?? 800;

  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Run now — for the moments that are already a settled state, like a run. */
  function discoverNow() {
    cancel();
    const value = text();
    const from = source();
    if (!value || from === undefined) return;
    autoDiscoverFromText(value, from);
  }

  watch(
    () => text(),
    (value) => {
      cancel();
      if (!value || source() === undefined) return;
      // Nothing to do for a document with no declarations at all; the check is
      // far cheaper than the scan and this runs on every pause in typing.
      if (!/@?prefix/i.test(value)) return;
      timer = setTimeout(() => {
        timer = null;
        autoDiscoverFromText(text() ?? '', source() ?? null);
      }, delay);
    },
    { immediate: true },
  );

  onBeforeUnmount(cancel);

  return { discoverNow };
}
