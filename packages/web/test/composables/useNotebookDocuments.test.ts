/**
 * Notebooks as stored assets.
 *
 * A scratch notebook lives in the same browser-local store every other unsaved
 * body in the app lives in; a saved one is a library entity with versions, and
 * a browser draft on top. What is worth pinning is the autosave and the ways it
 * can lose work — a queued write landing in the notebook you just switched to,
 * a queued write never landing at all, a library switch writing an empty
 * notebook over the open one — and that Save, not typing, cuts a version.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useCallableDrafts } from '@/composables/useCallableDrafts';
import { useNotebookDocuments } from '@/composables/useNotebookDocuments';
import { emptyNotebook, markdownCell, type Notebook } from '@/lib/notebookFormat';

const api = vi.hoisted(() => ({
  listNotebooks: vi.fn(),
  getNotebook: vi.fn(),
  getNotebookVersion: vi.fn(),
  createNotebook: vi.fn(),
  updateNotebook: vi.fn(),
  createNotebookVersion: vi.fn(),
  deleteNotebook: vi.fn(),
}));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

const LIBRARY = 'urn:lib:1';

/** The document on screen, as the page's `useNotebook` holds it. */
const screen = ref<Notebook>(emptyNotebook(LIBRARY));
const editor = { current: () => screen.value, show: (notebook: Notebook) => { screen.value = notebook; } };

function runIn<T>(fn: (documents: ReturnType<typeof useNotebookDocuments>) => T, library = ref<string | null>(LIBRARY)): T {
  const scope = effectScope();
  const result = scope.run(() => fn(useNotebookDocuments(library, editor)))!;
  scope.stop();
  return result;
}

async function runInAsync(
  fn: (documents: ReturnType<typeof useNotebookDocuments>, library: ReturnType<typeof ref<string | null>>) => Promise<void>,
): Promise<void> {
  const scope = effectScope();
  const library = ref<string | null>(LIBRARY);
  const documents = scope.run(() => useNotebookDocuments(library, editor))!;
  try {
    await fn(documents, library);
  } finally {
    scope.stop();
  }
}

const SAVED_ID = 'urn:sqlib:notebook:n1';
const savedDocument = { ...emptyNotebook(LIBRARY, 'Saved one'), cells: [markdownCell('# v1')] };

function serveSaved() {
  api.getNotebook.mockResolvedValue({ data: { id: SAVED_ID, name: 'Saved one', isPartOf: [LIBRARY], currentVersionNumber: 1 } });
  api.getNotebookVersion.mockResolvedValue({ data: { version: 1, contentString: JSON.stringify(savedDocument) } });
  api.listNotebooks.mockResolvedValue([{ id: SAVED_ID, name: 'Saved one', isPartOf: [LIBRARY], currentVersionNumber: 1 }]);
}

describe('notebook documents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useCallableDrafts().clear();
    for (const fn of Object.values(api)) fn.mockReset();
    screen.value = emptyNotebook(LIBRARY);
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

  it('opens a saved notebook at its current version, and keeps edits as a draft, not a version', async () => {
    serveSaved();
    await runInAsync(async (documents) => {
      await documents.openSaved(SAVED_ID);
      expect(screen.value.title).toBe('Saved one');
      expect(documents.versionNumber.value).toBe(1);
      expect(documents.editCount.value).toBe(0);

      screen.value = { ...screen.value, title: 'Edited' };
      documents.touch(screen.value);
      vi.advanceTimersByTime(600);

      expect(documents.editCount.value).toBe(1);
      expect(useCallableDrafts().draftFor(SAVED_ID)?.name).toBe('Edited');
      expect(api.createNotebookVersion).not.toHaveBeenCalled();
    });
  });

  it('puts a kept draft back on top of the saved version when the notebook is opened again', async () => {
    serveSaved();
    await runInAsync(async (documents) => {
      await documents.openSaved(SAVED_ID);
      screen.value = { ...screen.value, title: 'Draft title' };
      documents.touch(screen.value);
      vi.advanceTimersByTime(600);
      documents.close();

      await documents.openSaved(SAVED_ID);
      expect(screen.value.title).toBe('Draft title');

      documents.discard();
      expect(screen.value.title).toBe('Saved one');
      expect(useCallableDrafts().draftFor(SAVED_ID)).toBeNull();
    });
  });

  it('saves a scratch notebook as v1 in the library and lets the scratch record go', async () => {
    api.createNotebook.mockResolvedValue({ data: { id: SAVED_ID, name: 'Mine', isPartOf: [LIBRARY] } });
    api.createNotebookVersion.mockResolvedValue({ data: { version: 1 } });
    api.listNotebooks.mockResolvedValue([]);
    await runInAsync(async (documents) => {
      const created = documents.create({ ...emptyNotebook(LIBRARY, 'Mine'), cells: [markdownCell('# Hi')] });
      screen.value = created.notebook;

      await documents.save();

      expect(api.createNotebook).toHaveBeenCalledWith({ name: 'Mine', isPartOf: [LIBRARY] });
      const [id, body] = api.createNotebookVersion.mock.calls[0]!;
      expect(id).toBe(SAVED_ID);
      expect(JSON.parse(body.contentString).cells).toHaveLength(1);
      expect(useCallableDrafts().get(created.id)).toBeNull();
      expect(documents.openId.value).toBe(SAVED_ID);
      expect(documents.isSaved.value).toBe(true);
      expect(documents.versionNumber.value).toBe(1);
    });
  });

  it('saves a saved notebook\'s draft as the next version and clears the draft', async () => {
    serveSaved();
    api.createNotebookVersion.mockResolvedValue({ data: { version: 2 } });
    await runInAsync(async (documents) => {
      await documents.openSaved(SAVED_ID);
      screen.value = { ...screen.value, cells: [...screen.value.cells, markdownCell('more')] };
      documents.touch(screen.value);
      vi.advanceTimersByTime(600);

      await documents.save();

      expect(documents.versionNumber.value).toBe(2);
      expect(documents.editCount.value).toBe(0);
      expect(useCallableDrafts().draftFor(SAVED_ID)).toBeNull();
      expect(api.updateNotebook).not.toHaveBeenCalled();
    });
  });

  /*
   * The data loss the review found: a library switch put an empty notebook on
   * screen, and autosave wrote it over the one that was open.
   */
  it('closes the open notebook on a library switch instead of writing the next screen over it', async () => {
    api.listNotebooks.mockResolvedValue([]);
    await runInAsync(async (documents, library) => {
      const created = documents.create({ ...emptyNotebook(LIBRARY, 'Keep me'), cells: [markdownCell('# keep')] });
      library.value = 'urn:lib:2';
      await nextTick();
      documents.touch(emptyNotebook('urn:lib:2'));
      vi.advanceTimersByTime(600);

      expect(documents.openId.value).toBeNull();
      expect(useCallableDrafts().get(created.id)?.name).toBe('Keep me');
    });
  });
});
