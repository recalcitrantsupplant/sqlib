import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import EntityListSidebar from '@/components/EntityListSidebar.vue';
import { resetSidebarCollapseForTest } from '@/composables/useSidebarCollapse';
import {
  resetSidebarWidthForTest,
  SIDEBAR_MIN_PX,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from '@/composables/useSidebarWidth';

/**
 * The left sidebar's drag edge: drag to widen so long names read in full,
 * double-click to go back to the CSS default, remembered per section.
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
    attachTo: document.body,
  });
}

/** Drag the edge from a sidebar that measures `fromPx` wide by `dx`. */
async function drag(wrapper: ReturnType<typeof mountSidebar>, fromPx: number, dx: number) {
  const aside = wrapper.find('aside').element as HTMLElement;
  vi.spyOn(aside, 'getBoundingClientRect').mockReturnValue({ width: fromPx } as DOMRect);
  await wrapper
    .find('[data-testid="sidebar-resizer"]')
    .trigger('mousedown', { clientX: 300 });
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 + dx }));
  document.dispatchEvent(new MouseEvent('mouseup'));
  await wrapper.vm.$nextTick();
}

describe('EntityListSidebar width', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSidebarCollapseForTest();
    resetSidebarWidthForTest();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the CSS default width until the edge is dragged', () => {
    const wrapper = mountSidebar();
    expect((wrapper.find('aside').element as HTMLElement).style.width).toBe('');
    wrapper.unmount();
  });

  it('widens on drag and remembers the width per section', async () => {
    const wrapper = mountSidebar();
    await drag(wrapper, 288, 120);

    expect((wrapper.find('aside').element as HTMLElement).style.width).toBe('408px');
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? '{}')).toEqual({
      queries: 408,
    });
    wrapper.unmount();

    const tests = mountSidebar({ section: 'tests', sectionLabel: 'Tests' });
    expect((tests.find('aside').element as HTMLElement).style.width).toBe('');
    tests.unmount();
  });

  it('stops at the floor and at half the window', async () => {
    const wrapper = mountSidebar();
    await drag(wrapper, 288, -500);
    expect((wrapper.find('aside').element as HTMLElement).style.width).toBe(`${SIDEBAR_MIN_PX}px`);

    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    await drag(wrapper, 200, 900);
    expect((wrapper.find('aside').element as HTMLElement).style.width).toBe('500px');
    wrapper.unmount();
  });

  it('goes back to the default on double-click', async () => {
    const wrapper = mountSidebar();
    await drag(wrapper, 288, 100);
    await wrapper.find('[data-testid="sidebar-resizer"]').trigger('dblclick');

    expect((wrapper.find('aside').element as HTMLElement).style.width).toBe('');
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? '{}')).toEqual({});
    wrapper.unmount();
  });

  it('hides the edge on the rail, and unfolds to the dragged width', async () => {
    const wrapper = mountSidebar();
    await drag(wrapper, 288, 100);

    await wrapper.find('[data-testid="sidebar-hinge"]').trigger('click');
    expect(wrapper.find('[data-testid="sidebar-resizer"]').exists()).toBe(false);
    expect((wrapper.find('aside').element as HTMLElement).style.width).toBe('');

    await wrapper.find('[data-testid="sidebar-hinge"]').trigger('click');
    expect((wrapper.find('aside').element as HTMLElement).style.width).toBe('388px');
    wrapper.unmount();
  });
});
