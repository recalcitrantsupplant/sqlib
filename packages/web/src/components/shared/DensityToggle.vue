<template>
  <div class="density-toggle" role="group" aria-label="Row density">
    <button
      type="button"
      class="density-button"
      :class="{ active: modelValue === 'compact' }"
      :aria-pressed="modelValue === 'compact'"
      title="Compact"
      data-testid="density-compact"
      @click="$emit('update:modelValue', 'compact')"
    >
      <AlignJustify :size="13" />
    </button>
    <button
      type="button"
      class="density-button"
      :class="{ active: modelValue === 'comfortable' }"
      :aria-pressed="modelValue === 'comfortable'"
      title="Comfortable"
      data-testid="density-comfortable"
      @click="$emit('update:modelValue', 'comfortable')"
    >
      <Rows3 :size="13" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { AlignJustify, Rows3 } from '@lucide/vue';
import type { EntityListDensity } from '@/composables/useSettings';

/**
 * One line per row, or a row with its description under it.
 *
 * Drawn by hand in the entity sidebar first, and wanted verbatim by every other
 * list of named things — the notebook's contents next. Shared rather than
 * copied for the reason `SegmentedToggle` was: two hand-drawn copies of one
 * control drift in height and radius long before they drift in colour. See
 * docs/reference/ui-design-tokens.md §5.
 */
defineProps<{ modelValue: EntityListDensity }>();

defineEmits<{ (e: 'update:modelValue', value: EntityListDensity): void }>();
</script>

<style scoped>
.density-toggle {
  display: inline-flex;
  flex-shrink: 0;
  height: 26px;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.density-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  border: none;
  background: var(--surface);
  color: var(--ink-muted);
  cursor: pointer;
}

.density-button + .density-button {
  border-left: 1px solid var(--border-default);
}

.density-button.active {
  background: var(--segment-selected);
  color: var(--segment-selected-ink);
}
</style>
