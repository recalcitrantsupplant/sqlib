/**
 * Scratch items for one section: creating them, naming them, and bringing the
 * old playground tabs across.
 *
 * A playground is not a place, it is an unsaved item (nav doc §1). Everything
 * a playground tab strip used to do — hold several unsaved bodies, let you
 * switch between them, survive a reload — the scratch cluster in the sidebar
 * does, so the tabs have somewhere to go rather than being thrown away.
 */
import {
  useCallableDrafts,
  UNASSIGNED_LIBRARY_ID,
  type CallableDraft,
  type DraftSection,
} from './useCallableDrafts';

/** Set once the old playground tabs have been read across. */
const MIGRATION_KEY = 'sparql-query-lib-scratch-migrated';

const PLAYGROUND_KEYS: Record<'queries' | 'rules', string> = {
  queries: 'playground.queries.v2.tabs',
  rules: 'playground.rules.v2.tabs',
};

const UNTITLED_PREFIX: Record<DraftSection, string> = {
  query: 'Untitled query',
  group: 'Untitled group',
  rule: 'Untitled rule set',
  etl: 'Untitled pipeline',
  bench: 'Untitled benchmark',
  test: 'Untitled test',
  dataGraph: 'Untitled data graph',
  tupleSet: 'Untitled tuple set',
  argumentSet: 'Untitled argument set',
};

function scratchId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `urn:ui-temp:${crypto.randomUUID()}`;
  }
  return `urn:ui-temp:${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The next free ordinal, not the count.
 *
 * Three items named 1, 2 and 3 with 2 discarded must give 4, never a second 3
 * — two rows with the same name in the same cluster is how the wrong one gets
 * discarded.
 */
export function nextUntitledName(existing: CallableDraft[], section: DraftSection): string {
  const prefix = UNTITLED_PREFIX[section];
  const pattern = new RegExp(`^${prefix} (\\d+)$`);
  let highest = 0;
  for (const item of existing) {
    const match = pattern.exec(item.name);
    if (match) {
      highest = Math.max(highest, Number.parseInt(match[1]!, 10));
    }
  }
  return `${prefix} ${highest + 1}`;
}

export function useScratchItems(section: DraftSection) {
  const store = useCallableDrafts();

  function items(): CallableDraft[] {
    return store.scratchFor(section);
  }

  /** A new, empty scratch item. Returns it so the caller can select it. */
  function create(body: unknown = ''): CallableDraft {
    const id = scratchId();
    store.save({
      id,
      libraryId: UNASSIGNED_LIBRARY_ID,
      type: section === 'group' ? 'group' : 'query',
      kind: 'scratch',
      section,
      name: nextUntitledName(items(), section),
      description: null,
      queryString: typeof body === 'string' ? body : null,
      body,
      resultKind: 'BINDINGS',
      inputTuples: [],
      limitParameters: [],
      offsetParameters: [],
      outputs: [],
      basedOn: null,
    });
    return store.get(id)!;
  }

  /** An empty untitled item dies silently; anything with a body is confirmed. */
  function needsDiscardConfirm(id: string): boolean {
    const item = store.get(id);
    if (!item) return false;
    const body = item.body;
    if (typeof body === 'string') return body.trim().length > 0;
    return body !== null && body !== undefined;
  }

  return { items, create, discard: store.remove, needsDiscardConfirm };
}

/**
 * One-time read of the playground tab storage into scratch records.
 *
 * Idempotent through a marker key, and deliberately non-destructive: the old
 * keys are left in place for a release so a rollback does not lose anyone's
 * work. Losing unsaved work is the worst failure this screen can have, and a
 * migration is exactly where it would happen.
 */
export function migratePlaygroundTabs(): number {
  if (typeof localStorage === 'undefined') return 0;
  if (localStorage.getItem(MIGRATION_KEY)) return 0;

  const store = useCallableDrafts();
  let migrated = 0;

  for (const [type, key] of Object.entries(PLAYGROUND_KEYS) as Array<['queries' | 'rules', string]>) {
    const section: DraftSection = type === 'queries' ? 'query' : 'rule';
    let parsed: unknown;
    try {
      parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;

    for (const entry of parsed) {
      if (!isRecord(entry)) continue;
      if (typeof entry.id !== 'string' || typeof entry.name !== 'string') continue;
      if (!isRecord(entry.content)) continue;

      const body = section === 'query'
        ? (typeof entry.content.query === 'string' ? entry.content.query : '')
        : entry.content;

      // An empty tab carries nothing worth a row in the sidebar; the strip
      // always kept one open whether or not anything was typed into it.
      if (section === 'query' && typeof body === 'string' && body.trim().length === 0) continue;

      const createdAt = typeof entry.createdAt === 'number'
        ? new Date(entry.createdAt).toISOString()
        : new Date().toISOString();
      const updatedAt = typeof entry.updatedAt === 'number'
        ? new Date(entry.updatedAt).toISOString()
        : createdAt;

      store.save({
        // Derived from the tab id, so a repeat run replaces rather than doubles.
        id: `urn:ui-temp:playground-${type}-${entry.id}`,
        libraryId: UNASSIGNED_LIBRARY_ID,
        type: 'query',
        kind: 'scratch',
        section,
        name: entry.name,
        description: null,
        queryString: typeof body === 'string' ? body : null,
        body,
        resultKind: 'BINDINGS',
        inputTuples: [],
        limitParameters: [],
        offsetParameters: [],
        outputs: [],
        basedOn: null,
        createdAt,
        // The tab's own last-touched time, not the migration's: a tab last
        // edited three weeks ago must not arrive looking like it is the
        // newest thing in the list.
        updatedAt,
      });
      migrated += 1;
    }
  }

  localStorage.setItem(MIGRATION_KEY, new Date().toISOString());
  return migrated;
}

export const SCRATCH_MIGRATION_KEY = MIGRATION_KEY;
