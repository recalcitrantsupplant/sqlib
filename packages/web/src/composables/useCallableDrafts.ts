/**
 * Browser-local drafts and scratch items.
 *
 * Two record kinds share one store, because they are the same thing seen from
 * two sides:
 *
 * - a **draft** is edits layered on a saved entity (`basedOn` is its id).
 *   Saving it creates a new immutable version — versioned entities cannot
 *   be edited in place, so "save" and "create a version" are the same
 *   operation (Build design §6.4).
 * - a **scratch** item has never been saved and has no server identity at
 *   all. It is what used to be a playground tab. A playground is not a place,
 *   it is an unsaved item (nav doc §1), and this is that item.
 *
 * Keeping them in one store is the point: the sidebar dot, the header pill and
 * the Build screen's rows are three views of one list, and they must never
 * disagree — a tool receipt that says `draft` while the row says `v3` destroys
 * the audit trail the receipts exist to be. It is also why scratch queries
 * surface on the Build screen for free: they are exactly the "the assistant
 * wrote this / it was never saved" state that screen is about.
 *
 * Known limit, and it is the one §9.3 raises: a browser-local record is
 * invisible to an MCP server. When the assistant is wired up, either these move
 * server-side or the client sends bodies with each tool call. That is a
 * decision for the MCP work, not something to pre-empt here — and nothing below
 * forecloses either answer.
 */
import { ref, computed, type Ref } from 'vue';
import type { Covers } from './exhaustiveDomain';
import type { CallableType, ResultKind } from '../lib/callables';

const STORAGE_KEY = 'sparql-query-lib-callable-drafts';

/** Records written before the kind/section split read back as query drafts. */
const DEFAULT_KIND: DraftKind = 'draft';
const DEFAULT_SECTION: DraftSection = 'query';

export type DraftKind = 'draft' | 'scratch';
export type DraftSection = 'query' | 'group' | 'rule' | 'etl' | 'bench' | 'test' | 'dataGraph' | 'tupleSet' | 'argumentSet' | 'notebook';

/** Every draft section, for enumeration. See `exhaustiveDomain.ts`. */
export const DRAFT_SECTIONS = [
  'query', 'group', 'rule', 'etl', 'bench', 'test', 'dataGraph', 'tupleSet', 'argumentSet',
  /*
   * A notebook is an asset like the rest, and lives here for the reason ETL
   * does: it has no server entity yet, so the list a section shows is its
   * scratch cluster and nothing else. Its `body` holds the notebook document
   * (`lib/notebookFormat.ts`).
   */
  'notebook',
] as const satisfies readonly DraftSection[];

export const _draftSectionsCover: Covers<DraftSection, (typeof DRAFT_SECTIONS)[number]> = true;

/** Scratch items have no library until they are saved (nav doc §1). */
export const UNASSIGNED_LIBRARY_ID = 'unassigned';

export interface CallableDraft {
  /** Stable within the browser. `urn:ui-temp:` marks a body with no server id. */
  id: string;
  libraryId: string;
  type: CallableType;
  /**
   * 'draft'   — edits layered on a saved entity (basedOn = its id)
   * 'scratch' — never saved; no server identity at all
   */
  kind: DraftKind;
  /** Section the record belongs to; drafts derive it from what they are based on. */
  section: DraftSection;
  name: string;
  description: string | null;
  /** The SPARQL body for a query record; null for a group record. */
  queryString: string | null;
  /**
   * The editor payload, section by section. Queries mirror `queryString` here
   * so a section-agnostic consumer has one field to read; `save` keeps the two
   * in step so they cannot drift. Rules carry `{dataBlocks, rules}`, ETL its
   * config.
   */
  body: unknown;
  resultKind: ResultKind;
  /** Detected input variables, grouped as VALUES tuples. */
  inputTuples: string[][];
  limitParameters: string[];
  offsetParameters: string[];
  outputs: string[];
  /** Set when the record is an edit of an existing callable rather than a new one. */
  basedOn: string | null;
  /**
   * The backend the record will be saved with, where its section has one.
   * Optional: records written before the Details tab could set it have none,
   * and a section with no backend of its own never writes it.
   */
  defaultBackend?: string | null;
  /**
   * Autosaves since the record began. It is what the `Draft · 3 edits` pill
   * counts — a number, because "you have unsaved work" is easy to ignore
   * and "you have made three changes since v3" is not.
   */
  edits: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a caller must supply; the store stamps the rest.
 *
 * `updatedAt` is accepted but should almost never be passed: a write *is* an
 * update, and the sidebar's ordering depends on that. The one caller with a
 * reason is the playground migration, which is re-recording when the user last
 * touched a tab, not touching it now.
 */
export type CallableDraftInput =
  Omit<CallableDraft, 'kind' | 'section' | 'body' | 'edits' | 'createdAt' | 'updatedAt'>
  & Partial<Pick<CallableDraft, 'kind' | 'section' | 'body' | 'edits' | 'createdAt' | 'updatedAt'>>;

function isDraftKind(value: unknown): value is DraftKind {
  return value === 'draft' || value === 'scratch';
}

/*
 * Derived from the array rather than hand-written, which it was until an
 * omission proved the point: `'tupleSet'` was missing, so a scratch tuple set
 * read back after a reload failed this test, fell through `normalize` to the
 * `'query'` default, and had its rows replaced by `queryString ?? null`. The
 * work was gone and nothing said so. `DRAFT_SECTIONS` already carries a
 * compile-time cover of the union, so reading the predicate off it is the one
 * spelling that cannot fall behind.
 */
function isDraftSection(value: unknown): value is DraftSection {
  return typeof value === 'string' && (DRAFT_SECTIONS as readonly string[]).includes(value);
}

function isDraft(value: unknown): value is CallableDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<CallableDraft>;
  return typeof draft.id === 'string' && typeof draft.libraryId === 'string' && typeof draft.name === 'string';
}

/*
 * Back-compat, and it has to be total: anything already in a user's browser
 * predates kind/section/body/createdAt and must keep working untouched.
 */
function normalize(draft: CallableDraft): CallableDraft {
  const kind = isDraftKind(draft.kind) ? draft.kind : DEFAULT_KIND;
  const section = isDraftSection(draft.section) ? draft.section : DEFAULT_SECTION;
  const updatedAt = typeof draft.updatedAt === 'string' ? draft.updatedAt : new Date().toISOString();
  return {
    ...draft,
    kind,
    section,
    body: section === 'query' ? (draft.queryString ?? null) : (draft.body ?? null),
    edits: typeof draft.edits === 'number' ? draft.edits : 0,
    createdAt: typeof draft.createdAt === 'string' ? draft.createdAt : updatedAt,
    updatedAt,
  };
}

/**
 * Argument-set records used to live in their own store, under their own key.
 *
 * The reason given at the time was that one store with a discriminator "would
 * put argument sets in the nav rail" — which is now the point: an argument set
 * is a rail entity like any other. So the old key is folded in once and
 * removed.
 *
 * Runs before the first read, and only while the old key exists, so it costs
 * one `getItem` per session thereafter. A record that does not convert is
 * dropped rather than throwing: losing one stale draft is better than a
 * sidebar that will not render.
 *
 * Nothing writes the old key any more — `useArgumentSetDrafts` is a view over
 * this store rather than a second one — so this now runs at most once per
 * browser instead of being undone after every load. Kept for one release, for
 * the browsers that still hold a record under it.
 */
const LEGACY_ARGUMENT_SET_KEY = 'sparql-query-lib-argument-set-drafts';

function migrateLegacyArgumentSetDrafts(): CallableDraft[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(LEGACY_ARGUMENT_SET_KEY);
  if (raw === null) return [];
  let migrated: CallableDraft[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      migrated = parsed.flatMap((entry): CallableDraft[] => {
        if (typeof entry !== 'object' || entry === null) return [];
        const legacy = entry as Record<string, unknown>;
        if (typeof legacy.id !== 'string' || typeof legacy.name !== 'string') return [];
        const updatedAt = typeof legacy.updatedAt === 'string' ? legacy.updatedAt : new Date().toISOString();
        return [{
          id: legacy.id,
          libraryId: UNASSIGNED_LIBRARY_ID,
          type: 'query',
          kind: legacy.kind === 'draft' ? 'draft' : 'scratch',
          section: 'argumentSet',
          name: legacy.name,
          description: typeof legacy.description === 'string' ? legacy.description : null,
          queryString: null,
          body: {
            scope: legacy.scope === 'queryGroup' ? 'queryGroup' : legacy.scope === 'query' ? 'query' : null,
            targetId: typeof legacy.targetId === 'string' ? legacy.targetId : null,
            basedOnVersion: typeof legacy.basedOnVersion === 'number' ? legacy.basedOnVersion : null,
            tupleBindings: Array.isArray(legacy.tupleBindings) ? legacy.tupleBindings : [],
            scalarBindings: Array.isArray(legacy.scalarBindings) ? legacy.scalarBindings : [],
            // Carried, not dropped. A group's set is mostly graphs, and hard-coding
            // this to `[]` meant the migration read as a set that had lost its
            // inputs rather than as a set that had moved key.
            graphBindings: Array.isArray(legacy.graphBindings) ? legacy.graphBindings : [],
          },
          resultKind: 'BINDINGS',
          inputTuples: [],
          limitParameters: [],
          offsetParameters: [],
          outputs: [],
          basedOn: typeof legacy.basedOn === 'string' ? legacy.basedOn : null,
          edits: typeof legacy.edits === 'number' ? legacy.edits : 0,
          createdAt: typeof legacy.createdAt === 'string' ? legacy.createdAt : updatedAt,
          updatedAt,
        }];
      });
    }
  } catch {
    migrated = [];
  }
  localStorage.removeItem(LEGACY_ARGUMENT_SET_KEY);
  return migrated;
}

function read(): CallableDraft[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    // Drop anything that does not parse rather than throwing: a stale or
    // hand-edited entry must not take the whole screen down with it.
    const existing = Array.isArray(parsed) ? parsed.filter(isDraft).map(normalize) : [];
    const legacy = migrateLegacyArgumentSetDrafts();
    if (!legacy.length) return existing;
    // The migrated records have to reach storage, not just memory: the old key
    // is gone by now, so a reload that only saw memory would lose them.
    const merged = [...existing, ...legacy.filter((entry) => !existing.some((held) => held.id === entry.id))];
    write(merged);
    return merged;
  } catch {
    return [];
  }
}

function write(drafts: CallableDraft[]) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

/*
 * Module-level so every consumer sees the same list.
 */
const drafts: Ref<CallableDraft[]> = ref(read());

export function useCallableDrafts(libraryId?: Ref<string | null> | null) {
  const forLibrary = computed(() => {
    const id = libraryId?.value ?? null;
    if (!id) return drafts.value;
    return drafts.value.filter((draft) => draft.libraryId === id);
  });

  const scratch = computed(() => drafts.value.filter((draft) => draft.kind === 'scratch'));

  /**
   * Scratch items for one section, newest first — the sidebar's Scratch cluster.
   *
   * Two edits inside the same millisecond share an `updatedAt`, so position is
   * the tie-break: `save` appends, which makes a later index the later write.
   * Without it the order of two fast keystrokes apart items is whatever sort
   * stability happens to give, and the top of the list flickers.
   */
  function scratchFor(section: DraftSection): CallableDraft[] {
    return drafts.value
      .map((draft, index) => ({ draft, index }))
      .filter(({ draft }) => draft.kind === 'scratch' && draft.section === section)
      .sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt) || b.index - a.index)
      .map(({ draft }) => draft);
  }

  /** The open draft for a saved entity, if this browser holds one. */
  function draftFor(entityId: string): CallableDraft | null {
    return drafts.value.find((draft) => draft.kind === 'draft' && draft.basedOn === entityId) ?? null;
  }

  function save(draft: CallableDraftInput) {
    const now = new Date().toISOString();
    const previous = drafts.value.find((existing) => existing.id === draft.id) ?? null;
    const section = draft.section ?? previous?.section ?? DEFAULT_SECTION;
    // Queries keep the body in `queryString` and mirror it into `body`; writing
    // through one path is what stops the two from drifting.
    const queryString = section === 'query'
      ? (typeof draft.body === 'string' ? draft.body : draft.queryString ?? null)
      : draft.queryString ?? null;
    const next = drafts.value.filter((existing) => existing.id !== draft.id);
    next.push({
      ...draft,
      kind: draft.kind ?? previous?.kind ?? DEFAULT_KIND,
      section,
      queryString,
      body: section === 'query' ? queryString : (draft.body ?? previous?.body ?? null),
      edits: draft.edits ?? previous?.edits ?? 0,
      createdAt: draft.createdAt ?? previous?.createdAt ?? now,
      updatedAt: draft.updatedAt ?? now,
    });
    drafts.value = next;
    write(next);
  }

  function remove(id: string) {
    const next = drafts.value.filter((draft) => draft.id !== id);
    drafts.value = next;
    write(next);
  }

  function get(id: string): CallableDraft | null {
    return drafts.value.find((draft) => draft.id === id) ?? null;
  }

  /** Reload from storage — for a spec that seeds drafts before the app mounts. */
  function reload() {
    drafts.value = read();
  }

  function clear() {
    drafts.value = [];
    write([]);
  }

  return {
    drafts: forLibrary,
    allDrafts: drafts,
    scratch,
    scratchFor,
    draftFor,
    save,
    remove,
    get,
    reload,
    clear,
  };
}

export const CALLABLE_DRAFTS_STORAGE_KEY = STORAGE_KEY;
