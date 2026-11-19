/**
 * A list that loads from the server one page at a time (#197).
 *
 * Every paged list in the web goes through this: the section rail, and the
 * pickers that search on the server. The caller gives a `fetchPage`, which is
 * one of the client's paged calls (`pageEntities`, `pageLibraryArgumentSets`).
 * The server applies the filter and the sort, so `items` is always a prefix of
 * the full ordered list, and `total` counts every match.
 */
import { computed, ref, shallowRef } from 'vue';
import type { ListPage, ListPageParams } from './useApiClient';

/** How many rows one request lists. */
export const PAGE_SIZE = 50;

const IDS_PER_REQUEST = 100;

export type FetchPage<T> = (params: ListPageParams) => Promise<ListPage<T>>;

export function usePagedList<T extends { id: string }>(
  fetchPage: () => FetchPage<T> | null,
  options: { pageSize?: number } = {},
) {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const items = shallowRef<T[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Filter and sort, without `limit` and `offset`. */
  const params = shallowRef<ListPageParams>({});

  /*
   * Each reload takes a number. An answer to an older number is dropped, so a
   * slow answer to "pe" cannot replace the answer to "perth".
   */
  let generation = 0;

  async function reload(next: ListPageParams = params.value): Promise<void> {
    params.value = next;
    const fetch = fetchPage();
    const mine = ++generation;
    if (!fetch) {
      items.value = [];
      total.value = 0;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const page = await fetch({ ...next, limit: pageSize, offset: 0 });
      if (mine !== generation) return;
      items.value = page.items;
      total.value = page.total;
    } catch (err) {
      if (mine !== generation) return;
      error.value = err instanceof Error ? err.message : 'Failed to load the list';
      items.value = [];
      total.value = 0;
    } finally {
      if (mine === generation) loading.value = false;
    }
  }

  const hasMore = computed(() => items.value.length < total.value);

  /** The next page, after the rows already held. A row already held is not repeated. */
  async function loadMore(): Promise<void> {
    const fetch = fetchPage();
    if (!fetch || !hasMore.value || loading.value) return;
    const mine = generation;
    loading.value = true;
    try {
      const page = await fetch({ ...params.value, limit: pageSize, offset: items.value.length });
      if (mine !== generation) return;
      const seen = new Set(items.value.map((item) => item.id));
      items.value = [...items.value, ...page.items.filter((item) => !seen.has(item.id))];
      total.value = page.total;
    } catch (err) {
      if (mine === generation) error.value = err instanceof Error ? err.message : 'Failed to load the list';
    } finally {
      if (mine === generation) loading.value = false;
    }
  }

  function clear(): void {
    generation += 1;
    items.value = [];
    total.value = 0;
    loading.value = false;
  }

  return { items, total, loading, error, params, hasMore, reload, loadMore, clear };
}

/**
 * The rows with these ids. For the rows a list shows whatever page it is on:
 * pinned rows, recently opened rows, the open record. The ids go in the URL,
 * so they are sent 100 at a time to keep the URL short.
 */
export async function fetchByIds<T>(fetch: FetchPage<T>, ids: string[], params: ListPageParams = {}): Promise<T[]> {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let start = 0; start < unique.length; start += IDS_PER_REQUEST) {
    const chunk = unique.slice(start, start + IDS_PER_REQUEST);
    const page = await fetch({ ...params, ids: chunk, limit: chunk.length, offset: 0 });
    rows.push(...page.items);
  }
  return rows;
}
