/**
 * A section handing the sidebar a different body.
 *
 * Tests does this for its Runs tab, and the point of the slot is what it does
 * *not* replace: the hinge, the width and the collapse
 * behaviour stay the sidebar's, so the two tabs are one sidebar at two scopes
 * rather than two asides that have to be kept looking alike.
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

function mountSidebar(slots: Record<string, string> = {}) {
  return mount(EntityListSidebar, {
    slots,
    props: {
      section: 'tests',
      saved: [{ id: 't:1', name: 'a saved test', tags: [] }],
      scratch: [],
      selection: { kind: 'none', id: null },
      tags: [],
      savedKinds: [{ type: 'test', label: 'Tests' }],
      supportsSaved: true,
      supportsScratch: true,
    } as never,
    global: { stubs: { TagManagerDialog: true } },
  });
}

describe('EntityListSidebar — a replaced body', () => {
  it('keeps the list, the filter and New when no body is given', () => {
    const wrapper = mountSidebar();

    expect(wrapper.find('[data-testid="entity-filter"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="saved-row"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="new-scratch"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('replaces the rows and stands down the authoring affordances', () => {
    const wrapper = mountSidebar({ 'list-body': '<p data-testid="run-body">the run</p>' });

    expect(wrapper.find('[data-testid="run-body"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="entity-filter"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="saved-row"]').exists()).toBe(false);
    // Authoring belongs to the list you author against, not to a view of a run.
    expect(wrapper.find('[data-testid="new-scratch"]').exists()).toBe(false);
    // And the section's own count would contradict the tabs above it.
    expect(wrapper.find('[data-testid="section-count"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps the hinge, whatever the body is', () => {
    const wrapper = mountSidebar({ 'list-body': '<p data-testid="run-body">the run</p>' });

    expect(wrapper.find('[data-testid="sidebar-hinge"]').exists()).toBe(true);
    wrapper.unmount();
  });

  // The switcher moved to the nav rail: one control for the whole window,
  // rather than one that reads as a filter on whichever list is beside it.
  it('no longer draws a library switcher of its own', () => {
    const wrapper = mountSidebar({ 'list-body': '<p data-testid="run-body">the run</p>' });

    expect(wrapper.find('[data-testid="library-switcher"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
