/**
 * A saved entity's unsaved edits, kept as a browser-local draft.
 *
 * Every versioned work area — queries, rule sets, data graphs, tuple sets,
 * tests, benchmarks, ETL pipelines, argument sets — keeps unsaved edits the
 * same way, because they are the same lifecycle (`lib/entityLifecycle.ts`):
 * typing autosaves a draft layered on the saved entity, typing back to what is
 * saved removes it, Discard restores the saved body, and reading a record into
 * the editor is never itself an edit. Eight copies of that code had drifted —
 * different guards, different envelopes, a different idea of what "saved"
 * meant — so it lives here once and each work area supplies only what is
 * particular to it: what its editor holds, and how to put a body back.
 *
 * Scratch records are not this composable's business: they have no saved
 * entity to be a draft of, and `useScratchRecord` owns them.
 */
import { computed, onBeforeUnmount, ref, watch, type WatchSource } from 'vue';
import {
  useCallableDrafts,
  UNASSIGNED_LIBRARY_ID,
  type CallableDraftInput,
  type DraftSection,
} from './useCallableDrafts';
import type { ResultKind } from '../lib/callables';

/** How long typing has to pause before an edit is written down. */
export const DRAFT_DEBOUNCE_MS = 500;

export interface EntityDraftOptions<B> {
  section: DraftSection;
  /** The saved entity the draft is layered on; null while nothing is open. */
  id: () => string | null;
  /** False for a scratch record, which has no saved entity to draft against. */
  enabled: () => boolean;
  /** The library the draft is filed under. Null files it as unassigned. */
  libraryId: () => string | null;
  name: () => string;
  description?: () => string | null;
  /** What the editor holds now, in the shape the draft records it. */
  editorBody: () => B;
  /** Put a body back into the editor. */
  applyBody: (body: B) => void;
  /**
   * Everything an edit can change: a change to any of these is typing. Omit it
   * when the work area marks its own edits by calling `scheduleDraftSave`.
   */
  sources?: WatchSource | WatchSource[];
  /**
   * The saved body, when the work area already tracks it. Given, it is what
   * Discard puts back, and what typing is compared against, in place of
   * `markSaved`'s snapshot. It may be the part of the body that is versioned
   * (content and format, say, without a description that saves on its own).
   */
  savedBody?: () => B;
  /** How the editor body is compared with `savedBody`; JSON equality by default. */
  sameBody?: (editor: B, saved: B) => boolean;
  /**
   * Whether the editor holds what is saved, for a work area whose test is not
   * a comparison of two bodies (trimmed text against a loaded document, say).
   * Takes precedence over `savedBody`/`sameBody`.
   */
  matchesSaved?: () => boolean;
  /**
   * The draft envelope's legacy fields. The store's record is query-shaped
   * (`queryString`, `resultKind`, detected inputs); a query supplies them, and
   * every other section takes the empty defaults.
   */
  envelope?: () => Partial<Pick<
    CallableDraftInput,
    'queryString' | 'resultKind' | 'inputTuples' | 'limitParameters' | 'offsetParameters' | 'outputs'
  >>;
  /** The resultKind a non-query section's envelope carries. */
  resultKind?: ResultKind;
  debounceMs?: number;
}

export function useEntityDraft<B>(options: EntityDraftOptions<B>) {
  const draftsStore = useCallableDrafts();
  const debounceMs = options.debounceMs ?? DRAFT_DEBOUNCE_MS;

  /** When the browser-local draft was last written, for the Details draft row. */
  const locallySavedAt = ref<string | null>(null);
  /** Set while a record is being read, so hydration never lands as an edit. */
  const hydrating = ref(false);
  /** The editor payload of the version on screen, to compare edits against. */
  const savedBody = ref('');
  let handle: ReturnType<typeof setTimeout> | null = null;

  const openDraft = computed(() => {
    // Read so the computed tracks the store, whatever the store's own shape.
    void draftsStore.allDrafts.value;
    const id = options.id();
    return id ? draftsStore.draftFor(id) : null;
  });

  const editCount = computed(() => (options.enabled() ? openDraft.value?.edits ?? 0 : 0));

  /**
   * Held in memory but not in storage — too large, or the quota was reached.
   * A work area shows this beside its draft pill: the edit is not lost yet,
   * but it will not survive a reload.
   */
  const notPersisted = computed(() => {
    const draft = openDraft.value;
    const unpersisted = (draftsStore as { unpersisted?: { value: Set<string> } }).unpersisted;
    return Boolean(draft && unpersisted?.value.has(draft.id));
  });

  /** Typing back to what is saved is an undo, not an edit. */
  function matchesSaved(): boolean {
    if (options.matchesSaved) return options.matchesSaved();
    if (options.savedBody) {
      const same = options.sameBody ?? ((a: B, b: B) => JSON.stringify(a) === JSON.stringify(b));
      return same(options.editorBody(), options.savedBody());
    }
    return JSON.stringify(options.editorBody()) === savedBody.value;
  }

  /** Record the editor's current body as what is saved — after a load or a save. */
  function markSaved() {
    savedBody.value = JSON.stringify(options.editorBody());
  }

  function persistDraft() {
    const id = options.id();
    if (!id || !options.enabled()) return;
    const existing = draftsStore.draftFor(id);
    const envelope = options.envelope?.() ?? {};
    draftsStore.save({
      id: existing?.id ?? `urn:ui-temp:draft-of-${id}`,
      libraryId: options.libraryId() || UNASSIGNED_LIBRARY_ID,
      type: 'query',
      kind: 'draft',
      section: options.section,
      name: options.name(),
      description: options.description?.() || null,
      body: options.editorBody(),
      queryString: envelope.queryString ?? null,
      resultKind: envelope.resultKind ?? options.resultKind ?? 'BINDINGS',
      inputTuples: envelope.inputTuples ?? [],
      limitParameters: envelope.limitParameters ?? [],
      offsetParameters: envelope.offsetParameters ?? [],
      outputs: envelope.outputs ?? [],
      basedOn: id,
      edits: (existing?.edits ?? 0) + 1,
    });
    locallySavedAt.value = new Date().toISOString();
  }

  function removeDraft() {
    const id = options.id();
    if (!id) return;
    const existing = draftsStore.draftFor(id);
    if (existing) draftsStore.remove(existing.id);
    locallySavedAt.value = null;
  }

  function cancelDraftSave() {
    if (!handle) return;
    clearTimeout(handle);
    handle = null;
  }

  /**
   * Read a body into the editor without it counting as typing. The flag clears
   * a microtask later, after the watcher below has seen the change.
   */
  function hydrate(apply: () => void) {
    hydrating.value = true;
    try {
      apply();
    } finally {
      void Promise.resolve().then(() => { hydrating.value = false; });
    }
  }

  /** Put the open draft's body into the editor; false when there is none. */
  function restoreDraft(): boolean {
    const body = openDraft.value?.body;
    if (body === undefined || body === null) return false;
    hydrate(() => options.applyBody(body as B));
    return true;
  }

  /** Throw the unsaved edits away and go back to the saved body. */
  function discardDraft() {
    cancelDraftSave();
    removeDraft();
    if (options.savedBody) {
      const saved = options.savedBody();
      hydrate(() => options.applyBody(saved));
    } else if (savedBody.value) hydrate(() => options.applyBody(JSON.parse(savedBody.value) as B));
  }

  /** An edit happened: write it down once typing pauses. */
  function scheduleDraftSave() {
    if (!options.enabled() || hydrating.value || !options.id()) return;
    cancelDraftSave();
    handle = setTimeout(() => {
      handle = null;
      if (matchesSaved()) {
        removeDraft();
        return;
      }
      persistDraft();
    }, debounceMs);
  }

  /** Write a queued edit now rather than when the debounce would have. */
  function flushDraft() {
    if (!handle) return;
    cancelDraftSave();
    if (options.enabled() && options.id() && !matchesSaved()) persistDraft();
  }

  if (options.sources !== undefined) {
    watch(options.sources, scheduleDraftSave, { deep: true });
  }

  // Closing the record mid-debounce should not lose the edit that was queued.
  onBeforeUnmount(flushDraft);

  return {
    hydrating,
    locallySavedAt,
    savedBody,
    openDraft,
    editCount,
    notPersisted,
    matchesSaved,
    markSaved,
    persistDraft,
    removeDraft,
    cancelDraftSave,
    scheduleDraftSave,
    flushDraft,
    hydrate,
    restoreDraft,
    discardDraft,
  };
}
