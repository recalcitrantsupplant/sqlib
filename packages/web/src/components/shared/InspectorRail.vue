<template>
  <aside v-if="open" class="inspector-rail" :style="{ width: `${width}px` }">
    <PanelHeader :title="title" :subtitle="subtitle" sunken>
      <template #actions>
        <slot name="actions" />
        <button
          v-if="closable"
          type="button"
          class="btn-icon"
          title="Close inspector"
          @click="emit('close')"
        >
          <X :size="16" />
        </button>
      </template>
    </PanelHeader>
    <div class="inspector-rail__body">
      <slot>
        <EmptyState
          v-if="emptyTitle"
          size="sm"
          :title="emptyTitle"
          :description="emptyDescription"
        />
      </slot>
    </div>
    <footer v-if="$slots.footer" class="inspector-rail__footer">
      <slot name="footer" />
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { X } from '@lucide/vue';
import PanelHeader from './PanelHeader.vue';
import EmptyState from './EmptyState.vue';

/**
 * Right-hand properties rail for the canvas archetype (query groups,
 * stratification graph).
 *
 * The canvas archetype is the third layout in the design doc and the one that
 * did not exist, which is why QueryGroupWorkArea grew ~900 lines of one-off
 * canvas chrome. This was the rail half of it; `CanvasShell` and
 * `CanvasSurface` are the rest, and both canvases are built on them (#39).
 *
 * The shell takes its rail as a slot rather than mounting this, because the two
 * rails in the tree are not the same shape: a properties panel is this, and
 * query groups' is a tabbed `InspectorPanel`.
 */
withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    open?: boolean;
    width?: number;
    closable?: boolean;
    /** Rendered when no default slot content is supplied. */
    emptyTitle?: string;
    emptyDescription?: string;
  }>(),
  { open: true, width: 280, closable: true },
);

const emit = defineEmits<{ close: [] }>();
</script>

<style scoped>
.inspector-rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex-shrink: 0;
  background: var(--surface);
  border-left: 1px solid var(--border-default);
}

.inspector-rail__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.inspector-rail__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--grid-gap);
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--border-default);
  background: var(--surface-subtle);
}
</style>
