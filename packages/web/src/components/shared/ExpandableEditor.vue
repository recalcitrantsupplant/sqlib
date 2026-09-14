<template>
  <!--
    A region that can pop out over the page — an editor, the strip below it,
    and whatever else belongs to the same act of writing.

    It expands where it stands. The region fixes itself over the viewport
    rather than teleporting its contents into an overlay somewhere else in the
    tree, so the CodeMirror instance inside is never re-parented: its
    selection, its scroll position and its undo history survive the trip in
    both directions, which is the whole reason to enlarge an editor rather than
    open a copy of one. Collapsed it is `display: contents` — no box, no
    layout, nothing for the page around it to notice.
  -->
  <div
    class="expand-region"
    :class="{ expanded }"
    :data-testid="testid"
    :role="expanded ? 'dialog' : undefined"
    :aria-modal="expanded ? 'true' : undefined"
    :aria-label="expanded ? title : undefined"
    @click.self="collapse"
  >
    <header v-if="expanded" class="expand-header">
      <SectionLabel as="h3" size="lg" class="expand-title">{{ title }}</SectionLabel>
      <span class="expand-spacer" />
      <slot name="header-end" />
      <button
        type="button"
        class="expand-close"
        :data-testid="testid ? `${testid}-close` : undefined"
        title="Back to the page (Esc)"
        @click="collapse"
      >
        <X :size="14" />Close
      </button>
    </header>

    <!--
      Where the run strip lands while this region is popped out. It is a
      sibling of the editor on the page and cannot come along by itself, and a
      pop-out you cannot run from is a reading view, not an editor.
    -->
    <div ref="runHostEl" class="expand-run"></div>

    <div class="expand-body">
      <slot :expanded="expanded" :toggle="toggle" :collapse="collapse" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import { nextEditorExpandId, useEditorExpand } from '@/composables/useEditorExpand';
import SectionLabel from './SectionLabel.vue';

const props = withDefaults(defineProps<{
  /** Names the pop-out in its header, and to a screen reader. */
  title: string;
  /** Distinguishes regions on one screen; generated when it does not matter. */
  id?: string;
  testid?: string;
}>(), {
  id: '',
  testid: '',
});

const emit = defineEmits<{ (e: 'update:expanded', value: boolean): void }>();

const expand = useEditorExpand();
const regionId = props.id || nextEditorExpandId('editor-expand');

const expanded = computed(() => expand.isExpanded(regionId));

const toggle = () => expand.toggle(regionId);
const collapse = () => expand.collapse();

const runHostEl = ref<HTMLElement | null>(null);
onMounted(() => expand.registerRunHost(regionId, runHostEl.value));
onBeforeUnmount(() => expand.releaseRegion(regionId));

watch(expanded, (value) => emit('update:expanded', value));

/*
 * Escape closes it. The listener is only bound while something is popped out,
 * so a screen with four expandable editors on it does not carry four idle key
 * handlers around.
 */
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.stopPropagation();
    collapse();
  }
};

watch(expanded, (value) => {
  if (typeof window === 'undefined') return;
  if (value) window.addEventListener('keydown', onKeydown);
  else window.removeEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown);
});

defineExpose({ expanded, toggle, collapse, regionId });
</script>

<style scoped>
/*
 * Collapsed, the three boxes this component draws generate no boxes at all:
 * the editor inside stays the same flex child of the same parent it was
 * before it was wrapped.
 */
.expand-region,
.expand-run,
.expand-body {
  display: contents;
}

.expand-region.expanded {
  display: flex;
  flex-direction: column;
  position: fixed;
  inset: 4vh 4vw;
  z-index: var(--z-dialog);
  background: var(--surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/*
 * The dim behind the pop-out, as a pseudo-element rather than a teleported
 * div: it paints in the region's own stacking context, so it covers the page
 * wherever in the tree the region happens to sit, and a click on it is
 * reported against the region itself — which is what `@click.self` catches.
 *
 * No backdrop-filter, deliberately: blurring the whole viewport re-blurs the
 * page every frame, which is what the query focus overlay measured and
 * rejected (tests/e2e/perf/ablation.spec.ts).
 */
.expand-region.expanded::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  background: rgba(0, 0, 0, 0.72);
}

.expand-region.expanded > .expand-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-shrink: 0;
  padding: var(--space-5) var(--space-6);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.expand-spacer {
  flex: 1;
}

.expand-close {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h);
  padding: 0 var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-size: var(--text-label);
  cursor: pointer;
}

.expand-close:hover {
  background: var(--surface-raised);
  color: var(--ink);
}

.expand-region.expanded > .expand-run {
  display: block;
  flex-shrink: 0;
}

.expand-region.expanded > .expand-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/*
 * Whatever was wrapped fills the pop-out. Boxes that cap their own height for
 * their place on the page — a 220px expectation field in a form — say so in an
 * inline style, which only `!important` can talk out of.
 */
.expand-region.expanded > .expand-body > :deep(*) {
  flex: 1 1 auto;
  min-height: 0 !important;
  max-height: none !important;
}
</style>
