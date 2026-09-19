/**
 * Notebooks as stored assets.
 *
 * A notebook is listed, opened and discarded from the same browser-local store
 * every other unsaved body in the app lives in, so what is worth pinning is the
 * autosave — the thing standing in for a Save button — and the two ways it can
 * lose work: a queued write landing in the notebook you just switched to, and a
 * queued write never landing at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useCallableDrafts } from '@/composables/useCallableDrafts';
import { useNotebookDocuments } from '@/composables/useNotebookDocuments';
import { emptyNotebook, markdownCell } from '@/lib/notebookFormat';

const LIBRARY = 'urn:lib:1';

function runIn<T>(fn: (documents: ReturnType<typeof useNotebookDocuments>) => T): T {
  const scope = effectScope();
  const result = scope.run(() => fn(useNotebookDocuments(ref(LIBRARY))))!;
  scope.stop();
  return result;
}

describe('notebook documents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useCallableDrafts().clear();
  });

  it('lists what this browser holds for the library, as scratch records', () => {
    runIn((documents) => {
      documents.create();
      expect(documents.documents.value).toHaveLength(1);
      expect(useCallableDrafts().scratchFor('notebook')).toHaveLength(1);
    });
  });

  it('writes an edit out after the debounce, not before', () => {
    runIn((documents) => {
      const created = documents.create();
      const edited = { ...created.notebook, title: 'Renamed' };

      documents.touch(edited);
      expect(useCallableDrafts().get(created.id)?.name).toBe('Untitled notebook');

      vi.advanceTimersByTime(600);
      expect(useCallableDrafts().get(created.id)?.name).toBe('Renamed');
    });
  });

  it('lands a queued write in its own notebook, not in the one opened after it', () => {
    runIn((documents) => {
      const first = documents.create();
      const second = documents.create();

      // Armed against `first`, then the selection moves before it fires.
      documents.openId.value = first.id;
      documents.touch({ ...first.notebook, title: 'First, edited' });
      documents.open(second.id);
      vi.advanceTimersByTime(600);

      expect(useCallableDrafts().get(first.id)?.name).toBe('First, edited');
      expect(useCallableDrafts().get(second.id)?.name).toBe('Untitled notebook');
    });
  });

  /*
   * The debounce stands in for a Save button, so being interrupted may not
   * throw work away. It did: an earlier flush cancelled the timer and dropped
   * what it held, which lost the last half-second of typing to every reload.
   */
  it('lands the queued write when the screen goes away rather than dropping it', () => {
    runIn((documents) => {
      const created = documents.create();
      documents.touch({ ...created.notebook, title: 'Typed, then left' });

      window.dispatchEvent(new Event('pagehide'));

      expect(useCallableDrafts().get(created.id)?.name).toBe('Typed, then left');
    });
  });

  it('persists on demand, for the navigation a debounce would not survive', () => {
    runIn((documents) => {
      const created = documents.create();
      documents.persist({ ...created.notebook, title: 'Flushed' });
      expect(useCallableDrafts().get(created.id)?.name).toBe('Flushed');
    });
  });

  it('reads a document back with its cells', () => {
    runIn((documents) => {
      const notebook = { ...emptyNotebook(LIBRARY, 'With a note'), cells: [markdownCell('# Hello')] };
      const created = documents.create(notebook);
      vi.advanceTimersByTime(600);

      expect(documents.open(created.id)?.cells).toHaveLength(1);
    });
  });

  /*
   * Losing somebody's document because one field of it will not parse is worse
   * than showing them an empty one they can see is wrong.
   */
  it('keeps a record whose body is unreadable, as an empty notebook under its name', () => {
    const store = useCallableDrafts();
    store.save({
      id: 'urn:ui-temp:notebook:broken',
      libraryId: LIBRARY,
      type: 'query',
      kind: 'scratch',
      section: 'notebook',
      name: 'Broken',
      description: null,
      queryString: null,
      body: { format: 'sqlib-notebook/99' },
      resultKind: 'BINDINGS',
      inputTuples: [],
      limitParameters: [],
      offsetParameters: [],
      outputs: [],
      basedOn: null,
    });

    runIn((documents) => {
      const listed = documents.documents.value.find((entry) => entry.id === 'urn:ui-temp:notebook:broken');
      expect(listed?.name).toBe('Broken');
      expect(listed?.notebook.cells).toEqual([]);
    });
  });

  it('discards a document, and lets go of it if it was open', () => {
    runIn((documents) => {
      const created = documents.create();
      documents.remove(created.id);

      expect(documents.documents.value).toHaveLength(0);
      expect(documents.openId.value).toBeNull();
    });
  });
});
