<template>
  <div class="toolbar" :class="[`toolbar--${variant}`, { 'toolbar--wrap': wrap }]">
    <div v-if="$slots.start" class="toolbar__group">
      <slot name="start" />
    </div>
    <div v-if="$slots.default" class="toolbar__group toolbar__group--grow">
      <slot />
    </div>
    <div v-if="$slots.end" class="toolbar__group toolbar__group--end">
      <slot name="end" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The grid-aligned action row that sits above an editor, canvas, or results
 * panel. Owns the row height, padding, and the 6px inter-control gap so
 * individual work areas stop redefining them.
 *
 * Controls placed inside should use the --control-h height and --grid-N as a
 * MIN-width; see docs/reference/ui-design-tokens.md.
 */
withDefaults(
  defineProps<{
    /** `bar` sits on subtle chrome; `plain` is transparent for nesting. */
    variant?: 'bar' | 'plain';
    wrap?: boolean;
  }>(),
  { variant: 'bar', wrap: false },
);
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-3) var(--space-5);
  min-height: calc(var(--control-h) + var(--space-3) * 2);
  flex-shrink: 0;
}

.toolbar--bar {
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.toolbar--plain {
  background: transparent;
  padding: 0;
  min-height: var(--control-h);
}

.toolbar--wrap {
  flex-wrap: wrap;
  row-gap: var(--space-3);
}

.toolbar__group {
  display: flex;
  align-items: center;
  gap: var(--grid-gap);
  min-width: 0;
}

.toolbar__group--grow {
  flex: 1;
  min-width: 0;
}

.toolbar__group--end {
  margin-left: auto;
}

.toolbar--wrap .toolbar__group--end {
  margin-left: 0;
}
</style>
