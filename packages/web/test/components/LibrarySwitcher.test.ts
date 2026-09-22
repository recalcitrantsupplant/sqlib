/**
 * The library switcher at the head of the nav rail — option 1a of the
 * "Library Switcher Options" mock.
 *
 * The rail is the app's only already-global surface, and a library reparents
 * every section on it at once, so the control sits above them all rather than
 * over one list where it reads as a filter on that list.
 *
 * The head is two controls, not one: the mark carries the current library's
 * initial and goes to the splash, and the "Library" row under it opens the
 * switcher and names the library on hover.
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

    expect(wrapper.get('[data-testid="library-home"]').text()).toContain('M');
    expect(wrapper.get('[data-testid="library-switcher"]').attributes('title')).toBe('Library — Main');
    wrapper.unmount();
  });

  it('falls back to the app mark when there is no library to name', () => {
    state.libraries.value = [];
    state.activeLibraryName.value = 'No library';
    const wrapper = mount(LibrarySwitcher);

    expect(wrapper.get('[data-testid="library-home"]').text()).toContain('S');
    wrapper.unmount();
  });

  /*
   * The mark asks its host to go home rather than routing itself: the rail is
   * on three pages, and on `/` the splash is a state the page already holds
   * rather than somewhere to navigate to.
   */
  it('asks to go home when the mark is clicked, and opens no menu', async () => {
    const wrapper = mount(LibrarySwitcher, { attachTo: document.body });

    await wrapper.get('[data-testid="library-home"]').trigger('click');

    expect(wrapper.emitted('home')).toHaveLength(1);
    expect(document.querySelector('[data-testid="library-create"]')).toBeNull();
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
   * The only route to a new library since the artifact tree went: the menu
   * that names them is where the next one is made.
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
