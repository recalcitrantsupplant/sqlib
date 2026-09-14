/**
 * Browser-local argument sets: scratch sets, and drafts on saved ones.
 *
 * An argument set is a versioned entity like any other, so it gets the same two
 * unsaved states a query gets (`useCallableDrafts`):
 *
 * - a **scratch** set has never been saved and has no server identity. It
 *   is the set you start typing into before you have decided it is worth a
 *   name — the state the old panel had no room for, which is why every set
 *   used to arrive named "New Argument Set" and saved on the first keystroke.
 * - a **draft** is edits layered on a saved set (`basedOn` is its id).
 *   Saving it creates a new version, because a saved version is
 *   immutable and "save" and "create a version" are the same operation.
 *
 * Separate from `useCallableDrafts` on purpose. The callable store's records
 * carry a query body, a section and a result kind — none of which an argument
 * set has — and its sidebar reads every record in it as something that appears
 * in the Scratch cluster, which an argument set must not. One store with a
 * discriminator would put arguments in the nav rail.
 */
import { computed, ref, type Ref } from 'vue';
import type { ArgumentGraphBinding, ArgumentScalarBinding, ArgumentTupleBinding } from '../types/argument-sets';

const STORAGE_KEY = 'sparql-query-lib-argument-set-drafts';

/** Marks a set with no server id, matching the callable store's convention. */
export const SCRATCH_ID_PREFIX = 'urn:ui-temp:argument-set:';

export type ArgumentSetDraftKind = 'scratch' | 'draft';
export type ArgumentSetScope = 'query' | 'queryGroup';

export interface ArgumentSetDraft {
  /** Stable within the browser. Scratch ids carry `SCRATCH_ID_PREFIX`. */
  id: string;
  kind: ArgumentSetDraftKind;
  scope: ArgumentSetScope;
  /** The query or group the set was made against — provenance, not a fence. */
  targetId: string;
  name: string;
  description: string | null;
  /** The saved set these edits sit on; null for scratch. */
  basedOn: string | null;
  /** The version the edits were taken from, so the panel can offer "Diff v2". */
  basedOnVersion: number | null;
  tupleBindings: ArgumentTupleBinding[];
  scalarBindings: ArgumentScalarBinding[];
  /**
   * The graphs this set hands over, in order. Optional so a record written
   * before graphs reached the group screen still reads.
   */
  graphBindings?: ArgumentGraphBinding[];
  /** Autosaves since the record began — what the `Draft · 2 edits` pill counts. */
  edits: number;
  createdAt: string;
  updatedAt: string;
}

export type ArgumentSetDraftInput =
  Omit<ArgumentSetDraft, 'edits' | 'createdAt' | 'updatedAt' | 'description' | 'basedOn' | 'basedOnVersion'>
  & Partial<Pick<ArgumentSetDraft, 'edits' | 'createdAt' | 'updatedAt' | 'description' | 'basedOn' | 'basedOnVersion'>>;

function isRecord(value: unknown): value is ArgumentSetDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<ArgumentSetDraft>;
  return typeof draft.id === 'string'
    && typeof draft.targetId === 'string'
    && (draft.kind === 'scratch' || draft.kind === 'draft');
}

function normalize(draft: ArgumentSetDraft): ArgumentSetDraft {
  const updatedAt = typeof draft.updatedAt === 'string' ? draft.updatedAt : new Date().toISOString();
  return {
    ...draft,
    scope: draft.scope === 'queryGroup' ? 'queryGroup' : 'query',
    name: typeof draft.name === 'string' ? draft.name : '',
    description: typeof draft.description === 'string' ? draft.description : null,
    basedOn: typeof draft.basedOn === 'string' ? draft.basedOn : null,
    basedOnVersion: typeof draft.basedOnVersion === 'number' ? draft.basedOnVersion : null,
    tupleBindings: Array.isArray(draft.tupleBindings) ? draft.tupleBindings : [],
    scalarBindings: Array.isArray(draft.scalarBindings) ? draft.scalarBindings : [],
    graphBindings: Array.isArray(draft.graphBindings) ? draft.graphBindings : [],
    edits: typeof draft.edits === 'number' ? draft.edits : 0,
    createdAt: typeof draft.createdAt === 'string' ? draft.createdAt : updatedAt,
    updatedAt,
  };
}

function read(): ArgumentSetDraft[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    // Drop what does not parse rather than throwing: one hand-edited entry
    // must not take the arguments tab down with it.
    return parsed.filter(isRecord).map(normalize);
  } catch {
    return [];
  }
}

function write(drafts: ArgumentSetDraft[]) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

/** Module-level so every panel on screen sees the same list. */
const drafts: Ref<ArgumentSetDraft[]> = ref(read());

let sequence = 0;

/** A scratch id that does not depend on `crypto` being present in a test env. */
export function newScratchId(): string {
  sequence += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${SCRATCH_ID_PREFIX}${Date.now().toString(36)}-${sequence}-${random}`;
}

export function useArgumentSetDrafts() {
  /** Scratch sets made against one target, newest first. */
  function scratchFor(targetId: string | null): ArgumentSetDraft[] {
    if (!targetId) return [];
    return drafts.value
      .map((draft, index) => ({ draft, index }))
      .filter(({ draft }) => draft.kind === 'scratch' && draft.targetId === targetId)
      // Two writes in the same millisecond share `updatedAt`; `save` appends,
      // so a later index is the later write and breaks the tie stably.
      .sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt) || b.index - a.index)
      .map(({ draft }) => draft);
  }

  /** The open draft on a saved set, if this browser holds one. */
  function draftFor(setId: string | null): ArgumentSetDraft | null {
    if (!setId) return null;
    return drafts.value.find((draft) => draft.kind === 'draft' && draft.basedOn === setId) ?? null;
  }

  function get(id: string | null): ArgumentSetDraft | null {
    if (!id) return null;
    return drafts.value.find((draft) => draft.id === id) ?? null;
  }

  /**
   * Write a record, bumping `edits` unless the caller pins it.
   *
   * The bump is here rather than at the call site because the edit count is
   * what the header pill reads, and a caller that forgets to increment it
   * saves a set that claims it was never touched.
   */
  function save(input: ArgumentSetDraftInput): ArgumentSetDraft {
    const now = new Date().toISOString();
    const previous = drafts.value.find((existing) => existing.id === input.id) ?? null;
    const record = normalize({
      ...input,
      description: input.description ?? previous?.description ?? null,
      basedOn: input.basedOn ?? previous?.basedOn ?? null,
      basedOnVersion: input.basedOnVersion ?? previous?.basedOnVersion ?? null,
      edits: input.edits ?? (previous ? previous.edits + 1 : 0),
      createdAt: input.createdAt ?? previous?.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    } as ArgumentSetDraft);

    const next = drafts.value.filter((existing) => existing.id !== input.id);
    next.push(record);
    drafts.value = next;
    write(next);
    return record;
  }

  function remove(id: string) {
    const next = drafts.value.filter((draft) => draft.id !== id);
    drafts.value = next;
    write(next);
  }

  /** Throw away every local record for a target — after its set is deleted. */
  function removeForTarget(targetId: string) {
    const next = drafts.value.filter((draft) => draft.targetId !== targetId);
    drafts.value = next;
    write(next);
  }

  /** Reload from storage — for a spec that seeds records before the app mounts. */
  function reload() {
    drafts.value = read();
  }

  function clear() {
    drafts.value = [];
    write([]);
  }

  return {
    all: computed(() => drafts.value),
    scratchFor,
    draftFor,
    get,
    save,
    remove,
    removeForTarget,
    reload,
    clear,
  };
}

export const ARGUMENT_SET_DRAFTS_STORAGE_KEY = STORAGE_KEY;
