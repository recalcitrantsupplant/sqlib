/**
 * Where a notebook is kept: saved in the library, or scratch in this browser.
 *
 * The lifecycle every versioned work area has (`lib/entityLifecycle.ts`), so a
 * notebook behaves the way a query does:
 *
 * - **Scratch.** + New makes a notebook that lives only in this browser, kept
 *   by autosave. Save writes it to the library as v1.
 * - **Saved.** A `Notebook` in the library, with immutable versions. Typing
 *   autosaves a browser draft layered on the saved version
 *   (`useEntityDraft`), and no version is cut until Save. Discard puts the
 *   saved version back. Who may read or save it is the library's to decide.
 *
 * The screen above holds the document being edited; this file decides where
 * edits to it land.
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useApiClient } from './useApiClient';
import { useCallableDrafts, type CallableDraft } from './useCallableDrafts';
import { useEntityDraft } from './useEntityDraft';
import type { SidebarEntity } from '../components/EntityListSidebar.vue';
import {
  emptyNotebook,
  parseNotebook,
  serializeNotebook,
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

export interface NotebookEditor {
  /** The document on screen. */
  current: () => Notebook;
  /** Put a document on screen. */
  show: (notebook: Notebook) => void;
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

const clone = (notebook: Notebook): Notebook => JSON.parse(JSON.stringify(notebook)) as Notebook;

export function useNotebookDocuments(libraryId: Ref<string | null>, editor: NotebookEditor) {
  const api = useApiClient();
  const store = useCallableDrafts(libraryId);

  /** Every scratch notebook this browser holds for the active library, newest first. */
  const documents = computed<NotebookDocument[]>(() =>
    store
      .scratchFor('notebook')
      .filter((record) => !libraryId.value || record.libraryId === libraryId.value)
      .map(documentFrom),
  );

  /** The library's saved notebooks, as the sidebar lists them. */
  const saved = ref<SidebarEntity[]>([]);

  const openId = ref<string | null>(null);
  const openKind = ref<'scratch' | 'saved' | null>(null);
  /** The library the open document belongs to. An edit for any other is not this document's. */
  let openLibrary: string | null = null;
  /** The version on screen, for a saved notebook: what Discard puts back. */
  const savedNotebook = ref<Notebook | null>(null);
  const savedName = ref<string | null>(null);
  const versionNumber = ref<number | null>(null);
  const savedAt = ref<string | null>(null);
  const saving = ref(false);

  /** The last document written down or put on screen, so an echo of it is not an edit. */
  let lastBody: string | null = null;

  const isSaved = computed(() => openKind.value === 'saved');

  const draft = useEntityDraft<Notebook>({
    section: 'notebook',
    id: () => (openKind.value === 'saved' ? openId.value : null),
    enabled: () => openKind.value === 'saved',
    libraryId: () => openLibrary,
    name: () => editor.current().title,
    editorBody: () => editor.current(),
    applyBody: (body) => editor.show(body),
    savedBody: () => savedNotebook.value ?? editor.current(),
    resultKind: 'BINDINGS',
  });

  /* ------------------------------------------------------------ scratch */

  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The scratch write that is waiting, and the document it belongs to.
   *
   * Held together, captured when the write was armed rather than read when it
   * fires: switching notebooks changes `openId` before the timer lands, and
   * reading it at fire time would write one document's contents into another.
   */
  let queued: { id: string; notebook: Notebook } | null = null;

  function writeScratch(id: string, notebook: Notebook): void {
    store.save({
      id,
      libraryId: openLibrary ?? libraryId.value ?? notebook.library ?? 'unassigned',
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
   * Land every queued write now, scratch and draft alike.
   *
   * It *writes* rather than cancelling: a debounce standing in for a Save
   * button may not throw the last half-second of typing away when something
   * interrupts it — switching notebooks, leaving the screen, reloading the tab.
   */
  function flush(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    const write = queued;
    queued = null;
    if (write) writeScratch(write.id, write.notebook);
    draft.flushDraft();
  }

  /** Forget the open document without touching what was stored for it. */
  function close(): void {
    flush();
    openId.value = null;
    openKind.value = null;
    openLibrary = null;
    savedNotebook.value = null;
    savedName.value = null;
    versionNumber.value = null;
    savedAt.value = null;
    lastBody = null;
  }

  /** Put a document on screen as the open one, without that counting as an edit. */
  function show(notebook: Notebook): void {
    lastBody = JSON.stringify(notebook);
    draft.hydrate(() => editor.show(notebook));
  }

  /**
   * An edit to the open document: write it down once typing pauses.
   *
   * Cheap to call on every change. A change that is not an edit to the open
   * document is ignored: one that only echoes what was put on screen, and one
   * for a document of another library — the empty notebook a library switch
   * puts on screen is not something to write over the one that was open.
   */
  function touch(notebook: Notebook): void {
    const id = openId.value;
    if (!id) return;
    if (notebook.library && openLibrary && notebook.library !== openLibrary) return;
    const body = JSON.stringify(notebook);
    if (body === lastBody) return;
    lastBody = body;
    if (openKind.value === 'saved') {
      draft.scheduleDraftSave();
      savedAt.value = new Date().toISOString();
      return;
    }
    // A queued write for another document lands before this one is armed.
    if (queued && queued.id !== id) flush();
    queued = { id, notebook };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
  }

  /** Write now — for leaving the screen, where a queued save would be lost. */
  function persist(notebook: Notebook): void {
    if (openKind.value === 'scratch' && openId.value) {
      queued = { id: openId.value, notebook };
    }
    flush();
  }

  function create(notebook?: Notebook): NotebookDocument {
    close();
    const id = `urn:ui-temp:notebook:${crypto.randomUUID()}`;
    const document = notebook ?? emptyNotebook(libraryId.value, 'Untitled notebook');
    openLibrary = libraryId.value ?? document.library;
    writeScratch(id, document);
    openId.value = id;
    openKind.value = 'scratch';
    lastBody = JSON.stringify(document);
    return { id, name: document.title, updatedAt: new Date().toISOString(), notebook: document };
  }

  function open(id: string): Notebook | null {
    const record = store.get(id);
    if (!record) return null;
    close();
    openLibrary = record.libraryId ?? libraryId.value;
    openId.value = id;
    openKind.value = 'scratch';
    const notebook = documentFrom(record).notebook;
    show(notebook);
    return notebook;
  }

  function remove(id: string): void {
    if (openId.value === id) close();
    store.remove(id);
  }

  /* -------------------------------------------------------------- saved */

  /** Why the saved list could not be read, or null. Scratch notebooks still work without it. */
  const loadError = ref<string | null>(null);

  async function loadSaved(): Promise<void> {
    const library = libraryId.value;
    if (!library) {
      saved.value = [];
      return;
    }
    let all: Awaited<ReturnType<typeof api.listNotebooks>>;
    try {
      all = await api.listNotebooks();
      loadError.value = null;
    } catch (cause) {
      loadError.value = cause instanceof Error ? cause.message : String(cause);
      return;
    }
    // A reply for a library already left is dropped.
    if (library !== libraryId.value) return;
    saved.value = all
      .filter((notebook) => notebook.isPartOf.includes(library))
      .map((notebook) => ({
        id: notebook.id,
        name: notebook.name,
        description: notebook.description ?? null,
        currentVersion: notebook.currentVersion ?? null,
        currentVersionNumber: notebook.currentVersionNumber ?? null,
        tags: notebook.tags ?? null,
      }));
  }

  /**
   * Open a saved notebook: its current version, with this browser's draft of
   * it on top when there is one.
   */
  async function openSaved(id: string): Promise<Notebook> {
    const { data: entity } = await api.getNotebook(id);
    let version: Notebook = emptyNotebook(entity.isPartOf[0] ?? libraryId.value, entity.name);
    let number: number | null = null;
    if (entity.currentVersionNumber) {
      const { data } = await api.getNotebookVersion(id, entity.currentVersionNumber);
      version = parseNotebook(JSON.parse(data.contentString));
      number = data.version;
    }

    close();
    openLibrary = entity.isPartOf[0] ?? libraryId.value;
    openId.value = id;
    openKind.value = 'saved';
    savedNotebook.value = clone(version);
    savedName.value = entity.name;
    versionNumber.value = number;

    let onScreen = version;
    const kept = store.draftFor(id)?.body;
    if (kept) {
      try {
        onScreen = parseNotebook(kept);
      } catch {
        // A draft this build cannot read is left in the store, not shown.
      }
    }
    show(onScreen);
    return onScreen;
  }

  /**
   * Save the open notebook as its next version.
   *
   * A scratch notebook becomes a saved one: the library gets a `Notebook` and
   * its v1, and the scratch record goes. A saved one gets v(n+1), and its
   * draft goes, because the edits it held are now in a version.
   */
  async function save(): Promise<void> {
    const library = openLibrary ?? libraryId.value;
    if (!library) throw new Error('Choose a library first.');
    const id = openId.value;
    if (!id) throw new Error('Open a notebook first.');
    flush();
    const notebook = clone({ ...editor.current(), library });
    const name = notebook.title.trim() || 'Untitled notebook';
    saving.value = true;
    try {
      let notebookId = id;
      if (openKind.value === 'scratch') {
        const { data: created } = await api.createNotebook({ name, isPartOf: [library] });
        notebookId = created.id;
      } else if (name !== savedName.value) {
        await api.updateNotebook(notebookId, { name });
      }
      const { data: version } = await api.createNotebookVersion(notebookId, {
        contentString: serializeNotebook(notebook),
      });

      if (openKind.value === 'scratch') store.remove(id);
      draft.cancelDraftSave();
      draft.removeDraft();
      openId.value = notebookId;
      openKind.value = 'saved';
      openLibrary = library;
      savedNotebook.value = notebook;
      savedName.value = name;
      versionNumber.value = version.version;
      lastBody = JSON.stringify(editor.current());
      await loadSaved();
    } finally {
      saving.value = false;
    }
  }

  /** Throw the unsaved edits away and put the saved version back. */
  function discard(): void {
    if (openKind.value !== 'saved' || !savedNotebook.value) return;
    draft.cancelDraftSave();
    draft.removeDraft();
    show(clone(savedNotebook.value));
  }

  async function deleteSaved(): Promise<void> {
    const id = openId.value;
    if (openKind.value !== 'saved' || !id) return;
    await api.deleteNotebook(id);
    draft.cancelDraftSave();
    draft.removeDraft();
    close();
    await loadSaved();
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

  /*
   * Another library: the open document stays where it was written, and is
   * closed rather than handed the empty notebook the screen shows next.
   */
  watch(libraryId, () => {
    close();
    void loadSaved();
  });

  return {
    documents,
    saved,
    loadError,
    openId,
    openKind,
    isSaved,
    versionNumber,
    editCount: draft.editCount,
    notPersisted: draft.notPersisted,
    savedAt,
    saving,
    create,
    open,
    remove,
    touch,
    persist,
    loadSaved,
    openSaved,
    save,
    discard,
    deleteSaved,
    close,
  };
}
