<template>
  <component
    :is="to ? 'button' : 'div'"
    class="count-card"
    :class="[`count-card--${family}`, { 'count-card--off': disabled }]"
    :type="to ? 'button' : undefined"
    :title="title"
    :aria-disabled="disabled ? 'true' : undefined"
    @click="to && !disabled ? emit('open') : undefined"
  >
    <span class="card-chip">
      <component :is="icon" :size="12" />
    </span>
    <span class="card-label">{{ label }}</span>
    <span class="card-count">{{ disabled || count === null ? '—' : count }}</span>
  </component>
</template>

<script setup lang="ts">
/**
 * One cell of the landing screen's grid: what the library holds of one kind,
 * and the way into it.
 *
 * The number is the point, so it sits at the right-hand end in mono where the
 * eye can run down the column, and the label is left to be read at the same
 * width in every card. A disabled section keeps its cell and its place in the
 * order — the same "tone alone" rule the screen has always used — and shows an
 * em dash, because zero is a fact about a library and "not in this deployment"
 * is not.
 *
 * The family decides only the icon's tint. Three families, in the reading order
 * the rail already has: what the library defines, what it takes in, and what it
 * is judged by. See `--family-*` in tokens.css.
 */
import type { Component } from 'vue';

defineProps<{
  label: string;
  title: string;
  icon: Component;
  /** The count, or null where the kind has nothing to count. */
  count: number | null;
  family: 'definition' | 'input' | 'evidence' | 'axis';
  /** There is somewhere to go. A card without one is a readout. */
  to?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{ (e: 'open'): void }>();
</script>

<style scoped>
.count-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  height: var(--control-h-lg);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
  text-align: left;
}

button.count-card {
  cursor: pointer;
}

button.count-card:hover,
button.count-card:focus-visible {
  border-color: var(--border-strong);
  background: var(--surface-subtle);
}

.count-card--off {
  border-color: var(--border-subtle);
  background: transparent;
  color: var(--ink-muted);
  cursor: default;
}

.card-chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--ink-secondary);
}

.count-card--definition .card-chip {
  background: var(--family-definition-surface);
  color: var(--family-definition);
}

.count-card--input .card-chip {
  background: var(--family-input-surface);
  color: var(--family-input);
}

.count-card--evidence .card-chip {
  background: var(--family-evidence-surface);
  color: var(--family-evidence);
}

/* Off: one flat chip, so the colour says "enabled" before the reader has read
   a word of it. */
.count-card--off .card-chip {
  background: var(--surface-subtle);
  color: var(--ink-muted);
}

.card-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.card-count {
  margin-left: auto;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--text-content);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
}
</style>
