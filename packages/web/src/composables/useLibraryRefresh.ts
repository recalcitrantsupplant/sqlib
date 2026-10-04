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
 *
 * Dispatch is by entity. The feed names the kind of every write (`query`,
 * `ruleSet`, `dataGraph`, …, the `entity` field of `api/src/lib/changeEvents.ts`)
 * and each kind has its own store; sending a rule set's id to the queries store
 * fetched `GET /queries/<ruleSetId>`, which 404ed into a swallowed catch and
 * left the rule-set editor stale with a stale etag.
 */
import { useArgumentSetsStore } from './useArgumentSetsStore';
import { useBackendsStore } from './useBackendsStore';
import { useBenchmarksStore } from './useBenchmarksStore';
import { useDataGraphsStore } from './useDataGraphsStore';
import { useEtlJobsStore } from './useEtlJobsStore';
import { useLibrariesStore } from './useLibrariesStore';
import { useQueriesStore } from './useQueriesStore';
import { useQueryGroupsStore } from './useQueryGroupsStore';
import { useRuleSetsStore } from './useRuleSetsStore';
import { useTestsStore } from './useTestsStore';

/** A saved entity a write touched, by the feed's entity name and its id. */
export interface ChangedEntity {
  entity: string;
  id: string | null;
}

export type LibraryRefreshOptions = {
  /**
   * Saved entities that changed. Each needs its concurrency token
   * refreshed, not just its row.
   */
  changed: ChangedEntity[];
  /** The entity the user currently has open, if any. */
  open?: ChangedEntity | null;
  /** The library the screen is scoped to, for stores whose list is per library. */
  libraryId?: string | null;
};

/** What a refresher may need to know about the screen. */
export interface RefreshContext {
  libraryId: string | null;
}

/**
 * How one kind of entity is brought up to date: its list, and (where the store
 * keeps a concurrency token per record) the one record.
 */
export interface EntityRefresher {
  reload?: () => Promise<unknown>;
  refreshOne?: (id: string) => Promise<unknown>;
}

/**
 * Feed entity name → its store. Built lazily so a caller only instantiates the
 * stores a batch actually names.
 *
 * Not every name the API emits is here: `rule` and `dataBlock` have no store
 * of their own (their work areas fetch on open), so a change to one refreshes
 * nothing but still reaches `onChange` listeners.
 */
export const ENTITY_REFRESHERS: Record<string, (context: RefreshContext) => EntityRefresher> = {
  query: () => {
    const store = useQueriesStore();
    return { reload: store.loadQueries, refreshOne: store.fetchQuery };
  },
  queryGroup: () => {
    const store = useQueryGroupsStore();
    return { reload: store.loadQueryGroups, refreshOne: store.fetchQueryGroup };
  },
  ruleSet: () => {
    const store = useRuleSetsStore();
    return { reload: store.fetchRuleSets, refreshOne: store.fetchRuleSet };
  },
  dataGraph: () => {
    const store = useDataGraphsStore();
    return { reload: store.loadDataGraphs, refreshOne: store.getDataGraph };
  },
  test: () => {
    const store = useTestsStore();
    return { reload: store.loadTests, refreshOne: store.loadVersions };
  },
  argumentSet: ({ libraryId }) => {
    const store = useArgumentSetsStore();
    // Listed per library only: an unscoped load empties the list.
    return {
      reload: libraryId ? () => store.loadArgumentSets({ library: libraryId }) : undefined,
      refreshOne: store.loadVersions,
    };
  },
  backend: () => {
    const store = useBackendsStore();
    return { reload: store.loadBackends, refreshOne: store.fetchBackend };
  },
  library: () => {
    const store = useLibrariesStore();
    return { reload: store.loadLibraries, refreshOne: store.fetchLibrary };
  },
  benchmarkExperiment: () => {
    const store = useBenchmarksStore();
    return { reload: store.loadExperiments, refreshOne: store.fetchExperiment };
  },
  etlJob: () => {
    const store = useEtlJobsStore();
    return { reload: store.loadEtlJobs, refreshOne: store.fetchEtlJob };
  },
};

export function useLibraryRefresh(
  registry: Record<string, (context: RefreshContext) => EntityRefresher> = ENTITY_REFRESHERS
) {
  async function refreshEntities(options: LibraryRefreshOptions): Promise<void> {
    const context: RefreshContext = { libraryId: options.libraryId ?? null };
    // Ids per entity, deduplicated; an entity with no id still reloads its list.
    const byEntity = new Map<string, Set<string>>();
    for (const change of options.changed) {
      if (!change.entity) continue;
      const ids = byEntity.get(change.entity) ?? new Set<string>();
      if (change.id) ids.add(change.id);
      byEntity.set(change.entity, ids);
    }

    const work: Array<Promise<unknown>> = [];

    for (const [entity, ids] of byEntity) {
      const make = registry[entity];
      if (!make) continue;
      const refresher = make(context);
      // The list first: it is what the sidebar reads, and it is one request
      // however many entities of the kind changed.
      if (refresher.reload) work.push(refresher.reload());
      // Then a focused fetch per touched entity — the mitigation §6 of the sync
      // design calls required, and the reason it is required is the stale etag
      // above.
      if (refresher.refreshOne) {
        for (const id of ids) work.push(refresher.refreshOne(id).catch(() => undefined));
      }
    }

    // The open editor last, and only if it was not already refreshed.
    const open = options.open;
    if (open?.id && !byEntity.get(open.entity)?.has(open.id)) {
      const refresher = registry[open.entity]?.(context);
      if (refresher?.refreshOne) work.push(refresher.refreshOne(open.id).catch(() => undefined));
    }

    await Promise.all(work.map((p) => p.catch(() => undefined)));
  }

  return { refreshEntities };
}
