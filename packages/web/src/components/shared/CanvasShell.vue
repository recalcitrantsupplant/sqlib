<template>
  <div ref="rootEl" class="canvas-shell">
    <div
      class="canvas-shell__main"
      :class="{ 'canvas-shell__main--fill': mainWidthPercent === undefined }"
      :style="mainStyle"
    >
      <!--
        Unwrapped: the bars are already block children of a flex column, and a
        wrapper here would be a second column for them to be laid out in. What
        the archetype fixes is that they sit above the surface, not what they
        are — a simple canvas puts one `<Toolbar>` here, query groups puts the
        three bars a versioned entity carries.
      -->
      <slot name="toolbar" />

      <CanvasSurface
        ref="surface"
        :tone="tone"
        :dense="dense"
        :empty="empty"
        :empty-title="emptyTitle"
        :empty-description="emptyDescription"
      >
        <slot />
        <template v-if="$slots.underlay" #underlay><slot name="underlay" /></template>
        <template v-if="$slots.overlay" #overlay><slot name="overlay" /></template>
        <template v-if="$slots.empty" #empty><slot name="empty" /></template>
      </CanvasSurface>
    </div>

    <!--
      The drag handle between the two, when the screen has one. It is a slot
      rather than the shell's own affordance because the same handle appears on
      nine work areas that are not canvases — the arithmetic is already shared
      (`usePanelResize`), the markup is a sweep of its own (#37).
    -->
    <slot name="separator" />
    <slot name="rail" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import CanvasSurface from './CanvasSurface.vue';

/**
 * The canvas layout archetype: `toolbar → surface → rail`
 * (`docs/reference/ui-design-tokens.md` §6, step 5).
 *
 * Two screens draw a graph — query groups and the stratification view — and
 * neither had a skeleton to be an instance of, so the first one wrote the
 * skeleton into itself: 931 lines of one-off canvas chrome, per issue #39.
 *
 * The shell is deliberately thin. It owns the split and nothing else; the
 * surface owns the graph box (`CanvasSurface`), and what goes in the rail is
 * the consumer's — `InspectorRail` for a properties panel, `InspectorPanel`
 * where the rail is tabbed. A canvas with no rail uses `CanvasSurface`
 * directly rather than this with two empty slots.
 */
const props = withDefaults(
  defineProps<{
    /**
     * The main column's width as a share of the shell. Absent — a canvas with
     * no rail — and it simply takes what is left.
     */
    mainWidthPercent?: number;
    /** Forwarded to `CanvasSurface`. */
    tone?: 'default' | 'subtle';
    dense?: boolean;
    empty?: boolean;
    emptyTitle?: string;
    emptyDescription?: string;
  }>(),
  { tone: 'default', dense: false, empty: false },
);

const mainStyle = computed(() =>
  props.mainWidthPercent === undefined ? undefined : { width: `${props.mainWidthPercent}%` },
);

const rootEl = ref<HTMLElement | null>(null);
const surface = ref<InstanceType<typeof CanvasSurface> | null>(null);

/**
 * `rootEl` is what `usePanelResize` measures the drag against; `surfaceEl` is
 * what an overlay is positioned against. Both are the shell's elements now, so
 * both are handed back rather than left for a consumer to re-find.
 */
defineExpose({
  rootEl,
  surfaceEl: computed(() => surface.value?.surfaceEl ?? null),
});
</script>

<style scoped>
.canvas-shell {
  position: relative;
  display: flex;
  height: 100%;
  background: var(--surface-raised);
}

/*
 * No `flex: 1` here: a width given as a share of the shell is a basis the
 * column must hold, and growing past it is what the rail's own width is for.
 * The modifier is the other case — no rail, so the column takes the pane.
 */
.canvas-shell__main {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--surface);
}

.canvas-shell__main--fill {
  flex: 1;
}
</style>
