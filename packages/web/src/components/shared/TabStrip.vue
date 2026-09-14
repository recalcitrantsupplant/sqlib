<template>
  <div class="tab-row" :class="`tab-row--${variant}`" role="tablist" :aria-label="groupLabel">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      class="tab"
      :class="{ 'tab-on': tab.value === modelValue }"
      :aria-selected="tab.value === modelValue"
      :data-testid="tab.testId"
      :title="tab.title"
      @click="emit('update:modelValue', tab.value)"
    >
      <component :is="tab.icon" v-if="tab.icon" :size="13" :class="tab.iconClass" />
      <span class="tab-label">{{ tab.label }}</span>
      <span v-if="tab.count !== undefined" class="tab-count">{{ tab.count }}</span>
    </button>

    <!-- What the strip carries beside its tabs: a pill, an action or two. -->
    <slot />
    <div v-if="$slots.actions" class="tab-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A row of tabs, in the two places the app puts one.
 *
 * `sidebar` — the tabs share the width, 40px so the lower border lines up with
 * the editor header (nav doc §2). Benchmarks drew this first as Plan / Runs;
 * Tests uses it for Tests / Runs.
 *
 * `pane` — the main pane's own tabs, 44px, packed from the left with room for
 * a pill and actions after them.
 *
 * One component for both because they are the same object: hand-drawn tablists
 * are already the app's most duplicated chrome, and adding a sixth spec for
 * heights, borders and count treatment is how the segmented control ended up
 * with four (design system doc §5).
 */
import type { Component } from 'vue';

export interface Tab {
  value: string;
  label: string;
  /** A count sits after the label, muted: how much the tab holds. */
  count?: number;
  icon?: Component;
  /** For an icon that carries a verdict rather than an identity. */
  iconClass?: string;
  title?: string;
  testId?: string;
}

withDefaults(defineProps<{
  modelValue: string;
  tabs: readonly Tab[];
  groupLabel: string;
  variant?: 'sidebar' | 'pane';
}>(), { variant: 'sidebar' });

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<style scoped>
.tab-row {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface);
}

.tab-row--sidebar {
  align-items: stretch;
  height: 40px;
}

/* The pane strip is taller and packed from the left: its tabs are documents,
   not halves of one list. */
.tab-row--pane {
  align-items: center;
  gap: var(--space-2);
  height: 44px;
  padding: 0 var(--space-3);
}

.tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.tab-row--sidebar .tab {
  flex: 1;
}

.tab-row--pane .tab {
  height: 100%;
  max-width: var(--grid-8);
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab:hover {
  color: var(--ink);
}

.tab-actions {
  margin-left: auto;
  display: flex;
  gap: var(--space-2);
}

.tab-on {
  color: var(--action);
  border-bottom-color: var(--action);
  font-weight: var(--weight-semibold);
}

/* Muted, and never the same weight as the label: it is the size of the thing,
   not the thing. */
.tab-count {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-normal);
}
</style>
