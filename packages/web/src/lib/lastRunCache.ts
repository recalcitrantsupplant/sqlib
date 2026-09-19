/**
 * The last run of a record, kept in the browser until the next one.
 *
 * A run is not part of what was run: the same query against the same backend
 * can answer differently a minute later, so a result is never written back to
 * the entity. But holding it only in the component was its own problem — open
 * another query, come back, and the answer you were reading is gone, with
 * nothing to say it ever arrived. The rows had to be fetched again to be read
 * again.
 *
 * So the last result lives here: browser-local, this-machine-only, one entry
 * per record, replaced by the next run of that record. It is the same bargain
 * the scratch store makes for unsaved bodies, and the same one
 * `testRunCache.ts` makes for verdicts — which this is deliberately separate
 * from, because a verdict is pass/fail about a test and this is the response
 * itself, and they are evicted for different reasons.
 *
 * Durable, shared run history is a server-side concern (issue #179) and is a
 * different thing from this.
 */

const STORAGE_KEY = 'sqlib.lastRuns.v1';

/**
 * Roughly 2 MB of the ~5 MB browsers allow, leaving room for the scratch store
 * and the verdict cache, which share the same budget. The oldest entries go
 * first when a new one does not fit.
 */
const MAX_BYTES = 2_000_000;

/**
 * No single result may take more than half the budget.
 *
 * A CONSTRUCT over a large graph can answer with megabytes, and letting one
 * such answer in would evict every other record's run to hold it — then be
 * evicted itself by the next one. Over this, the result stays on screen for as
 * long as the pane is open and is simply not kept.
 */
const MAX_ENTRY_BYTES = 1_000_000;

interface Entry {
  /** ISO time the run was recorded, for eviction order. */
  ranAt: string;
  /** Whatever the screen needs to redraw its result. Opaque here. */
  payload: unknown;
}

type EntryMap = Record<string, Entry>;

function storage(): Storage | null {
  // Nuxt prerenders this app, and a private-mode browser can throw on access
  // rather than on write. Neither is worth failing a page load over.
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<Entry>;
  return typeof entry.ranAt === 'string' && 'payload' in entry;
}

function readAll(): EntryMap {
  const store = storage();
  if (!store) return {};
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const entries: EntryMap = {};
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEntry(entry)) entries[key] = entry;
    }
    return entries;
  } catch {
    // A half-written or stale-shaped payload is not worth recovering; the next
    // run rewrites it.
    return {};
  }
}

function writeAll(entries: EntryMap): void {
  const store = storage();
  if (!store) return;
  let remaining = Object.entries(entries);
  for (;;) {
    const payload = JSON.stringify(Object.fromEntries(remaining));
    if (payload.length <= MAX_BYTES) {
      try {
        store.setItem(STORAGE_KEY, payload);
      } catch {
        // Quota is shared, so another tab or feature can take it out from
        // under us. A missing cache degrades to the old session-only
        // behaviour: the result is on screen until the pane closes.
      }
      return;
    }
    if (remaining.length <= 1) {
      try {
        store.removeItem(STORAGE_KEY);
      } catch {
        /* nothing to do */
      }
      return;
    }
    // Oldest first.
    remaining = [...remaining]
      .sort(([, left], [, right]) => left.ranAt.localeCompare(right.ranAt))
      .slice(1);
  }
}

/**
 * The key a record's run is held under.
 *
 * `kind` keeps a query and a rule set that happen to share an id apart, and
 * scratch records — whose ids are minted by the browser — apart from saved
 * ones. Null where there is nothing to key by, which is a record being created
 * and has no run worth keeping yet.
 */
export function runCacheKey(kind: string, id: string | null | undefined): string | null {
  return id ? `${kind}:${id}` : null;
}

/** The last run recorded for this key, or null. */
export function loadLastRun<T>(key: string | null): T | null {
  if (!key) return null;
  const entry = readAll()[key];
  return entry ? (entry.payload as T) : null;
}

/**
 * Record this run as the record's last, replacing whatever it held.
 *
 * A payload over `MAX_ENTRY_BYTES` is dropped rather than stored, and drops
 * the previous entry with it: keeping the older, smaller result under the same
 * key would say the record's last run produced something it did not.
 */
export function saveLastRun(key: string | null, payload: unknown): void {
  if (!key) return;
  const entries = readAll();
  let serialised: string;
  try {
    serialised = JSON.stringify(payload ?? null);
  } catch {
    // Circular or otherwise unserialisable — nothing to keep.
    delete entries[key];
    writeAll(entries);
    return;
  }
  if (serialised.length > MAX_ENTRY_BYTES) {
    delete entries[key];
    writeAll(entries);
    return;
  }
  entries[key] = { ranAt: new Date().toISOString(), payload: JSON.parse(serialised) };
  writeAll(entries);
}

/** Forget one record's run — it was deleted, or its result no longer applies. */
export function forgetLastRun(key: string | null): void {
  if (!key) return;
  const entries = readAll();
  if (!(key in entries)) return;
  delete entries[key];
  writeAll(entries);
}
