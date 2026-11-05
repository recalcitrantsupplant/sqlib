<template>
  <div class="json-layout" role="group" aria-label="JSON layout" data-testid="argument-json-layout">
    <button
      v-for="option in LAYOUTS"
      :key="option.value"
      type="button"
      class="json-layout-button"
      :class="{ 'json-layout-button--selected': modelValue === option.value }"
      :aria-pressed="modelValue === option.value"
      :disabled="invalid"
      :data-testid="`argument-json-${option.value}`"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * Compact or expanded, for an rdf:JSON cell. Shared by the row and its
 * pop-out so the two always show the same choice. Disabled while the text
 * does not parse: there is no layout of a text that is not JSON yet.
 */
import type { JsonLayout } from '@/lib/jsonText';

defineProps<{ modelValue: JsonLayout; invalid?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: JsonLayout] }>();

const LAYOUTS: { value: JsonLayout; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'expanded', label: 'Expanded' },
];
</script>

<style scoped>
.json-layout {
  display: inline-flex;
  flex-shrink: 0;
  align-self: flex-start;
  height: 20px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface);
}

.json-layout-button {
  padding: 0 var(--space-3);
  border: none;
  border-right: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-micro);
  cursor: pointer;
}

.json-layout-button:last-child {
  border-right: none;
}

.json-layout-button:hover:not(:disabled) {
  background: var(--surface-raised);
  color: var(--ink);
}

.json-layout-button--selected,
.json-layout-button--selected:hover:not(:disabled) {
  background: var(--segment-selected);
  color: var(--segment-selected-ink);
}

.json-layout-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
