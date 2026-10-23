<template>
  <!--
    The list sidebar's drag edge. It sits over the sidebar's right border
    rather than beside it, so the resting layout is the same as before and the
    handle only shows on hover — the same hover look as the right-hand panels'
    `.vertical-resizer`.
  -->
  <div
    class="sidebar-resizer"
    :class="{ active }"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize the list"
    title="Drag to resize · double-click to reset"
    data-testid="sidebar-resizer"
    @mousedown="emit('start', $event)"
    @dblclick="emit('reset')"
  >
    <div class="resizer-handle"></div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ active?: boolean }>();

const emit = defineEmits<{
  start: [event: MouseEvent];
  reset: [];
}>();
</script>

<style scoped>
.sidebar-resizer {
  position: absolute;
  top: 0;
  right: -4px;
  bottom: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 8px;
  cursor: col-resize;
  transition: background 0.15s ease;
}

.sidebar-resizer:hover,
.sidebar-resizer.active {
  background: var(--action);
}

.sidebar-resizer .resizer-handle {
  width: 2px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: transparent;
  pointer-events: none;
}

.sidebar-resizer:hover .resizer-handle,
.sidebar-resizer.active .resizer-handle {
  background: var(--surface);
}
</style>
