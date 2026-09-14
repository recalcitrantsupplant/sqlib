import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import EntityListSidebar from '@/components/EntityListSidebar.vue';
import {
  resetSidebarCollapseForTest,
  SIDEBAR_COLLAPSE_STORAGE_KEY,
} from '@/composables/useSidebarCollapse';

/**
 * The left sidebar's hinge: collapse-only, remembered per section.
 *
 * It is deliberately not drag-resizable — the list has a fixed vocabulary, so
 * the only width question worth asking is "list or rail?".
 */

function mountSidebar(props: Record<string, unknown> = {}) {
  return mount(EntityListSidebar, {
    props: {
      section: 'queries',
      sectionLabel: 'Queries',
      saved: [{ id: 'q1', name: 'One' }],
      scratch: [],
      selection: { kind: 'none', id: null },
      ...props,
    } as never,
    global: { stubs: { TagManagerDialog: true } },
  });
}

describe('EntityListSidebar collapse', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSidebarCollapseForTest();
  });

  it('folds to a rail and back on the hinge', async () => {
    const wrapper = mountSidebar();
    expect(wrapper.find('.entity-list').exists()).toBe(true);

    await wrapper.find('[data-testid="sidebar-hinge"]').trigger('click');

    expect(wrapper.find('aside').classes()).toContain('collapsed');
    // Rail: no list, no filter — the hinge back out, + New, and the section name.
    expect(wrapper.find('.entity-list').exists()).toBe(false);
    expect(wrapper.find('[data-testid="entity-filter"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="rail-new-scratch"]').exists()).toBe(true);
    expect(wrapper.find('.rail-label').text()).toBe('Queries');

    await wrapper.find('[data-testid="sidebar-hinge"]').trigger('click');
    expect(wrapper.find('aside').classes()).not.toContain('collapsed');
  });

  it('remembers the fold per section, so folding Queries leaves Tests alone', async () => {
    const queries = mountSidebar();
    await queries.find('[data-testid="sidebar-hinge"]').trigger('click');

    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) ?? '{}')).toEqual({
      queries: true,
    });

    const tests = mountSidebar({ section: 'tests', sectionLabel: 'Tests' });
    expect(tests.find('aside').classes()).not.toContain('collapsed');

    queries.unmount();
    const reopened = mountSidebar();
    expect(reopened.find('aside').classes()).toContain('collapsed');
  });

  it('still creates from the rail — the one action that survives the fold', async () => {
    const wrapper = mountSidebar();
    await wrapper.find('[data-testid="sidebar-hinge"]').trigger('click');

    await wrapper.find('[data-testid="rail-new-scratch"]').trigger('click');

    expect(wrapper.emitted('create-scratch')).toHaveLength(1);
  });
});
