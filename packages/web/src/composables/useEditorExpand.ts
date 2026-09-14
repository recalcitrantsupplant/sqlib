import { computed, reactive, ref } from 'vue';

/**
 * Which editor on the page is popped out, and where its run strip goes while
 * it is.
 *
 * One editor at a time, page-wide: the popped-out editor covers the screen, so
 * a second one could only ever hide the first. That makes the active editor a
 * single value rather than a flag per editor, and a module singleton rather
 * than a provide — the run strip that has to move is a *sibling* of the editor
 * that moved, not a descendant of it, so there is no common ancestor to hang
 * an injection off without wrapping every work area in one.
 *
 * Expanding is CSS, not a teleport: the region fixes itself over the viewport
 * where it already stands. A CodeMirror instance that is moved in the DOM is
 * re-measured and can lose its selection, and the editor is the one thing on
 * this screen that must not blink when you enlarge it. The run strip *is*
 * teleported, because it is outside the region by construction and holds no
 * state of its own — every choice on it lives in the work area above.
 */

const activeId = ref<string | null>(null);

/** Each region's run-strip mount point, so the strip can find the live one. */
const runHosts = reactive(new Map<string, HTMLElement>());

let counter = 0;

/** A stable id per region instance; regions are never addressed from outside. */
export function nextEditorExpandId(prefix = 'editor'): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function useEditorExpand() {
  return {
    activeId: computed(() => activeId.value),

    /** True while any editor is popped out — the run strip asks this. */
    anyExpanded: computed(() => activeId.value !== null),

    /** Where the run strip should render right now, or null to stay in place. */
    runHost: computed(() => (activeId.value ? runHosts.get(activeId.value) ?? null : null)),

    isExpanded: (id: string) => activeId.value === id,

    expand(id: string) {
      activeId.value = id;
    },

    collapse() {
      activeId.value = null;
    },

    toggle(id: string) {
      activeId.value = activeId.value === id ? null : id;
    },

    registerRunHost(id: string, el: HTMLElement | null) {
      if (el) runHosts.set(id, el);
      else runHosts.delete(id);
    },

    /** A region that goes away while popped out takes the pop-out with it. */
    releaseRegion(id: string) {
      runHosts.delete(id);
      if (activeId.value === id) activeId.value = null;
    },
  };
}
