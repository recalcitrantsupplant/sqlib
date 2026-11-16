/**
 * Pinned rows sit in their own cluster above Saved, and the sort control
 * orders both clusters. Pins and the sort order live in this browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import EntityListSidebar from '@/components/EntityListSidebar.vue';
import { resetEntityPinsForTest, useEntityPins } from '@/composables/useEntityPins';
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

const SAVED = [
  { id: 'q:1', name: 'alpha', tags: [], currentVersionNumber: 1, dateModified: '2026-11-01T00:00:00Z' },
  { id: 'q:2', name: 'bravo', tags: [], currentVersionNumber: 3, dateModified: '2026-11-15T00:00:00Z' },
  { id: 'q:3', name: 'charlie', tags: [], currentVersionNumber: 2, dateModified: '2026-11-10T00:00:00Z' },
];

function mountSidebar() {
  return mount(EntityListSidebar, {
    props: {
      section: 'queries',
      saved: SAVED,
      scratch: [],
      selection: { kind: 'none', id: null },
      tags: [],
      savedKinds: [{ type: 'query', label: 'Queries' }],
      supportsSaved: true,
      supportsScratch: true,
    } as never,
    global: { stubs: { TagManagerDialog: true } },
  });
}

const rowIds = (wrapper: ReturnType<typeof mountSidebar>) =>
  wrapper.findAll('[data-testid="saved-row"]').map((row) => row.attributes('data-entity-id'));

beforeEach(() => {
  localStorage.clear();
  resetEntityPinsForTest();
  useSettings().settings.value.entityListSort = {};
});

describe('EntityListSidebar — pin and sort', () => {
  it('moves a pinned row into the Pinned cluster at the top', async () => {
    const wrapper = mountSidebar();
    expect(wrapper.find('[data-testid="pinned-cluster"]').exists()).toBe(false);

    const charlie = wrapper.findAll('[data-testid="saved-row"]')[2]!;
    await charlie.get('[data-testid="pin-button"]').trigger('click');

    expect(wrapper.find('[data-testid="pinned-cluster"]').exists()).toBe(true);
    expect(rowIds(wrapper)).toEqual(['q:3', 'q:1', 'q:2']);
    expect(wrapper.get('[data-entity-id="q:3"]').attributes('data-pinned')).toBe('true');
    expect(JSON.parse(localStorage.getItem('sparql-query-lib-pins')!)).toEqual(['q:3']);
    wrapper.unmount();
  });

  it('does not open the row when the pin button is pressed', async () => {
    const wrapper = mountSidebar();
    await wrapper.findAll('[data-testid="pin-button"]')[0]!.trigger('click');
    expect(wrapper.emitted('select-saved')).toBeUndefined();
    wrapper.unmount();
  });

  it('unpins from the Pinned cluster', async () => {
    useEntityPins().setPinned('q:2', true);
    const wrapper = mountSidebar();
    expect(rowIds(wrapper)[0]).toBe('q:2');

    await wrapper.get('[data-entity-id="q:2"] [data-testid="pin-button"]').trigger('click');
    expect(wrapper.find('[data-testid="pinned-cluster"]').exists()).toBe(false);
    expect(rowIds(wrapper)).toEqual(['q:1', 'q:2', 'q:3']);
    wrapper.unmount();
  });

  it('sorts by last modified and shows the age on each row', async () => {
    useSettings().setEntityListSort('queries', { key: 'modified', dir: 'desc' });
    const wrapper = mountSidebar();
    expect(rowIds(wrapper)).toEqual(['q:2', 'q:3', 'q:1']);
    expect(wrapper.findAll('[data-testid="sort-value"]')).toHaveLength(3);
    wrapper.unmount();
  });

  it('keeps the sort inside the Pinned cluster', async () => {
    useSettings().setEntityListSort('queries', { key: 'versions', dir: 'desc' });
    useEntityPins().setPinned('q:1', true);
    useEntityPins().setPinned('q:3', true);
    const wrapper = mountSidebar();
    expect(rowIds(wrapper)).toEqual(['q:3', 'q:1', 'q:2']);
    wrapper.unmount();
  });

  it('keeps a sort per section', () => {
    useSettings().setEntityListSort('groups', { key: 'created', dir: 'asc' });
    const wrapper = mountSidebar();
    expect(rowIds(wrapper)).toEqual(['q:1', 'q:2', 'q:3']);
    wrapper.unmount();
  });

  it('records the selected row as opened', async () => {
    const wrapper = mountSidebar();
    await wrapper.setProps({ selection: { kind: 'saved', id: 'q:2' } } as never);
    const opened = JSON.parse(localStorage.getItem('sparql-query-lib-last-opened')!);
    expect(Object.keys(opened)).toEqual(['q:2']);
    wrapper.unmount();
  });
});
