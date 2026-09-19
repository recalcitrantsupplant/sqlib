/**
 * The library switcher at the head of the nav rail — option 1a of the
 * "Library Switcher Options" mock.
 *
 * The rail is the app's only already-global surface, and a library reparents
 * every section on it at once, so the control sits above them all rather than
 * over one list where it reads as a filter on that list. What the mark shows is
 * the whole of the visible affordance: the current library's initial, and its
 * name on hover.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import LibrarySwitcher from '@/components/LibrarySwitcher.vue';

const setActiveLibrary = vi.fn();
const state = {
  libraries: ref<Array<{ id: string; name: string; description?: string | null }>>([]),
  activeLibraryId: ref<string | null>(null),
  activeLibraryName: ref('No library'),
};

vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({
    libraries: state.libraries,
    activeLibraryId: state.activeLibraryId,
    activeLibraryName: state.activeLibraryName,
    setActiveLibrary,
    ensureLoaded: vi.fn(),
  }),
}));

beforeEach(() => {
  setActiveLibrary.mockClear();
  state.libraries.value = [
    { id: 'lib:1', name: 'Main', description: '12 queries' },
    { id: 'lib:2', name: 'Ordnance Survey', description: null },
  ];
  state.activeLibraryId.value = 'lib:1';
  state.activeLibraryName.value = 'Main';
});

describe('LibrarySwitcher', () => {
  it('shows the active library as an initial, and names it in full on hover', () => {
    const wrapper = mount(LibrarySwitcher);
    const trigger = wrapper.get('[data-testid="library-switcher"]');

    expect(trigger.text()).toContain('M');
    expect(trigger.attributes('title')).toBe('Library — Main');
    wrapper.unmount();
  });

  it('falls back to the app mark when there is no library to name', () => {
    state.libraries.value = [];
    state.activeLibraryName.value = 'No library';
    const wrapper = mount(LibrarySwitcher);

    expect(wrapper.get('[data-testid="library-switcher"]').text()).toContain('S');
    wrapper.unmount();
  });

  it('switches the whole window to the library that is picked', async () => {
    const wrapper = mount(LibrarySwitcher, { attachTo: document.body });
    await wrapper.get('[data-testid="library-switcher"]').trigger('keydown', { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const option = document.querySelector<HTMLElement>('[data-testid="library-option-lib:2"]');
    expect(option).not.toBeNull();
    option!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    option!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setActiveLibrary).toHaveBeenCalledWith('lib:2');
    wrapper.unmount();
  });

  /**
   * The other route to a new library is the Libraries section of the navigation
   * sidebar, and several sections replace that sidebar with a flat list — so on
   * those sections there was no way to create one at all.
   */
  it('offers a new library from the menu that names them', async () => {
    const wrapper = mount(LibrarySwitcher, { attachTo: document.body });
    await wrapper.get('[data-testid="library-switcher"]').trigger('keydown', { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const create = document.querySelector<HTMLElement>('[data-testid="library-create"]');
    expect(create).not.toBeNull();
    create!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    create!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.emitted('create-library')).toHaveLength(1);
    wrapper.unmount();
  });

  it('keeps that route open when there is no library yet', async () => {
    state.libraries.value = [];
    const wrapper = mount(LibrarySwitcher, { attachTo: document.body });
    await wrapper.get('[data-testid="library-switcher"]').trigger('keydown', { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('[data-testid="library-create"]')).not.toBeNull();
    wrapper.unmount();
  });
});
