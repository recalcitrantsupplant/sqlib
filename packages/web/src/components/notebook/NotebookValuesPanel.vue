<template>
  <div class="values" data-testid="notebook-values">
    <div
      v-for="value in values"
      :key="value.name"
      class="value"
      :class="{ 'value--stale': staleNames.includes(value.name) }"
      :data-testid="`notebook-value-${value.name}`"
    >
      <div class="value__top">
        <span class="value__dot" :class="`value__dot--${value.type}`" aria-hidden="true"></span>
        <span class="value__name">@{{ value.name }}</span>
        <StatusBadge v-if="staleNames.includes(value.name)" status="stale" label="stale" />
      </div>
      <div class="value__stats">{{ describeValue(value) }}</div>
    </div>

    <EmptyState
      v-if="values.length === 0"
      size="sm"
      title="Nothing has run"
      description="Each run binds its result to a name the cells below can read."
    />

    <InlineNote v-else size="xs" class="values__foot">
      Values live in this session. <strong>Save</strong> writes one to the library as a data graph
      or tuple set.
    </InlineNote>
  </div>
</template>

<script setup lang="ts">
import EmptyState from '../shared/EmptyState.vue';
import InlineNote from '../shared/InlineNote.vue';
import StatusBadge from '../shared/StatusBadge.vue';
import { describeValue, type NotebookValue } from '../../lib/notebookValues';

/**
 * What this session has produced, in the right-hand panel every other work
 * area keeps its properties in.
 *
 * It sat in the contents rail on the left at first, which put two unrelated
 * lists in one column: what the notebook *says* and what it has *made*. The
 * second is inspector material — the same place a data graph's details and a
 * query's results live — and the move leaves the left rail doing one job.
 */
defineProps<{
  values: NotebookValue[];
  /** Names whose producing cell has been re-run since these were bound. */
  staleNames: string[];
}>();
</script>

<style scoped>
.values {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}

.value {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
}

.value--stale {
  border-color: var(--warning-border);
  background: var(--warning-surface);
}

.value__top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.value__dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--kind-bindings);
}

.value__dot--graph {
  background: var(--kind-graph);
}

.value__dot--boolean {
  background: var(--kind-boolean);
}

.value__name {
  flex-grow: 1;
  font-family: var(--font-mono);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
}

.value__stats {
  margin-top: var(--space-1);
  font-size: var(--text-micro);
  color: var(--ink-secondary);
}

.values__foot {
  display: block;
  margin-top: var(--space-2);
  line-height: var(--leading-normal);
}
</style>
