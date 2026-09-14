import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { usePanelResize, PANEL_LAYOUT_STORAGE_KEY } from '@/composables/usePanelResize';

/**
 * The split arithmetic, exercised through a host component so the composable
 * gets the lifecycle hooks it registers.
 *
 * A drag is three events — mousedown on the handle, mousemove on the document,
 * mouseup — and the move is throttled through requestAnimationFrame, so every
 * test stubs rAF to run its callback immediately.
 */

const CONTAINER_WIDTH = 1200;

function mountPanel(deps: Record<string, unknown> = {}) {
  const api: Record<string, unknown> = {};
  const wrapper = mount(
    defineComponent({
      setup() {
        const containerRef = ref<HTMLElement | null>(null);
        Object.assign(api, usePanelResize({ containerRef, ...deps }));
        return () => h('div', { ref: containerRef });
      },
    }),
    { attachTo: document.body },
  );

  const container = wrapper.element as HTMLElement;
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: CONTAINER_WIDTH, height: 800, right: CONTAINER_WIDTH, bottom: 800 }) as DOMRect;

  return { wrapper, api: api as ReturnType<typeof usePanelResize> };
}

/** Drag the handle so the pointer lands `clientX` px from the container's left. */
function dragTo(api: ReturnType<typeof usePanelResize>, clientX: number) {
  api.startResize(new MouseEvent('mousedown'));
  document.dispatchEvent(new MouseEvent('mousemove', { clientX }));
}

/** The trailing panel's width in px, given what the composable settled on. */
function trailingPx(api: ReturnType<typeof usePanelResize>, handlePx = 8) {
  return CONTAINER_WIDTH - (api.panelWidthPercent.value / 100) * CONTAINER_WIDTH - handlePx;
}

describe('usePanelResize', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('stops the trailing panel at its 320px floor rather than letting it get thinner', () => {
    const { api } = mountPanel();

    dragTo(api, CONTAINER_WIDTH - 40);

    expect(Math.round(trailingPx(api))).toBe(320);
  });

  it('stops the trailing panel at half the pane rather than letting it eat the centre', () => {
    const { api } = mountPanel();

    dragTo(api, 100);

    expect(Math.round(trailingPx(api))).toBe(Math.round((CONTAINER_WIDTH - 8) * 0.5));
  });

  it('holds the centre column at its own floor on a pane too narrow for a half-and-half split', () => {
    // 900px wide: half of it is 446, which is under the 480px the editor needs.
    const { wrapper, api } = mountPanel({ minLeadingPx: 480 });
    (wrapper.element as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 900, height: 800, right: 900, bottom: 800 }) as DOMRect;

    dragTo(api, 100);

    expect(Math.round((api.panelWidthPercent.value / 100) * 900)).toBe(480);
  });

  it('snaps the panel shut when the drag overshoots the floor, on a screen that has a rail', () => {
    const { api } = mountPanel({ collapsible: true });

    // 100px of trailing panel is well under half its 320px floor.
    dragTo(api, CONTAINER_WIDTH - 100);

    expect(api.collapsed.value).toBe(true);
    expect(api.isResizing.value).toBe(false);
  });

  it('leaves a screen with no rail at the floor instead of snapping it shut', () => {
    const { api } = mountPanel();

    dragTo(api, CONTAINER_WIDTH - 100);

    expect(api.collapsed.value).toBe(false);
    expect(Math.round(trailingPx(api))).toBe(320);
  });

  it('returns the trailing panel to 420px on a reset, reopening it if it was shut', () => {
    const { api } = mountPanel({ collapsible: true });
    api.collapsed.value = true;

    api.resetWidth();

    expect(api.collapsed.value).toBe(false);
    expect(Math.round(trailingPx(api))).toBe(420);
  });

  it('remembers the settled width and the fold, per screen', async () => {
    const first = mountPanel({ storageKey: 'query', collapsible: true });
    dragTo(first.api, 700);
    document.dispatchEvent(new MouseEvent('mouseup'));
    const settled = first.api.panelWidthPercent.value;

    const stored = JSON.parse(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY) ?? '{}');
    expect(stored.query.widthPercent).toBeCloseTo(settled, 5);

    // A second screen's key is untouched by the first's drag.
    expect(stored.ruleSet).toBeUndefined();

    first.wrapper.unmount();
    const reopened = mountPanel({ storageKey: 'query', collapsible: true });
    await nextTick();
    expect(reopened.api.panelWidthPercent.value).toBeCloseTo(settled, 5);
  });

  it('re-clamps a remembered width that no longer fits the window', async () => {
    window.localStorage.setItem(
      PANEL_LAYOUT_STORAGE_KEY,
      // 95% leading leaves the trailing panel 52px — legal on no window at all.
      JSON.stringify({ query: { widthPercent: 95, collapsed: false } }),
    );

    const { api } = mountPanel({ storageKey: 'query' });
    // The mount-time clamp already ran; the stubbed container is only measurable
    // from here, so drive the resize path the narrowing window itself would.
    window.dispatchEvent(new Event('resize'));
    await nextTick();

    expect(Math.round(trailingPx(api))).toBe(320);
  });
});
