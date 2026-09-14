/**
 * Bringing the rest of the screen up to date after something wrote.
 *
 * What survives from the 2026-02-22 sync design: the refresh registry, batching
 * of a burst of changes into one reload, and the concurrency-token refresh that
 * keeps an open editor from hitting a stale 412. What that design had to invent
 * and this deletes: working out *what* changed by reading tool names. The server
 * tells us — an assistant turn names the drafts it staged, and the change feed
 * names the entity each write touched.
 *
 * Two callers, one path. The in-app assistant calls this at the end of a turn;
 * `useLibraryEvents` calls it when an external writer — an MCP client on the
 * other half of a split screen — changes something. The hazard is identical in
 * both cases, which is why this is no longer named after the assistant: a write
 * that bypasses the store's own update path leaves a cached etag stale, and the
 * user's next manual save fails with a 412 they did nothing to earn. Refetching
 * the touched entities is what refreshes those tokens.
 *
 * Batching is per turn (or per burst of frames) rather than per change for the
 * reason the design gives: fewer requests, less flicker, and one "changes
 * applied" moment rather than a screen that twitches five times.
 */
import { useQueriesStore } from './useQueriesStore';

export type LibraryRefreshOptions = {
  /**
   * Saved entities that changed. Each needs its concurrency token
   * refreshed, not just its row.
   */
  changedIds: string[];
  /** The entity the user currently has open, if any. */
  openEntityId?: string | null;
};

export function useLibraryRefresh() {
  const queriesStore = useQueriesStore();

  async function refreshEntities(options: LibraryRefreshOptions): Promise<void> {
    const changed = [...new Set(options.changedIds.filter(Boolean))];

    // The list first: it is what the Build rows and the sidebar read, and it
    // is one request however many entities changed.
    const work: Array<Promise<unknown>> = [queriesStore.loadQueries()];

    // Then a focused fetch per touched entity — the mitigation §6 of the sync
    // design calls required, and the reason it is required is the stale etag
    // above.
    for (const id of changed) {
      work.push(queriesStore.fetchQuery(id).catch(() => undefined));
    }

    // The open editor last, and only if it was not already refreshed.
    const open = options.openEntityId;
    if (open && !changed.includes(open)) {
      work.push(queriesStore.fetchQuery(open).catch(() => undefined));
    }

    await Promise.all(work);
  }

  return { refreshEntities };
}
