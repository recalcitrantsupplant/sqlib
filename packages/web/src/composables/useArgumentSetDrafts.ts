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
 * **One browser-local draft store, keyed by section.** This module used to own
 * a second store under its own key, kept separate so that argument sets would
 * stay out of the nav rail. That reason was retired the day an argument set
 * became a rail entity, and the split outlived it: the rail read scratch
 * through `useCallableDrafts`, the query screen wrote here, and a set made on a
 * query never reached the rail in that session — it appeared after a reload,
 * because the legacy-key migration runs at module load, which made a missing
 * write read as a caching glitch. Worse, editing such a set after the first
 * reload wrote back to the legacy key, whose record the next migration skipped
 * as a duplicate id before deleting the key: those edits were gone.
 *
 * So this is no longer a store. It is a *view* over `useCallableDrafts`'s
 * `argumentSet` section — one store, one module-level ref, one key — that keeps
 * speaking in argument-set terms so the panel does not have to unpack a
 * callable record to read a binding.
 */
import { computed } from 'vue';
import type { ArgumentGraphBinding, ArgumentScalarBinding, ArgumentTupleBinding } from '../types/argument-sets';
import {
  useCallableDrafts,
  UNASSIGNED_LIBRARY_ID,
  CALLABLE_DRAFTS_STORAGE_KEY,
  type CallableDraft,
} from './useCallableDrafts';

/** The section every record written here belongs to. */
const SECTION = 'argumentSet' as const;

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

/** The argument-set half of a callable record, as `save` writes it. */
interface ArgumentSetBody {
  scope: ArgumentSetScope | null;
  targetId: string | null;
  basedOnVersion: number | null;
  tupleBindings: ArgumentTupleBinding[];
  scalarBindings: ArgumentScalarBinding[];
  graphBindings: ArgumentGraphBinding[];
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Read a callable record as an argument set.
 *
 * Total by construction: a record hand-edited in storage, or written by a
 * release that did not yet carry one of these fields, reads back as an empty
 * binding list rather than throwing and taking the panel down with it.
 */
function toArgumentSetDraft(record: CallableDraft): ArgumentSetDraft {
  const body = (typeof record.body === 'object' && record.body !== null ? record.body : {}) as Partial<ArgumentSetBody>;
  return {
    id: record.id,
    kind: record.kind === 'draft' ? 'draft' : 'scratch',
    scope: body.scope === 'queryGroup' ? 'queryGroup' : 'query',
    targetId: typeof body.targetId === 'string' ? body.targetId : '',
    name: record.name,
    description: typeof record.description === 'string' ? record.description : null,
    basedOn: typeof record.basedOn === 'string' ? record.basedOn : null,
    basedOnVersion: typeof body.basedOnVersion === 'number' ? body.basedOnVersion : null,
    tupleBindings: asArray<ArgumentTupleBinding>(body.tupleBindings),
    scalarBindings: asArray<ArgumentScalarBinding>(body.scalarBindings),
    graphBindings: asArray<ArgumentGraphBinding>(body.graphBindings),
    edits: typeof record.edits === 'number' ? record.edits : 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

let sequence = 0;

/** A scratch id that does not depend on `crypto` being present in a test env. */
export function newScratchId(): string {
  sequence += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${SCRATCH_ID_PREFIX}${Date.now().toString(36)}-${sequence}-${random}`;
}

export function useArgumentSetDrafts() {
  const store = useCallableDrafts();

  /** Every argument-set record in the shared store, newest write last. */
  const records = computed(() => store.allDrafts.value.filter((draft) => draft.section === SECTION));

  /** Scratch sets made against one target, newest first. */
  function scratchFor(targetId: string | null): ArgumentSetDraft[] {
    if (!targetId) return [];
    return store.scratchFor(SECTION)
      .map(toArgumentSetDraft)
      .filter((draft) => draft.targetId === targetId);
  }

  /** The open draft on a saved set, if this browser holds one. */
  function draftFor(setId: string | null): ArgumentSetDraft | null {
    if (!setId) return null;
    const found = records.value.find((draft) => draft.kind === 'draft' && draft.basedOn === setId);
    return found ? toArgumentSetDraft(found) : null;
  }

  function get(id: string | null): ArgumentSetDraft | null {
    if (!id) return null;
    const found = records.value.find((draft) => draft.id === id);
    return found ? toArgumentSetDraft(found) : null;
  }

  /**
   * Write a record, bumping `edits` unless the caller pins it.
   *
   * The bump is here rather than at the call site because the edit count is
   * what the header pill reads, and a caller that forgets to increment it
   * saves a set that claims it was never touched. The shared store takes the
   * number as given, so this is the one place that knows how it grows.
   */
  function save(input: ArgumentSetDraftInput): ArgumentSetDraft {
    const now = new Date().toISOString();
    const previous = get(input.id);
    const body: ArgumentSetBody = {
      scope: input.scope === 'queryGroup' ? 'queryGroup' : 'query',
      targetId: input.targetId,
      basedOnVersion: input.basedOnVersion ?? previous?.basedOnVersion ?? null,
      tupleBindings: asArray<ArgumentTupleBinding>(input.tupleBindings),
      scalarBindings: asArray<ArgumentScalarBinding>(input.scalarBindings),
      graphBindings: asArray<ArgumentGraphBinding>(input.graphBindings),
    };
    store.save({
      id: input.id,
      libraryId: UNASSIGNED_LIBRARY_ID,
      type: input.scope === 'queryGroup' ? 'group' : 'query',
      kind: input.kind,
      section: SECTION,
      name: typeof input.name === 'string' ? input.name : '',
      description: input.description ?? previous?.description ?? null,
      queryString: null,
      body,
      resultKind: 'BINDINGS',
      inputTuples: [],
      limitParameters: [],
      offsetParameters: [],
      outputs: [],
      basedOn: input.basedOn ?? previous?.basedOn ?? null,
      edits: input.edits ?? (previous ? previous.edits + 1 : 0),
      createdAt: input.createdAt ?? previous?.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    });
    return get(input.id)!;
  }

  function remove(id: string) {
    store.remove(id);
  }

  /** Throw away every local record for a target — after its set is deleted. */
  function removeForTarget(targetId: string) {
    for (const draft of records.value) {
      if (toArgumentSetDraft(draft).targetId === targetId) store.remove(draft.id);
    }
  }

  /** Reload from storage — for a spec that seeds records before the app mounts. */
  function reload() {
    store.reload();
  }

  /** Drop the argument-set records only; the shared store holds other sections. */
  function clear() {
    for (const draft of [...records.value]) store.remove(draft.id);
  }

  return {
    all: computed(() => records.value.map(toArgumentSetDraft)),
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

/**
 * The key these records actually live under, which is the callable store's.
 *
 * Kept as an export because callers (and specs) reach for "where do argument
 * set drafts live" by this name; it resolves to one key now, which is the whole
 * point of the collapse above.
 */
export const ARGUMENT_SET_DRAFTS_STORAGE_KEY = CALLABLE_DRAFTS_STORAGE_KEY;
