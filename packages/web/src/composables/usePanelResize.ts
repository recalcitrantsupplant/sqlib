import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import type { UsePanelResizeDeps, UsePanelResizeResult } from './queryGroupTypes';

/**
 * The split between a work area's centre column and its trailing panel.
 *
 * Every screen that has a trailing panel — Query's results, Rules' Inputs,
 * Groups' details, ETL's output — drags on the same handle with the same
 * arithmetic and the same persistence, because divergence between two screens
 * that look identical is the thing users notice first.
 *
 * Three rules the drag enforces, all in px rather than percent, because a
 * percentage that reads well at 1920 is unusable at 1280:
 *
 * - The trailing panel never goes below `minTrailingPx`, and dragging well past
 *   that floor snaps it shut instead — so the handle doubles as the collapse
 *   control without growing a second affordance.
 * - The trailing panel never takes more than `maxTrailingRatio` of the pane.
 * - The centre column never goes below `minLeadingPx`. The SRL editor has a
 *   comfortable measure and the panel is what stops, not the editor.
 *
 * The public unit stays a percentage of the container: that is what the
 * templates bind to, and it keeps the split proportional when the window
 * changes size. The px floors are re-applied on window resize so a pane that
 * narrows squeezes the panel rather than the editor.
 */

const DEFAULT_INITIAL_WIDTH = 60;

/** Floors and ceilings for the trailing panel, and the centre column's own. */
const DEFAULT_MIN_TRAILING_PX = 320;
const DEFAULT_MAX_TRAILING_RATIO = 0.5;
const DEFAULT_RESET_TRAILING_PX = 420;
const DEFAULT_MIN_LEADING_PX = 480;

/** The resizer's own width, which is neither panel's. */
const DEFAULT_HANDLE_PX = 8;

/**
 * Drag the trailing panel below half its floor and it snaps shut. Half rather
 * than the floor itself so that resting *at* the minimum stays reachable —
 * collapsing has to be a deliberate overshoot, not the edge of the range.
 */
const COLLAPSE_SNAP_RATIO = 0.5;

/**
 * The centre column's floor is honoured before the panel's, but never so far
 * that the panel disappears on a narrow window: past this share of the pane
 * the two floors are simply not both satisfiable and the split holds here.
 */
const MAX_LEADING_SHARE = 0.75;

const STORAGE_KEY = 'sparql-query-lib-panel-layout';

interface StoredLayout {
  widthPercent?: number;
  collapsed?: boolean;
}

function readStore(): Record<string, StoredLayout> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredLayout>) : {};
  } catch {
    return {};
  }
}

function writeStore(key: string, layout: StoredLayout): void {
  if (typeof window === 'undefined') return;
  try {
    const all = readStore();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...all, [key]: layout }));
  } catch {
    // A full or blocked localStorage costs the user a remembered width, which
    // is not worth breaking the screen over.
  }
}

export function usePanelResize(deps: UsePanelResizeDeps = {}): UsePanelResizeResult {
  const {
    initialWidthPercent = DEFAULT_INITIAL_WIDTH,
    document: providedDocument,
    containerRef,
    storageKey,
    collapsible = false,
    minLeadingPx = DEFAULT_MIN_LEADING_PX,
    minTrailingPx = DEFAULT_MIN_TRAILING_PX,
    maxTrailingRatio = DEFAULT_MAX_TRAILING_RATIO,
    resetTrailingPx = DEFAULT_RESET_TRAILING_PX,
    handlePx = DEFAULT_HANDLE_PX,
  } = deps;

  const stored = storageKey ? readStore()[storageKey] : undefined;

  const panelWidthPercent = ref(
    typeof stored?.widthPercent === 'number' && Number.isFinite(stored.widthPercent)
      ? stored.widthPercent
      : initialWidthPercent,
  );
  const isResizing = ref(false);
  const collapsed = ref(collapsible ? stored?.collapsed === true : false);

  const getDocument = () => {
    if (providedDocument) {
      return providedDocument;
    }
    if (typeof window !== 'undefined') {
      return window.document;
    }
    return undefined;
  };

  const doc = getDocument();

  /**
   * The leading column's px range for a container of this width. Expressed as
   * a pair rather than four separate guards so that the resolution when the
   * floors collide — the centre wins, up to `MAX_LEADING_SHARE` — is one
   * readable line instead of a branch.
   */
  const boundsFor = (containerWidth: number) => {
    const usable = Math.max(containerWidth - handlePx, 0);
    const min = Math.min(
      Math.max(minLeadingPx, usable * (1 - maxTrailingRatio)),
      usable * MAX_LEADING_SHARE,
    );
    const max = Math.max(usable - minTrailingPx, min);
    return { usable, min, max };
  };

  const containerWidth = () => {
    const container = containerRef?.value ?? null;
    if (!container) return 0;
    return container.getBoundingClientRect().width;
  };

  const setLeadingPx = (leadingPx: number, width: number) => {
    if (width <= 0) return;
    const { min, max } = boundsFor(width);
    panelWidthPercent.value = (Math.min(Math.max(leadingPx, min), max) / width) * 100;
  };

  // Cache container bounds to avoid getBoundingClientRect on every mousemove
  let containerRect: DOMRect | null = null;
  let rafId: number | null = null;
  let lastMouseX: number | null = null;

  const updatePanelWidth = () => {
    if (lastMouseX === null || !containerRect) {
      rafId = null;
      return;
    }

    const leadingPx = lastMouseX - containerRect.left;
    const { usable } = boundsFor(containerRect.width);

    // Past half the trailing floor the drag stops being a resize and becomes a
    // collapse — the handle is the only affordance either way.
    if (collapsible && usable - leadingPx < minTrailingPx * COLLAPSE_SNAP_RATIO) {
      collapsed.value = true;
      rafId = null;
      stopResize();
      return;
    }

    setLeadingPx(leadingPx, containerRect.width);
    rafId = null;
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isResizing.value || !containerRect) {
      return;
    }

    lastMouseX = event.clientX;

    // Throttle updates using requestAnimationFrame
    if (rafId === null) {
      rafId = requestAnimationFrame(updatePanelWidth);
    }
  };

  const persist = () => {
    if (!storageKey) return;
    writeStore(storageKey, { widthPercent: panelWidthPercent.value, collapsed: collapsed.value });
  };

  const stopResize = () => {
    if (!isResizing.value) {
      return;
    }
    isResizing.value = false;
    persist();
    containerRect = null;
    lastMouseX = null;

    // Cancel any pending animation frame
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const startResize = (event: MouseEvent) => {
    if (!doc) {
      return;
    }

    const container = containerRef?.value ?? null;
    if (!container) {
      return;
    }

    // Cache the container bounds at the start of resize
    containerRect = container.getBoundingClientRect();
    if (containerRect.width === 0) {
      return;
    }

    isResizing.value = true;
    event.preventDefault();
  };

  /**
   * Double-click the handle: back to the panel's default width, and open if it
   * was snapped shut. The one gesture that undoes any drag, including the one
   * that closed the panel.
   */
  const resetWidth = () => {
    collapsed.value = false;
    const width = containerWidth();
    if (width <= 0) {
      panelWidthPercent.value = initialWidthPercent;
    } else {
      const { usable } = boundsFor(width);
      setLeadingPx(usable - resetTrailingPx, width);
    }
    persist();
  };

  const toggleCollapsed = () => {
    collapsed.value = !collapsed.value;
  };

  /**
   * A narrowing window is the other way the centre column gets squeezed, and
   * the drag clamps cannot see it — a stored percentage that was legal at 1920
   * is not at 1280. Re-clamp against the live container instead.
   */
  const reclamp = () => {
    const width = containerWidth();
    if (width <= 0) return;
    setLeadingPx((panelWidthPercent.value / 100) * width, width);
  };

  const addListeners = () => {
    if (!doc) {
      return;
    }
    doc.addEventListener('mousemove', handleMouseMove);
    doc.addEventListener('mouseup', stopResize);
    doc.defaultView?.addEventListener('resize', reclamp);
    reclamp();
  };

  const removeListeners = () => {
    if (!doc) {
      return;
    }
    doc.removeEventListener('mousemove', handleMouseMove);
    doc.removeEventListener('mouseup', stopResize);
    doc.defaultView?.removeEventListener('resize', reclamp);
  };

  onMounted(addListeners);
  onBeforeUnmount(removeListeners);

  /*
   * At the end of a drag rather than on every frame: a rAF-rate write to
   * localStorage is a synchronous main-thread cost per pixel moved, and the
   * only width worth remembering is the one the drag settled on.
   */
  if (storageKey) {
    watch(collapsed, () => persist());
  }

  return {
    panelWidthPercent,
    startResize,
    stopResize,
    isResizing,
    collapsed,
    toggleCollapsed,
    resetWidth,
  };
}

export const PANEL_LAYOUT_STORAGE_KEY = STORAGE_KEY;
