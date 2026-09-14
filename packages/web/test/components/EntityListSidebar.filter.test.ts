/**
 * The section filter matches the way the choosers do.
 *
 * A pane that filters exactly while the dropdown beside it filters fuzzily is
 * the surprising thing — one rule for "find the thing I can half-spell".
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import EntityListSidebar from '@/components/EntityListSidebar.vue';

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
  { id: 'q:1', name: 'query-group smoke', tags: [] },
  { id: 'q:2', name: 'Reaches', tags: [], description: 'counts every reachable node' },
  { id: 'q:3', name: 'settings audit', tags: [] },
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

const rowNames = (wrapper: ReturnType<typeof mountSidebar>) =>
  wrapper.findAll('[data-testid="saved-row"]').map((row) => row.text());

async function filterBy(wrapper: ReturnType<typeof mountSidebar>, term: string) {
  await wrapper.get('[data-testid="entity-filter"]').setValue(term);
}

describe('EntityListSidebar — filtering', () => {
  it('lists everything with the box empty', () => {
    const wrapper = mountSidebar();
    expect(rowNames(wrapper)).toHaveLength(3);
    wrapper.unmount();
  });

  it('matches a subsequence of the name, not only a substring', async () => {
    const wrapper = mountSidebar();
    await filterBy(wrapper, 'qgrp');

    expect(rowNames(wrapper).join(' ')).toContain('query-group smoke');
    expect(rowNames(wrapper)).toHaveLength(1);
    wrapper.unmount();
  });

  it('keeps the section’s own order rather than re-ranking it', async () => {
    const wrapper = mountSidebar();
    // "se" hits all three; the rows must stay in the order the section gave.
    await filterBy(wrapper, 'se');

    const names = rowNames(wrapper);
    expect(names[0]).toContain('query-group smoke');
    expect(names[names.length - 1]).toContain('settings audit');
    wrapper.unmount();
  });

  it('still finds a row by a literal fragment of its description', async () => {
    const wrapper = mountSidebar();
    await filterBy(wrapper, 'reachable node');

    expect(rowNames(wrapper)).toHaveLength(1);
    expect(rowNames(wrapper)[0]).toContain('Reaches');
    wrapper.unmount();
  });

  it('empties the list when nothing matches', async () => {
    const wrapper = mountSidebar();
    await filterBy(wrapper, 'zzzz');

    expect(rowNames(wrapper)).toHaveLength(0);
    wrapper.unmount();
  });
});
