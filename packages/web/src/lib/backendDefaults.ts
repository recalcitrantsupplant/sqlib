/**
 * Which backend a run starts on, and the browser's memory of the last pick.
 *
 * The order is the same everywhere a query runs — the query screen, a notebook
 * cell, a query group node:
 *
 *   1. the backend this browser last ran this query on, in this environment,
 *   2. the active environment's default, when the query's library has one,
 *   3. the query's own default,
 *   4. its library's default,
 *   5. nothing — the run bar stays empty and Run waits for a choice.
 *
 * The environment's default comes before the query's own so that a dev, test
 * and prod chain runs each environment on its own backend. Outside an
 * environment (`latest`) step 2 does not apply. A query group node takes its
 * backend when it is placed, so it uses steps 3 and 4 only.
 *
 * There is no silent fall to the in-memory store at the end: an answer from an
 * empty store looks like a real answer. An ETL job is the exception, because a
 * scratch load is what ETL is usually for: last pick, then the job's default,
 * then the in-memory store, and never the library's default.
 *
 * The last pick is browser-local, one per entity, the same bargain
 * `lastRunCache.ts` makes. It is a convenience, never a setting: nothing else
 * reads it and nothing is lost when it is cleared.
 */
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';

const STORAGE_KEY = 'sqlib.lastBackends.v1';

/** Enough for every query anyone works with; the oldest picks go first. */
const MAX_ENTRIES = 500;

export type BackendPickKind = 'query' | 'etlJob';

type PickMap = Record<string, { backendId: string; at: number }>;

function storage(): Storage | null {
  // Prerendering has no window, and a private-mode browser can throw on access.
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readAll(): PickMap {
  const store = storage();
  if (!store) return {};
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const picks: PickMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as { backendId?: unknown; at?: unknown } | null;
      if (entry && typeof entry.backendId === 'string' && entry.backendId && typeof entry.at === 'number') {
        picks[key] = { backendId: entry.backendId, at: entry.at };
      }
    }
    return picks;
  } catch {
    return {};
  }
}

function writeAll(picks: PickMap): void {
  const store = storage();
  if (!store) return;
  const kept = Object.entries(picks)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_ENTRIES);
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Full or blocked storage costs the convenience, not the run.
  }
}

/*
 * One pick per entity and environment: a pick made in dev must not follow the
 * query into prod. `latest` keeps the key it had before environments existed.
 */
const keyFor = (kind: BackendPickKind, id: string, environment?: string | null) =>
  environment && environment !== 'latest' ? `${kind}:${id}@${environment}` : `${kind}:${id}`;

/** The backend this browser last ran this entity on in this environment, if any. */
export function getLastBackend(
  kind: BackendPickKind,
  id: string | null | undefined,
  environment?: string | null,
): string | null {
  if (!id) return null;
  return readAll()[keyFor(kind, id, environment)]?.backendId ?? null;
}

/** Remember the backend a run was pointed at; an empty value forgets it. */
export function setLastBackend(
  kind: BackendPickKind,
  id: string | null | undefined,
  backendId: string | null,
  environment?: string | null,
): void {
  if (!id) return;
  const picks = readAll();
  const key = keyFor(kind, id, environment);
  if (backendId) {
    picks[key] = { backendId, at: Date.now() };
  } else {
    delete picks[key];
  }
  writeAll(picks);
}

export interface QueryBackendSources {
  lastPick?: string | null;
  /** The active environment's default, when the query's library defines it. */
  environmentDefault?: string | null;
  queryDefault?: string | null;
  libraryDefault?: string | null;
  /**
   * Whether a backend can still be run against. A last pick or a default that
   * names a backend deleted since is skipped rather than chosen. Omit it while
   * the list is still loading, and every candidate is taken at its word.
   */
  isAvailable?: (backendId: string) => boolean;
}

function firstAvailable(candidates: Array<string | null | undefined>, isAvailable?: (id: string) => boolean): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!isAvailable || isAvailable(candidate)) return candidate;
  }
  return null;
}

/** Where a query run starts: last pick, environment, query, library default, else nothing. */
export function resolveQueryBackend(sources: QueryBackendSources): string | null {
  return firstAvailable(
    [sources.lastPick, sources.environmentDefault, sources.queryDefault, sources.libraryDefault],
    sources.isAvailable,
  );
}

/** The default a query runs on when no pick is remembered. */
export function resolveQueryDefault(sources: Omit<QueryBackendSources, 'lastPick'>): string | null {
  return firstAvailable(
    [sources.environmentDefault, sources.queryDefault, sources.libraryDefault],
    sources.isAvailable,
  );
}

export type QueryDefaultSource = 'environment' | 'query' | 'library';

/** Which default `resolveQueryDefault` chose, for labelling it. */
export function queryDefaultSource(sources: Omit<QueryBackendSources, 'lastPick'>): QueryDefaultSource | null {
  const candidates: Array<[QueryDefaultSource, string | null | undefined]> = [
    ['environment', sources.environmentDefault],
    ['query', sources.queryDefault],
    ['library', sources.libraryDefault],
  ];
  for (const [source, candidate] of candidates) {
    if (candidate && (!sources.isAvailable || sources.isAvailable(candidate))) return source;
  }
  return null;
}

export interface EtlBackendSources {
  lastPick?: string | null;
  jobDefault?: string | null;
  isAvailable?: (backendId: string) => boolean;
}

/** Where an ETL run starts: last pick, the job's default, else the in-memory store. */
export function resolveEtlBackend(sources: EtlBackendSources): string {
  return firstAvailable([sources.lastPick, sources.jobDefault], sources.isAvailable) ?? EPHEMERAL_BACKEND_ID;
}
