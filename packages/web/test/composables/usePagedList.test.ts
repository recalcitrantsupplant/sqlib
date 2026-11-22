/**
 * A list loaded from the server a page at a time (#197).
 */
import { describe, it, expect, vi } from 'vitest';
import { fetchByIds, usePagedList, type FetchPage } from '@/composables/usePagedList';

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));

/** A server over `rows`: `q` keeps names that contain it, then limit and offset cut. */
function server() {
  const fn = vi.fn(async (params: { q?: string; ids?: string[]; limit?: number; offset?: number }) => {
    let matches = rows;
    if (params.q) matches = matches.filter((row) => row.name.includes(params.q!));
    if (params.ids) matches = matches.filter((row) => params.ids!.includes(row.id));
    const offset = params.offset ?? 0;
    return { items: matches.slice(offset, offset + (params.limit ?? matches.length)), total: matches.length };
  });
  return fn as unknown as FetchPage<Row> & typeof fn;
}

describe('usePagedList', () => {
  it('loads the first page, then the next, and stops at the total', async () => {
    const fetch = server();
    const list = usePagedList<Row>(() => fetch);
    await list.reload({ sort: 'name' });
    expect(list.items.value).toHaveLength(50);
    expect(list.total.value).toBe(120);
    expect(fetch).toHaveBeenLastCalledWith({ sort: 'name', limit: 50, offset: 0 });

    await list.loadMore();
    await list.loadMore();
    expect(list.items.value).toHaveLength(120);
    expect(fetch).toHaveBeenLastCalledWith({ sort: 'name', limit: 50, offset: 100 });
    expect(list.hasMore.value).toBe(false);

    await list.loadMore();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps the answer to the latest reload when an older one arrives last', async () => {
    let release: (() => void) | null = null;
    const fetch: FetchPage<Row> = async (params) => {
      if (params.q === 'slow') await new Promise<void>((resolve) => { release = resolve; });
      return { items: rows.filter((row) => row.name.includes(params.q ?? '')).slice(0, 1), total: 1 };
    };
    const list = usePagedList<Row>(() => fetch);
    const slow = list.reload({ q: 'slow' });
    await list.reload({ q: 'Row 7' });
    release!();
    await slow;
    expect(list.items.value.map((row) => row.name)).toEqual(['Row 7']);
  });

  it('lists nothing when there is nothing to fetch from', async () => {
    const list = usePagedList<Row>(() => null);
    await list.reload();
    expect(list.items.value).toEqual([]);
    expect(list.total.value).toBe(0);
  });
});

describe('fetchByIds', () => {
  it('asks 100 ids at a time', async () => {
    const fetch = server();
    const found = await fetchByIds(fetch, rows.slice(0, 120).map((row) => row.id));
    expect(found).toHaveLength(120);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
