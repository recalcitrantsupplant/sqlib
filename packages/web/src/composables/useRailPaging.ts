/**
 * The section rail's saved rows, from the server a page at a time (#197).
 *
 * The rows the rail shows are the union of:
 *
 * - the first pages of the section's kind, filtered and sorted on the server;
 * - the pinned rows, loaded by id, whatever page they are on;
 * - under "Last opened", the rows this browser opened most recently, by id;
 * - under tag grouping, the pages loaded for each tag heading.
 *
 * The section's tag filter (`useSettings`) goes to the server as `tag` and
 * `tagMatch`, so every page, pinned row and heading is inside it. Tag counts
 * come from one `GET /tags/counts` request: one for the headings, inside the
 * filters, and one for the tag menu, over the whole library.
 *
 * The section sort and the tag grouping are this browser's settings
 * (`useSettings`). Pins and last-opened times are this browser's too
 * (`useEntityPins`). The server sorts by every key except "Last opened",
 * which it cannot know, so that key asks the server for name order and the
 * rail puts the opened rows first.
 */
import { computed, reactive, ref, shallowRef, watch, type Ref } from 'vue';
import { useApiClient, type ListPageParams, type PagedEntity, type PagedKind } from './useApiClient';
import { PAGE_SIZE, fetchByIds, usePagedList, type FetchPage } from './usePagedList';
import { useEntityLastOpened, useEntityPins } from './useEntityPins';
import { useSettings } from './useSettings';
import type { EntityListSortKey } from '../lib/entityListSort';
import { tagFilterParams, type TagFilter } from '../lib/tagFilter';

/** The kinds whose rail loads a page at a time. */
export const RAIL_PAGED_KINDS: readonly PagedKind[] = [
  'query', 'queryGroup', 'ruleSet', 'benchmark', 'dataGraph', 'tupleSet', 'argumentSet',
];

/** The API's entity type for each paged kind that can carry tags. */
const TAGGABLE_TYPE: Partial<Record<PagedKind, string>> = {
  query: 'Query',
  queryGroup: 'QueryGroup',
  ruleSet: 'RuleSet',
  dataGraph: 'DataGraph',
  tupleSet: 'TupleSet',
  argumentSet: 'ArgumentSet',
};

export function isRailPaged(kind: string | null | undefined): kind is PagedKind {
  return !!kind && (RAIL_PAGED_KINDS as readonly string[]).includes(kind);
}

/** How many recently opened rows "Last opened" loads by id. */
export const RECENT_ROWS = 100;

const SERVER_SORT: Record<EntityListSortKey, ListPageParams['sort']> = {
  name: 'name',
  modified: 'modified',
  created: 'created',
  creator: 'creator',
  versions: 'versions',
  opened: 'name',
};

export interface RailTag {
  id: string;
}

export function useRailPaging(options: {
  /** The rail section, which keys the sort setting. */
  section: Ref<string | null>;
  /** The kind the section lists, or null when it is not paged. */
  kind: Ref<PagedKind | null>;
  /** The library the section lists, or null for a section that is not library-scoped. */
  library: Ref<string | null>;
  /** The library's tags, for the tag headings. */
  tags: Ref<RailTag[]>;
}) {
  const api = useApiClient();
  const { pins } = useEntityPins();
  const { opened } = useEntityLastOpened();
  const { settings, entityListSortFor, entityListTagFilterFor } = useSettings();

  const search = ref('');

  /* An argument set is listed by library only, so its section needs one. */
  const fetchFor = (kind: PagedKind | null, library: string | null): FetchPage<PagedEntity> | null => {
    if (!kind || (kind === 'argumentSet' && !library)) return null;
    return (params) => api.pageEntities(kind, { ...params, ...(library ? { library } : {}) });
  };

  const fetchPage = () => fetchFor(options.kind.value, options.library.value);

  const sortSetting = computed(() =>
    options.section.value ? entityListSortFor(options.section.value) : { key: 'name' as const, dir: 'asc' as const });

  /** The section's tag filter, without tags the library no longer holds. */
  const tagFilter = computed<TagFilter>(() => {
    const section = options.section.value;
    const stored = section ? entityListTagFilterFor(section) : { tags: [], match: 'all' as const };
    const known = new Set(options.tags.value.map((tag) => tag.id));
    return { tags: stored.tags.filter((id) => known.has(id)), match: stored.match };
  });

  const listParams = computed<ListPageParams>(() => {
    const sort = sortSetting.value;
    const key = SERVER_SORT[sort.key];
    return {
      ...tagFilterParams(tagFilter.value),
      sort: key,
      // "Last opened" asks for name order, which reads A to Z.
      order: sort.key === 'opened' ? 'asc' : sort.dir,
      ...(search.value.trim() ? { q: search.value.trim() } : {}),
    };
  });

  const main = usePagedList<PagedEntity>(fetchPage);

  /** Rows loaded by id: pinned, recently opened. Keyed by id. */
  const byId = shallowRef<Map<string, PagedEntity>>(new Map());

  const groupingByTag = computed(() => settings.value.entityListGrouping === 'tag');

  /** Per tag: how many rows carry it, and the rows loaded under its heading. */
  const tagPages = reactive<Record<string, { total: number; items: PagedEntity[] }>>({});

  let generation = 0;

  async function loadExtras(mine: number) {
    const fetch = fetchPage();
    if (!fetch) return;
    const wanted = new Set<string>([...pins.value]);
    if (sortSetting.value.key === 'opened') {
      Object.entries(opened.value)
        .sort((a, b) => b[1] - a[1])
        .slice(0, RECENT_ROWS)
        .forEach(([id]) => wanted.add(id));
    }
    // The search applies to these rows too, so a search does not show a pin it does not match.
    const rows = wanted.size > 0 ? await fetchByIds(fetch, [...wanted], listParams.value) : [];
    if (mine !== generation) return;
    byId.value = new Map(rows.map((row) => [row.id, row]));
  }

  /** The API type the counts route takes, or null for a kind without tags. */
  const countType = () => (options.kind.value ? TAGGABLE_TYPE[options.kind.value] ?? null : null);

  /** The library filter as the counts route takes it. An argument set always has one. */
  const libraryParam = () => (options.library.value ? { library: options.library.value } : {});

  /** The heading counts: one request, inside the search and the tag filter. */
  async function loadTagTotals(mine: number) {
    for (const key of Object.keys(tagPages)) delete tagPages[key];
    const type = countType();
    if (!fetchPage() || !groupingByTag.value || !type) return;
    const { q, tag, tagMatch } = listParams.value;
    const counts = await api.getTagCounts(type, { ...libraryParam(), q, tag, tagMatch });
    if (mine !== generation) return;
    for (const tagEntry of options.tags.value) {
      const total = counts[tagEntry.id] ?? 0;
      if (total > 0) tagPages[tagEntry.id] = { total, items: [] };
    }
  }

  /** The tag menu's counts: every row of the kind in the library, without filters. */
  const tagCounts = shallowRef<Record<string, number>>({});

  async function loadTagCounts() {
    const type = countType();
    if (!fetchPage() || !type) {
      tagCounts.value = {};
      return;
    }
    const key = JSON.stringify([type, options.library.value]);
    const counts = await api.getTagCounts(type, libraryParam());
    if (key === JSON.stringify([countType(), options.library.value])) tagCounts.value = counts;
  }

  /** How many rows the section holds without the tag filter, while one is set. */
  const unfilteredTotal = ref<number | null>(null);

  async function loadUnfilteredTotal(mine: number) {
    const fetch = fetchPage();
    if (!fetch || tagFilter.value.tags.length === 0) {
      unfilteredTotal.value = null;
      return;
    }
    const { tag: _tag, tagMatch: _match, ...rest } = listParams.value;
    const page = await fetch({ ...rest, limit: 1, offset: 0 });
    if (mine === generation) unfilteredTotal.value = page.total;
  }

  /*
   * What the loaded rows answer: kind, library, sort, search, grouping, tags.
   * `ensureLoaded` reuses a load for the same key, so the section watcher and
   * this composable's own watcher do not load twice.
   */
  const loadKey = computed(() => JSON.stringify([options.kind.value, options.library.value, listParams.value]));
  let loaded: { key: string; promise: Promise<void> } | null = null;

  /*
   * Resolves once the latest load has answered. A load that a later one
   * replaced resolves with nothing, so this waits on the later one too.
   */
  async function ensureLoaded(): Promise<void> {
    if (!loaded || loaded.key !== loadKey.value) void refresh();
    let current: Promise<void>;
    do {
      current = loaded!.promise;
      await current;
    } while (loaded!.promise !== current);
  }

  /** Load the first page and the rows by id, for the current section, library, sort and search. */
  function refresh(): Promise<void> {
    const promise = load();
    loaded = { key: loadKey.value, promise };
    return promise;
  }

  async function load(): Promise<void> {
    const mine = ++generation;
    if (!fetchPage()) {
      main.clear();
      byId.value = new Map();
      for (const key of Object.keys(tagPages)) delete tagPages[key];
      tagCounts.value = {};
      unfilteredTotal.value = null;
      return;
    }
    await Promise.all([
      main.reload(listParams.value),
      loadExtras(mine).catch((err) => console.error('[useRailPaging] Rows by id failed:', err)),
      loadTagTotals(mine).catch((err) => console.error('[useRailPaging] Tag counts failed:', err)),
      loadUnfilteredTotal(mine).catch((err) => console.error('[useRailPaging] Unfiltered count failed:', err)),
      loadTagCounts().catch((err) => console.error('[useRailPaging] Tag menu counts failed:', err)),
    ]);
  }

  /** The next page: of the whole list, or of one tag heading. */
  async function loadMore(tagId: string | null = null): Promise<void> {
    if (!tagId) return main.loadMore();
    const fetch = fetchPage();
    const entry = tagPages[tagId];
    if (!fetch || !entry) return;
    // The heading's own pages, in order. `rows` drops a row the main list also holds.
    const page = await fetch({ ...listParams.value, withTag: [tagId], limit: PAGE_SIZE, offset: entry.items.length });
    entry.total = page.total;
    entry.items = [...entry.items, ...page.items];
  }

  function setSearch(text: string): void {
    if (text === search.value) return;
    search.value = text;
  }

  /** Every row loaded, each once. */
  const rows = computed<PagedEntity[]>(() => {
    const merged = new Map<string, PagedEntity>();
    for (const row of byId.value.values()) merged.set(row.id, row);
    for (const row of main.items.value) merged.set(row.id, row);
    for (const entry of Object.values(tagPages)) for (const row of entry.items) merged.set(row.id, row);
    return [...merged.values()];
  });

  const tagTotals = computed<Record<string, number>>(() =>
    Object.fromEntries(Object.entries(tagPages).map(([id, entry]) => [id, entry.total])));

  /*
   * The open record, which a link can name in any library and on any page.
   * Loaded by id without the library, and kept apart from `rows`, which are
   * this library's only.
   */
  const opened_ = shallowRef<PagedEntity | null>(null);

  async function loadRecord(kind: PagedKind, id: string): Promise<PagedEntity | null> {
    if (opened_.value?.id === id) return opened_.value;
    const known = rows.value.find((row) => row.id === id);
    if (known) return known;
    const fetch = fetchFor(kind, kind === 'argumentSet' ? options.library.value : null);
    if (!fetch) return null;
    const [row] = await fetchByIds(fetch, [id]);
    opened_.value = row ?? null;
    return opened_.value;
  }

  /** A loaded row by id, for the screens that look one up. */
  function lookup(id: string): PagedEntity | undefined {
    if (opened_.value?.id === id) return opened_.value;
    return rows.value.find((row) => row.id === id);
  }

  watch(loadKey, () => { void ensureLoaded(); });
  // The tag headings' counts follow the tags and the grouping; the rows do not.
  watch(
    () => [groupingByTag.value, options.tags.value.map((tag) => tag.id).join('|')] as const,
    () => {
      void loadTagTotals(generation).catch((err) => console.error('[useRailPaging] Tag counts failed:', err));
      void loadTagCounts().catch((err) => console.error('[useRailPaging] Tag menu counts failed:', err));
    },
  );
  // A pin or, under "Last opened", an open adds a row by id.
  watch(
    () => [pins.value, sortSetting.value.key === 'opened' ? opened.value : null] as const,
    () => { void loadExtras(generation).catch(() => {}); },
  );

  return {
    rows,
    total: main.total,
    /** How many rows of the main list are loaded. */
    mainCount: computed(() => main.items.value.length),
    hasMore: main.hasMore,
    loading: main.loading,
    error: main.error,
    tagTotals,
    /** Per tag id, how many rows of the kind carry it in the library. For the tag menu. */
    tagCounts,
    /** The section's count without the tag filter; null when no filter is set. */
    unfilteredTotal,
    search,
    setSearch,
    refresh,
    ensureLoaded,
    loadMore,
    lookup,
    loadRecord,
  };
}
