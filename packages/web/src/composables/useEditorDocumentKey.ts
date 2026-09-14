import { computed, ref, watch, type ComputedRef } from 'vue';

/**
 * A `key` for a CodeMirror instance that changes when a *different document*
 * takes over the editor.
 *
 * The work areas keep one editor for the whole section and swap the text in it
 * as you move between queries — the component is not re-created, so neither is
 * its undo history. CodeMirror has no idea the text it was just handed belongs
 * to something else: the swap is one more change in the same history, so the
 * first Ctrl-Z after switching queries pulls the *previous* query's text back
 * into the editor, and the autosave that follows writes it into the query you
 * are actually looking at. `vue-codemirror` builds its state from
 * `basicSetup`, whose `history()` sits outside any compartment we hold, so
 * there is nothing to reconfigure and nothing to clear: re-creating the
 * instance is what gives a new document an empty history.
 *
 * The timing is the whole difficulty. Selecting a query changes its identity
 * immediately and its text only when the fetch lands, so a key built from the
 * identity alone re-creates the editor around the *old* text, and the body
 * that arrives a moment later is once again an undoable change on top of it.
 * So the key moves twice: once when the identity changes, and again on the
 * first text that arrives for it — which is the load, since edits you make
 * yourself say so through `noteUserEdit`.
 *
 * @param identity  What the editor is holding — the query and version ids, or
 *                  whatever else names one document and not another.
 * @param content   The text bound to the editor.
 */
export function useEditorDocumentKey(
  identity: () => string | null | undefined,
  content: () => string,
): { documentKey: ComputedRef<string>; noteUserEdit: () => void } {
  const epoch = ref(0);
  /*
   * True from the moment a different document is selected until its text
   * arrives. Typing clears it: a keystroke is not a load, and re-creating the
   * editor under a cursor would throw the cursor away with it.
   */
  let awaitingContent = false;

  watch(identity, () => {
    awaitingContent = true;
    epoch.value += 1;
  });

  watch(content, () => {
    if (!awaitingContent) return;
    awaitingContent = false;
    epoch.value += 1;
  });

  return {
    documentKey: computed(() => `${identity() ?? ''}#${epoch.value}`),
    noteUserEdit: () => {
      awaitingContent = false;
    },
  };
}
