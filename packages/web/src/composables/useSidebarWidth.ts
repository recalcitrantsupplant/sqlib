import { computed, ref, unref, onBeforeUnmount, type Ref } from 'vue';

/**
 * The width of a section's list sidebar, when the user has dragged it.
 *
 * Saved names are user text and run long, so a fixed width truncates exactly
 * the thing you are scanning the list for. The sidebar's edge drags like the
 * right-hand panels' handles do (`usePanelResize`): drag to resize,
 * double-click to go back to the default.
 *
 * Unlike the trailing panels this is a px width, not a percentage: the list's
 * comfortable width is set by its names, not by the window. `null` means
 * "never dragged" — the sidebar keeps its CSS width, so the default layout is
 * untouched until someone actually moves the edge.
 *
 * Per work area, like the fold (`useSidebarCollapse`): a long query name says
 * nothing about how wide the Backends list should be.
 */

const STORAGE_KEY = 'sparql-query-lib-sidebar-width';

export const SIDEBAR_MIN_PX = 200;
export const SIDEBAR_MAX_PX = 640;

/**
 * The editor beside the sidebar has to stay usable: the sidebar never takes
 * more than this share of the window, whatever the px ceiling says.
 */
const MAX_WINDOW_SHARE = 0.5;

function read(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/* One shared map, for the same reason as the fold's: two readers cannot disagree. */
const widths = ref<Record<string, number>>(read());

function write(value: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A blocked localStorage costs a remembered width, not the screen.
  }
}

/** Test seam: the map is module state, so a spec has to be able to clear it. */
export function resetSidebarWidthForTest(): void {
  widths.value = {};
}

function clamp(px: number): number {
  const windowCap =
    typeof window !== 'undefined' && window.innerWidth > 0
      ? window.innerWidth * MAX_WINDOW_SHARE
      : SIDEBAR_MAX_PX;
  const max = Math.max(SIDEBAR_MIN_PX, Math.min(SIDEBAR_MAX_PX, windowCap));
  return Math.round(Math.min(Math.max(px, SIDEBAR_MIN_PX), max));
}

export interface UseSidebarWidthResult {
  /** The dragged width in px, or null for the sidebar's own default. */
  widthPx: Ref<number | null>;
  isResizing: Ref<boolean>;
  startResize: (event: MouseEvent) => void;
  resetWidth: () => void;
}

/**
 * @param key The work area the width belongs to, as for `useSidebarCollapse`.
 * @param sidebarRef The sidebar element: the drag starts from its live width.
 */
export function useSidebarWidth(
  key: Ref<string> | string,
  sidebarRef: Ref<HTMLElement | null>,
): UseSidebarWidthResult {
  const isResizing = ref(false);

  /*
   * While dragging, the width lives here and is written to the shared map only
   * on mouseup: a localStorage write per mousemove is a main-thread cost per
   * pixel, and the only width worth keeping is the one the drag settles on.
   */
  const dragWidth = ref<number | null>(null);

  const widthPx = computed<number | null>({
    get: () => {
      if (dragWidth.value !== null) return dragWidth.value;
      const stored = widths.value[unref(key)];
      return typeof stored === 'number' && Number.isFinite(stored) ? clamp(stored) : null;
    },
    set: (value) => {
      const next = { ...widths.value };
      if (value === null) delete next[unref(key)];
      else next[unref(key)] = clamp(value);
      widths.value = next;
      write(next);
    },
  });

  let startX = 0;
  let startWidth = 0;
  let rafId: number | null = null;
  let lastX: number | null = null;

  const update = () => {
    rafId = null;
    if (lastX === null) return;
    dragWidth.value = clamp(startWidth + (lastX - startX));
  };

  const onMove = (event: MouseEvent) => {
    lastX = event.clientX;
    if (rafId === null) rafId = requestAnimationFrame(update);
  };

  const stopResize = () => {
    if (!isResizing.value) return;
    isResizing.value = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', stopResize);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (lastX !== null) update();
    const settled = dragWidth.value;
    dragWidth.value = null;
    lastX = null;
    if (settled !== null) widthPx.value = settled;
  };

  const startResize = (event: MouseEvent) => {
    const el = sidebarRef.value;
    if (!el || typeof document === 'undefined') return;
    event.preventDefault();
    startX = event.clientX;
    startWidth = el.getBoundingClientRect().width;
    isResizing.value = true;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', stopResize);
  };

  /** Double-click the edge: back to the sidebar's own default width. */
  const resetWidth = () => {
    widthPx.value = null;
  };

  onBeforeUnmount(stopResize);

  return { widthPx, isResizing, startResize, resetWidth };
}

export const SIDEBAR_WIDTH_STORAGE_KEY = STORAGE_KEY;
