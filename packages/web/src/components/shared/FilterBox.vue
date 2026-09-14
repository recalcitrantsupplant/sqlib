<template>
  <input
    v-model="model"
    type="search"
    class="filter-box"
    :placeholder="placeholder"
    :aria-label="ariaLabel ?? placeholder"
    :data-testid="testId"
    autocomplete="off"
  >
</template>

<script setup lang="ts">
/**
 * The type-to-filter box that sits over a list of named things.
 *
 * `SearchSelect` is the same idea collapsed into a dropdown; this is for the
 * lists that are already on the screen — a dialog's rows, a picker panel, an
 * axis of checkboxes — where the rows stay visible and only the set shrinks.
 * Filtering itself belongs to the caller (through `lib/fuzzy`, like everything
 * else): what is shared here is the box, so the eight places that grew one do
 * not each invent their own height, border and placeholder voice.
 */
const model = defineModel<string>({ default: '' });

withDefaults(
  defineProps<{
    placeholder?: string;
    ariaLabel?: string;
    testId?: string;
  }>(),
  { placeholder: 'Filter…', ariaLabel: undefined, testId: undefined },
);
</script>

<style scoped>
.filter-box {
  box-sizing: border-box;
  width: 100%;
  height: var(--control-h-sm);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
}

.filter-box::placeholder {
  color: var(--ink-muted);
}

.filter-box:focus {
  outline: none;
  border-color: var(--action);
}
</style>
