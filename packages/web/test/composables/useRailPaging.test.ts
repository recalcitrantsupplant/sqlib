/**
 * The rail's saved rows from server pages, with pinned and recently opened
 * rows loaded by id (#197).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';

const api = vi.hoisted(() => ({ pageEntities: vi.fn(), getTagCounts: vi.fn() }));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('../../src/composables/useApiClient', () => ({ useApiClient: () => api }));

const { HEADING_ROWS, useRailPaging } = await import('@/composables/useRailPaging');
const { useEntityPins, useEntityLastOpened } = await import('@/composables/useEntityPins');
const { useSettings } = await import('@/composables/useSettings');

const LIB = 'urn:sqlib:library:l1';
const row = (id: string, tags: string[] = []) => ({ id, name: id, tags });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  const { settings } = useSettings();
  settings.value.entityListGrouping = 'none';
  settings.value.entityListSort = {};
  settings.value.entityListTagFilter = {};
  api.getTagCounts.mockResolvedValue({ 'tag:geo': 7 });
  for (const id of [...useEntityPins().pins.value]) useEntityPins().setPinned(id, false);
  api.pageEntities.mockImplementation(async (_kind: string, params: { ids?: string[]; tag?: string[] }) => {
    if (params.ids) return { items: params.ids.map((id) => row(id)), total: params.ids.length };
    if (params.tag) return { items: [row('a', ['tag:geo'])], total: 7 };
    return { items: [row('a'), row('b')], total: 300 };
  });
});

function rail(kind: 'query' | 'argumentSet' = 'query') {
  return useRailPaging({
    section: ref('queries'),
    kind: ref(kind),
    library: ref(LIB),
    tags: ref([{ id: 'tag:geo' }]),
  });
}

describe('useRailPaging', () => {
  it('loads the first page of the kind in the library, sorted by the section setting', async () => {
    const r = rail();
    await r.ensureLoaded();
    expect(api.pageEntities).toHaveBeenCalledWith('query', { sort: 'name', order: 'asc', limit: 50, offset: 0, library: LIB });
    expect(r.rows.value.map((entity) => entity.id)).toEqual(['a', 'b']);
    expect(r.total.value).toBe(300);
  });

  it('loads pinned rows by id, whatever page they are on', async () => {
    useEntityPins().setPinned('z', true);
    const r = rail();
    await r.ensureLoaded();
    expect(api.pageEntities).toHaveBeenCalledWith('query', expect.objectContaining({ ids: ['z'], library: LIB }));
    expect(r.rows.value.map((entity) => entity.id)).toContain('z');
  });

  it('asks for name order under Last opened, and loads the opened rows by id', async () => {
    useSettings().setEntityListSort('queries', { key: 'opened', dir: 'desc' });
    useEntityLastOpened().markOpened('recent', 1000);
    const r = rail();
    await r.ensureLoaded();
    expect(api.pageEntities).toHaveBeenCalledWith('query', expect.objectContaining({ sort: 'name', order: 'asc', limit: 50 }));
    expect(api.pageEntities).toHaveBeenCalledWith('query', expect.objectContaining({ ids: ['recent'] }));
  });

  it('counts every tag in one request when grouping by tag', async () => {
    useSettings().settings.value.entityListGrouping = 'tag';
    const r = rail();
    await r.ensureLoaded();
    expect(api.getTagCounts).toHaveBeenCalledWith('Query', expect.objectContaining({ library: LIB }));
    expect(api.pageEntities).not.toHaveBeenCalledWith('query', expect.objectContaining({ limit: 1 }));
    expect(r.tagTotals.value).toEqual({ 'tag:geo': 7 });
    expect(r.tagCounts.value).toEqual({ 'tag:geo': 7 });
  });

  it('loads the first rows of each tag heading, the same number for every heading', async () => {
    useSettings().settings.value.entityListGrouping = 'tag';
    api.pageEntities.mockImplementation(async (_kind: string, params: { ids?: string[]; withTag?: string[] }) => {
      if (params.ids) return { items: [], total: 0 };
      if (params.withTag) return { items: [row('g1', ['tag:geo']), row('g2', ['tag:geo'])], total: 7 };
      return { items: [row('a'), row('g9', ['tag:geo'])], total: 300 };
    });
    const r = rail();
    await r.ensureLoaded();
    expect(api.pageEntities).toHaveBeenCalledWith('query', expect.objectContaining({ withTag: ['tag:geo'], limit: HEADING_ROWS, offset: 0 }));
    // g9 is on the main page, but past the heading's first rows.
    expect(r.tagRowIds.value).toEqual({ 'tag:geo': ['g1', 'g2'] });
    await r.loadMore('tag:geo');
    expect(api.pageEntities).toHaveBeenLastCalledWith('query', expect.objectContaining({ withTag: ['tag:geo'], limit: 50, offset: 2 }));
  });

  it('sends the tag filter, and loads a heading inside it', async () => {
    const { settings, setEntityListTagFilter } = useSettings();
    settings.value.entityListGrouping = 'tag';
    setEntityListTagFilter('queries', { tags: ['tag:geo'], match: 'any' });
    const r = rail();
    await r.ensureLoaded();
    expect(api.pageEntities).toHaveBeenCalledWith('query', expect.objectContaining({ tag: ['tag:geo'], tagMatch: 'any', limit: 50 }));
    expect(api.getTagCounts).toHaveBeenCalledWith('Query', expect.objectContaining({ tag: ['tag:geo'], tagMatch: 'any' }));
    // The count without the filter, for "N of M".
    expect(api.pageEntities).toHaveBeenCalledWith('query', expect.not.objectContaining({ tag: expect.anything() }));
    expect(r.unfilteredTotal.value).toBe(300);

    await r.loadMore('tag:geo');
    expect(api.pageEntities).toHaveBeenLastCalledWith('query', expect.objectContaining({ tag: ['tag:geo'], withTag: ['tag:geo'] }));
  });

  it('drops a filter tag the library no longer holds', async () => {
    useSettings().setEntityListTagFilter('queries', { tags: ['tag:gone'], match: 'all' });
    const r = rail();
    await r.ensureLoaded();
    expect(api.pageEntities).toHaveBeenCalledWith('query', expect.not.objectContaining({ tag: expect.anything() }));
    expect(r.unfilteredTotal.value).toBeNull();
  });

  it('searches on the server', async () => {
    const r = rail();
    await r.ensureLoaded();
    r.setSearch('perth');
    await nextTick();
    await r.ensureLoaded();
    expect(api.pageEntities).toHaveBeenLastCalledWith('query', expect.objectContaining({ q: 'perth', offset: 0 }));
  });

  it('loads once for the same section, sort and search', async () => {
    const r = rail();
    await Promise.all([r.ensureLoaded(), r.ensureLoaded()]);
    expect(api.pageEntities).toHaveBeenCalledTimes(1);
  });

  it('holds no rows of the section left while the next section loads', async () => {
    api.pageEntities.mockImplementation(async (kind: string) => ({ items: [row(`${kind}-1`)], total: 1 }));
    const kind = ref<'query' | 'dataGraph'>('dataGraph');
    const r = useRailPaging({ section: ref('dataGraphs'), kind, library: ref(LIB), tags: ref([]) });
    await r.ensureLoaded();
    expect(r.rows.value.map((entity) => entity.id)).toEqual(['dataGraph-1']);

    // The switch and the read in one tick, as a click on the rail does them.
    kind.value = 'query';
    expect(r.rows.value).toEqual([]);
    expect(r.lookup('dataGraph-1')).toBeUndefined();

    await r.ensureLoaded();
    expect(r.rows.value.map((entity) => entity.id)).toEqual(['query-1']);
  });

  it('holds no rows of the library left while the next library loads', async () => {
    api.pageEntities.mockImplementation(async (_kind: string, params: { library?: string }) =>
      ({ items: [row(`${params.library}-1`)], total: 1 }));
    const library = ref(LIB);
    const r = useRailPaging({ section: ref('queries'), kind: ref('query'), library, tags: ref([]) });
    await r.ensureLoaded();
    library.value = 'urn:sqlib:library:l2';
    expect(r.rows.value).toEqual([]);
    await r.ensureLoaded();
    expect(r.rows.value.map((entity) => entity.id)).toEqual(['urn:sqlib:library:l2-1']);
  });
});
