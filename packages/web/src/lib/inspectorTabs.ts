/**
 * The inspector tab each rail last showed, kept in this browser.
 *
 * A work area is mounted again each time its rail is opened, so a tab held in
 * the component went back to its first tab after a visit to another rail. The
 * tab is kept per rail, not per record: moving between two queries keeps the
 * tab, and a query with no run yet shows the empty Results tab.
 *
 * It is a convenience, the same bargain `backendDefaults.ts` makes for the
 * last backend: browser-local, read by nothing else, and lost without harm.
 */
import { ref, watch, type Ref } from 'vue';

const STORAGE_KEY = 'sqlib.inspectorTabs.v1';

export type InspectorRail = 'query' | 'ruleSet';

function storage(): Storage | null {
  // Prerendering has no window, and a private-mode browser can throw on access.
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readAll(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === 'string' && value),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

/** The tab this rail last showed, if it is one of `allowed`. */
export function getRememberedTab<T extends string>(rail: InspectorRail, allowed: readonly T[]): T | null {
  const tab = readAll()[rail];
  return tab && (allowed as readonly string[]).includes(tab) ? (tab as T) : null;
}

export function rememberTab(rail: InspectorRail, tab: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [rail]: tab }));
  } catch {
    // Full or blocked storage costs the convenience, nothing else.
  }
}

/**
 * A tab ref that starts on the rail's last tab and remembers each change.
 *
 * `fallback` is the tab when nothing is remembered.
 */
export function useRememberedTab<T extends string>(rail: InspectorRail, allowed: readonly T[], fallback: T): Ref<T> {
  const tab = ref(getRememberedTab(rail, allowed) ?? fallback) as Ref<T>;
  watch(tab, (value) => rememberTab(rail, value));
  return tab;
}
