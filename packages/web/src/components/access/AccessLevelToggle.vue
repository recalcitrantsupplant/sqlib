<template>
  <span class="level-toggle">
    <SegmentedToggle
      :model-value="modelValue"
      :options="LEVEL_OPTIONS"
      :group-label="groupLabel"
      :disabled="disabled"
      @update:model-value="(value) => emit('update:modelValue', value as Level)"
    />
  </span>
</template>

<script setup lang="ts">
/**
 * None · Saved · Ad hoc, for one operation on one backend.
 *
 * The three segments are one width, so a column of these lines up whatever
 * is chosen in each row.
 */
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';
import { LEVEL_OPTIONS, type Level } from '@/lib/accessModel';

defineProps<{ modelValue: Level; groupLabel: string; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: Level): void }>();
</script>

<style scoped>
.level-toggle {
  display: inline-flex;
}

.level-toggle :deep(.segmented) {
  display: grid;
  grid-template-columns: repeat(3, var(--grid-2));
}

.level-toggle :deep(.segment) {
  padding: 0;
}
</style>
