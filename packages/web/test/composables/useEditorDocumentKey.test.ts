import { describe, it, expect } from 'vitest';
import { nextTick, ref } from 'vue';

import { useEditorDocumentKey } from '@/composables/useEditorDocumentKey';

/**
 * The key exists to be a `key` on a CodeMirror instance, so what matters is
 * only whether it changed — never what it says.
 */
function track() {
  const identity = ref('query-a');
  const content = ref('SELECT A');
  const { documentKey, noteUserEdit } = useEditorDocumentKey(
    () => identity.value,
    () => content.value,
  );
  return { identity, content, documentKey, noteUserEdit };
}

describe('useEditorDocumentKey', () => {
  it('holds still while one document is edited', async () => {
    const { content, documentKey, noteUserEdit } = track();
    const before = documentKey.value;

    noteUserEdit();
    content.value = 'SELECT A edited';
    await nextTick();
    noteUserEdit();
    content.value = 'SELECT A edited twice';
    await nextTick();

    expect(documentKey.value).toBe(before);
  });

  it('changes when another document is selected, and again when its text lands', async () => {
    const { identity, content, documentKey } = track();
    const before = documentKey.value;

    // Selecting a query is immediate; its body is a fetch away.
    identity.value = 'query-b';
    await nextTick();
    const afterSelect = documentKey.value;
    expect(afterSelect).not.toBe(before);

    // The body arriving must not be an undoable change in the instance that
    // was re-created a moment ago around the *previous* query's text.
    content.value = 'SELECT B';
    await nextTick();
    expect(documentKey.value).not.toBe(afterSelect);
  });

  it('does not treat the first keystroke after a switch as the load', async () => {
    const { identity, content, documentKey, noteUserEdit } = track();

    identity.value = 'query-b';
    await nextTick();
    const afterSelect = documentKey.value;

    // The body was identical to what was on screen, so nothing arrived — and
    // then the cursor went in. Re-creating the editor there would drop it.
    noteUserEdit();
    content.value = 'SELECT A!';
    await nextTick();

    expect(documentKey.value).toBe(afterSelect);
  });

  it('holds still for a load-shaped write within the same document', async () => {
    const { content, documentKey } = track();
    const before = documentKey.value;

    // Format, or discarding changes: same document, and undo should reach back
    // across it.
    content.value = 'SELECT   A';
    await nextTick();

    expect(documentKey.value).toBe(before);
  });
});
