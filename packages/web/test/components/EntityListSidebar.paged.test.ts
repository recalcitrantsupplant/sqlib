/**
 * The rail when its saved rows come from the server a page at a time (#197).
 *
 * The parent holds the page and the count. The sidebar shows the count, asks
 * for the next page, and sends its filter to the parent to search on the
 * server.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import EntityListSidebar from '@/components/EntityListSidebar.vue';
import { useSettings } from '@/composables/useSettings';

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => ({ listTags: vi.fn().mockResolvedValue([]) }) }));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({
    libraries: { value: [{ id: 'lib:1', name: 'Main' }] },
    activeLibraryId: { value: 'lib:1' },
    activeLibrary: { value: { id: 'lib:1', name: 'Main' } },
    activeLibraryName: { value: 'Main' },
    setActiveLibrary: vi.fn(),
    ensureLoaded: vi.fn(),
  }),
}));

const TAGS = [{ id: 'tag:geo', name: 'Geo', color: '#15803d' }];
const PAGE = Array.from({ length: 50 }, (_, i) => ({ id: `q:${i}`, name: `Query ${String(i).padStart(2, '0')}`, tags: [] as string[] }));

function mountSidebar(props: Record<string, unknown> = {}) {
  return mount(EntityListSidebar, {
    props: {
      saved: PAGE,
      scratch: [],
      selection: { kind: 'none', id: null },
      tags: TAGS,
      savedKinds: [{ type: 'query', label: 'Queries' }],
      supportsSaved: true,
      supportsScratch: true,
      supportsTags: true,
      savedTotal: 4476,
      savedRemaining: 4426,
      tagTotals: { 'tag:geo': 12 },
      ...props,
    } as never,
    global: { stubs: { TagManagerDialog: true } },
  });
}

describe('EntityListSidebar — paged', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useSettings().settings.value.entityListGrouping = 'none';
  });

  it('counts every match and asks for the next page', async () => {
    const wrapper = mountSidebar();
    expect(wrapper.findAll('[data-testid="saved-row"]')).toHaveLength(50);
    expect(wrapper.text()).toContain('4476');
    const more = wrapper.get('[data-testid="show-more-saved"]');
    expect(more.text()).toBe('Show 4426 more');
    await more.trigger('click');
    expect(wrapper.emitted('load-more')).toEqual([[null]]);
  });

  it('sends the filter to the parent and keeps the rows it was given', async () => {
    vi.useFakeTimers();
    const wrapper = mountSidebar();
    await wrapper.get('input').setValue('zzz');
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper.emitted('search')).toEqual([['zzz']]);
    // The server filters; the rows stay until the parent sends the new page.
    expect(wrapper.findAll('[data-testid="saved-row"]')).toHaveLength(50);
    vi.useRealTimers();
  });

  it('shows a tag heading with its server count before any of its rows load', async () => {
    useSettings().settings.value.entityListGrouping = 'tag';
    const wrapper = mountSidebar();
    const heading = wrapper.get('[data-testid="tag-group-tag:geo"]');
    expect(heading.text()).toContain('12');
    await wrapper.get('[data-testid="show-more-tag:geo"]').trigger('click');
    expect(wrapper.emitted('load-more')).toEqual([['tag:geo']]);
  });

  it('shows only the rows a tag heading loaded, and counts the rest', () => {
    useSettings().settings.value.entityListGrouping = 'tag';
    const saved = PAGE.map((entity, i) => (i < 4 ? { ...entity, tags: ['tag:geo'] } : entity));
    const wrapper = mountSidebar({ saved, tagRowIds: { 'tag:geo': ['q:0', 'q:1'] } });
    const geoRows = wrapper.findAll('[data-testid="saved-row"]')
      .filter((rowEl) => ['q:0', 'q:1', 'q:2', 'q:3'].includes(rowEl.attributes('data-entity-id') ?? ''));
    expect(geoRows.map((rowEl) => rowEl.attributes('data-entity-id'))).toEqual(['q:0', 'q:1']);
    expect(wrapper.get('[data-testid="show-more-tag:geo"]').text()).toBe('Show 10 more');
  });

  it('draws no whole-list Show more under tag grouping when every row has a tag', () => {
    useSettings().settings.value.entityListGrouping = 'tag';
    const saved = PAGE.map((entity) => ({ ...entity, tags: ['tag:geo'] }));
    const wrapper = mountSidebar({ saved, tagRowIds: { 'tag:geo': ['q:0'] } });
    expect(wrapper.find('[data-testid="show-more-saved"]').exists()).toBe(false);
  });

  it('draws no Show more when every match is loaded', () => {
    const wrapper = mountSidebar({ savedTotal: 50, savedRemaining: 0 });
    expect(wrapper.find('[data-testid="show-more-saved"]').exists()).toBe(false);
  });
});
