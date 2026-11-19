/**
 * The tag filter in the rail: chips under the filter bar, the rows it keeps,
 * the "N of M" count, and the empty state.
 *
 * Tests holds its whole list, so the sidebar filters the rows itself. A paged
 * section gets the rows filtered by the server (see useRailPaging.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
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

const TAGS = [
  { id: 'tag:neg', name: 'negation', color: '#2f6feb' },
  { id: 'tag:rej', name: 'must reject', color: '#6b3a7a' },
];
const SAVED = [
  { id: 't:1', name: 'neg-exists', tags: ['tag:neg', 'tag:rej'] },
  { id: 't:2', name: 'neg-nested', tags: ['tag:neg'] },
  { id: 't:3', name: 'agg-sum', tags: [] as string[] },
];

function mountSidebar(slots: Record<string, string> = {}) {
  return mount(EntityListSidebar, {
    props: {
      section: 'tests',
      saved: SAVED,
      scratch: [],
      selection: { kind: 'none', id: null },
      tags: TAGS,
      savedKinds: [{ type: 'test', label: 'Tests' }],
      supportsSaved: true,
      supportsScratch: false,
      supportsTags: true,
      itemNoun: 'test',
    } as never,
    slots,
    global: { stubs: { TagManagerDialog: true } },
  });
}

const rows = (wrapper: ReturnType<typeof mountSidebar>) =>
  wrapper.findAll('[data-testid="saved-row"]').map((row) => row.text());

describe('EntityListSidebar — tag filter', () => {
  beforeEach(() => {
    const { settings } = useSettings();
    settings.value.entityListGrouping = 'none';
    settings.value.entityListTagFilter = {};
  });

  it('shows no chips and every row without a filter', () => {
    const wrapper = mountSidebar();
    expect(wrapper.find('[data-testid="tag-filter-chips"]').exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(3);
    expect(wrapper.find('[data-testid="section-count-of"]').exists()).toBe(false);
  });

  it('keeps the rows with every chosen tag, and counts N of M', async () => {
    useSettings().setEntityListTagFilter('tests', { tags: ['tag:neg', 'tag:rej'], match: 'all' });
    const wrapper = mountSidebar();
    await nextTick();
    expect(rows(wrapper).join(' ')).toContain('neg-exists');
    expect(rows(wrapper)).toHaveLength(1);
    expect(wrapper.get('[data-testid="section-count"]').text()).toBe('1');
    expect(wrapper.get('[data-testid="section-count-of"]').text()).toBe('of 3');

    await wrapper.get('[data-testid="tag-filter-match-any"]').trigger('click');
    expect(rows(wrapper)).toHaveLength(2);
  });

  it('removes a tag from its chip, and keeps the filter per section', async () => {
    useSettings().setEntityListTagFilter('tests', { tags: ['tag:rej'], match: 'all' });
    const wrapper = mountSidebar();
    await wrapper.get('[data-testid="tag-filter-chip-tag:rej"] button').trigger('click');
    expect(useSettings().entityListTagFilterFor('tests').tags).toEqual([]);
    expect(rows(wrapper)).toHaveLength(3);
  });

  it('offers Match any tag when no row carries every tag', async () => {
    const saved = [{ id: 't:9', name: 'only-rej', tags: ['tag:rej'] }, { id: 't:8', name: 'only-neg', tags: ['tag:neg'] }];
    useSettings().setEntityListTagFilter('tests', { tags: ['tag:neg', 'tag:rej'], match: 'all' });
    const wrapper = mountSidebar();
    await wrapper.setProps({ saved } as never);
    expect(wrapper.get('[data-testid="tag-filter-empty"]').text()).toBe('No tests carry all 2 tags.');
    await wrapper.get('[data-testid="tag-filter-match-any-empty"]').trigger('click');
    expect(rows(wrapper)).toHaveLength(2);
  });

  it('hands the filter to the section actions', () => {
    useSettings().setEntityListTagFilter('tests', { tags: ['tag:neg'], match: 'all' });
    const wrapper = mountSidebar({
      'section-actions': `<template #section-actions="{ items, tagFilter, filterText }">
        <span data-testid="actions">{{ items.length }}|{{ tagFilter.tags.join(',') }}|{{ filterText }}</span>
      </template>`,
    });
    expect(wrapper.get('[data-testid="actions"]').text()).toBe('2|tag:neg|');
  });
});
