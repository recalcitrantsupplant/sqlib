<template>
  <div
    ref="surfaceEl"
    class="canvas-surface"
    :class="[`canvas-surface--${tone}`, { 'canvas-surface--dense': dense }]"
  >
    <!--
      Behind the flow. Chrome that says what you are looking at — the
      stratification bands are the case that asked for it — rather than
      anything the graph itself hit-tests.
    -->
    <div v-if="$slots.underlay" class="canvas-surface__underlay" aria-hidden="true">
      <slot name="underlay" />
    </div>

    <slot />

    <!--
      Above it. The floating palettes and context menus a canvas carries, which
      are positioned against this box and nothing else — which is why the box,
      not the consumer, is what owns `position: relative`.
    -->
    <div v-if="$slots.overlay" class="canvas-surface__overlay">
      <slot name="overlay" />
    </div>

    <div v-if="empty" class="canvas-surface__empty">
      <slot name="empty">
        <EmptyState v-if="emptyTitle" boxed size="sm" :title="emptyTitle" :description="emptyDescription" />
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import EmptyState from './EmptyState.vue';

/**
 * The graph surface of the canvas archetype: a positioned box that hosts a
 * `<VueFlow>` and the chrome that floats over it.
 *
 * The archetype is the third layout in `docs/reference/ui-design-tokens.md`
 * §6 and the one that did not exist, which is why `QueryGroupWorkArea` grew its
 * own copy of all of this. `InspectorRail` was the rail half; this is the
 * surface half, and `CanvasShell` composes the two with a toolbar.
 *
 * It owns three things no consumer should own again:
 *
 * - **The Vue Flow stylesheets.** `@import` inside a scoped block is not scoped
 *   — the bundler hoists it — so the two canvases were each shipping a request
 *   for the same global CSS. It is stated once, here.
 * - **`position: relative`.** Every floating affordance a canvas has is
 *   positioned against the surface, so a consumer that draws one has to know
 *   the box is positioned. That is the surface's business, not theirs.
 * - **The controls chrome.** `.vue-flow__controls` is Vue Flow's own markup, so
 *   theming it is a `:deep()` reach in whichever component happens to render
 *   the flow — which is how two files came to theme it differently.
 */
withDefaults(
  defineProps<{
    /**
     * `default` for a canvas that is the screen (query groups); `subtle` for one
     * embedded in a panel, where the recessed fill is what separates the graph
     * from the pane around it.
     */
    tone?: 'default' | 'subtle';
    /**
     * Vue Flow sizes its controls for a full-screen canvas. A graph a few
     * hundred pixels tall wants them smaller and stepped back until hovered —
     * the graph is the thing being read, not its chrome.
     */
    dense?: boolean;
    /** Draw the empty state over the flow. */
    empty?: boolean;
    /** Used when no `empty` slot is supplied. */
    emptyTitle?: string;
    emptyDescription?: string;
  }>(),
  { tone: 'default', dense: false, empty: false },
);

/**
 * Exposed because a consumer positioning an overlay needs this box's rect —
 * a context menu opened at a pointer event is in surface coordinates.
 */
const surfaceEl = ref<HTMLElement | null>(null);
defineExpose({ surfaceEl });
</script>

<style scoped>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/controls/dist/style.css';

.canvas-surface {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.canvas-surface--default {
  background: var(--surface);
}

.canvas-surface--subtle {
  background: var(--surface-subtle);
}

.canvas-surface__underlay {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

/*
 * The layer itself takes no clicks — it covers the whole graph — and each
 * affordance inside it takes its own back. Without that, an overlay slot with
 * one small button in a corner would swallow every drag on the canvas.
 */
.canvas-surface__overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
}

.canvas-surface__overlay > :deep(*) {
  pointer-events: auto;
}

.canvas-surface__empty {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 5;
  transform: translate(-50%, -50%);
}

/* Vue Flow's own controls, themed once rather than per canvas. */
.canvas-surface :deep(.vue-flow__controls) {
  border: 1px solid var(--border-default);
  box-shadow: 0 2px 8px rgb(0 0 0 / 10%);
}

.canvas-surface :deep(.vue-flow__controls-button) {
  background: var(--surface);
  border-bottom: 1px solid var(--border-default);
}

.canvas-surface :deep(.vue-flow__controls-button:hover) {
  background: var(--surface-subtle);
}

.canvas-surface :deep(.vue-flow__controls-button svg) {
  fill: var(--ink-secondary);
}

.canvas-surface--dense :deep(.vue-flow__controls) {
  opacity: 0.8;
  transition: opacity 0.15s ease;
}

.canvas-surface--dense :deep(.vue-flow__controls:hover) {
  opacity: 1;
}

.canvas-surface--dense :deep(.vue-flow__controls-button) {
  width: 20px;
  height: 20px;
  padding: var(--space-2);
}
</style>
