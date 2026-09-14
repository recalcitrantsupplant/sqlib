import { computed, ref, unref, type Ref } from 'vue';

/**
 * Whether a section's list sidebar is folded to its icon rail.
 *
 * The left sidebar collapses; it does not drag. It lists a fixed vocabulary —
 * a section's saved and scratch items, at one of two row densities — so its
 * comfortable width is a design decision rather than a per-user one, and a
 * hinge that snaps between the full list and a narrow rail gives the whole
 * benefit (the screen back, when you are heads-down in the editor) without a
 * second dimension of state to remember. The right-hand panels, where content
 * length genuinely varies, are the ones that drag — see `usePanelResize`.
 *
 * The flag is per work area, not global: Queries and Backends are different
 * jobs, and folding the list away in one says nothing about the other.
 */

const STORAGE_KEY = 'sparql-query-lib-sidebar-collapsed';

function read(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/*
 * One shared map rather than a ref per caller, so that two components reading
 * the same section — the sidebar and anything that has to lay out around it —
 * cannot disagree about whether it is folded.
 */
const flags = ref<Record<string, boolean>>(read());

function write(value: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A blocked localStorage costs a remembered fold, not the screen.
  }
}

/** Test seam: the map is module state, so a spec has to be able to clear it. */
export function resetSidebarCollapseForTest(): void {
  flags.value = {};
}

export interface UseSidebarCollapseResult {
  collapsed: Ref<boolean>;
  toggle: () => void;
}

/**
 * @param key The work area the flag belongs to — a rail section id, or
 *   `backends`. A ref, because the sidebar is reused across sections and the
 *   fold has to follow the section rather than the component instance.
 */
export function useSidebarCollapse(key: Ref<string> | string): UseSidebarCollapseResult {
  /*
   * Written on set rather than from a watcher: a watcher created inside a
   * component's setup is owned by that component's scope and dies with it,
   * which would quietly stop persisting the moment the first sidebar unmounted.
   */
  const collapsed = computed<boolean>({
    get: () => flags.value[unref(key)] === true,
    set: (value) => {
      flags.value = { ...flags.value, [unref(key)]: value };
      write(flags.value);
    },
  });

  return {
    collapsed,
    toggle: () => {
      collapsed.value = !collapsed.value;
    },
  };
}

export const SIDEBAR_COLLAPSE_STORAGE_KEY = STORAGE_KEY;
