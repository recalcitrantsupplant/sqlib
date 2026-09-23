/**
 * Saved notebooks: the list a notebook is opened from, and where edits land.
 *
 * A notebook is an asset like every other one the rail lists, so it lives in
 * the same browser-local store the rest of the app's unsaved work does
 * (`useCallableDrafts`) and renders in the same sidebar. The section is
 * scratch-only, exactly as ETL's is, because a notebook has no server entity
 * yet — the proposal's step 1 in its phase-1 form. When it grows one, this is
 * the file that learns about it and the screen above it does not.
 *
 * Autosave rather than a Save button, the rule the rest of the app follows: the
 * debounce *is* the safety net when there is nothing to press.
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useCallableDrafts, type CallableDraft } from './useCallableDrafts';
import {
  emptyNotebook,
  parseNotebook,
  type Notebook,
} from '../lib/notebookFormat';

/** The same 500ms every other autosaving surface uses. */
const SAVE_DELAY_MS = 500;

export interface NotebookDocument {
  id: string;
  name: string;
  updatedAt: string;
  notebook: Notebook;
}

/**
 * Read a stored record back as a notebook.
 *
 * A record whose body will not parse is *not* dropped: it keeps its place in
 * the list as an empty notebook under its own name, because silently losing
 * somebody's document is worse than showing them an empty one they can see is
 * wrong. `parseNotebook` is the same reader the file import uses.
 */
function documentFrom(record: CallableDraft): NotebookDocument {
  let notebook: Notebook;
  try {
    notebook = parseNotebook(record.body);
  } catch {
    notebook = emptyNotebook(record.libraryId ?? null, record.name);
  }
  return { id: record.id, name: record.name, updatedAt: record.updatedAt, notebook };
}

export function useNotebookDocuments(libraryId: Ref<string | null>) {
  const store = useCallableDrafts(libraryId);

  /** Every notebook this browser holds for the active library, newest first. */
  const documents = computed<NotebookDocument[]>(() =>
    store
      .scratchFor('notebook')
      .filter((record) => !libraryId.value || record.libraryId === libraryId.value)
      .map(documentFrom),
  );

  const openId = ref<string | null>(null);
  const savedAt = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The write that is waiting, and the document it belongs to.
   *
   * Held together, captured when the write was armed rather than read when it
   * fires: switching notebooks changes `openId` before the timer lands, and
   * reading it at fire time would write one document's contents into another.
   */
  let queued: { id: string; notebook: Notebook } | null = null;

  function write(id: string, notebook: Notebook): void {
    store.save({
      id,
      libraryId: libraryId.value ?? notebook.library ?? 'unassigned',
      type: 'query',
      kind: 'scratch',
      section: 'notebook',
      name: notebook.title,
      description: null,
      queryString: null,
      body: notebook,
      resultKind: 'BINDINGS',
      inputTuples: [],
      limitParameters: [],
      offsetParameters: [],
      outputs: [],
      basedOn: null,
    });
    savedAt.value = new Date().toISOString();
  }

  /**
   * Land the queued write now.
   *
   * It *writes* rather than cancelling. An earlier version cleared the timer
   * and dropped what it held, which meant the last half-second of typing was
   * lost to anything that flushed — switching notebooks, leaving the screen,
   * reloading the tab. A debounce standing in for a Save button may not throw
   * work away when it is interrupted; that is the one thing it is for.
   */
  function flush(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    const write_ = queued;
    queued = null;
    if (write_) write(write_.id, write_.notebook);
  }

  /** Queue a write of the open notebook. Cheap to call on every keystroke. */
  function touch(notebook: Notebook): void {
    const id = openId.value;
    if (!id) return;
    // A queued write for another document lands before this one is armed.
    if (queued && queued.id !== id) flush();
    queued = { id, notebook };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
  }

  /** Write now — for leaving the screen, where a queued save would be lost. */
  function persist(notebook: Notebook): void {
    const id = openId.value;
    flush();
    if (id) write(id, notebook);
  }

  function create(notebook?: Notebook): NotebookDocument {
    const id = `urn:ui-temp:notebook:${crypto.randomUUID()}`;
    const document = notebook ?? emptyNotebook(libraryId.value, 'Untitled notebook');
    write(id, document);
    openId.value = id;
    return { id, name: document.title, updatedAt: new Date().toISOString(), notebook: document };
  }

  function open(id: string): Notebook | null {
    const record = store.get(id);
    if (!record) return null;
    flush();
    openId.value = id;
    return documentFrom(record).notebook;
  }

  function remove(id: string): void {
    if (openId.value === id) {
      flush();
      openId.value = null;
    }
    store.remove(id);
  }

  /*
   * A queued save must not be lost to a navigation — including the ones Vue
   * never sees. `pagehide` covers a reload, a closed tab and a link out, and
   * fires where `beforeunload` is unreliable on mobile Safari.
   */
  onBeforeUnmount(() => {
    flush();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', flush);
  });
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);
  watch(libraryId, flush);

  return { documents, openId, savedAt, create, open, remove, touch, persist };
}
