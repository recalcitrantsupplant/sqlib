<template>
  <section class="breakdown" :data-testid="testId">
    <header class="breakdown-head">
      <component :is="icon" v-if="icon" :size="13" class="breakdown-icon" />
      <SectionLabel as="h3" size="sm">{{ title }}</SectionLabel>
    </header>

    <div class="breakdown-rows">
      <button
        v-for="row in rows"
        :key="row.key"
        type="button"
        class="breakdown-row"
        :class="{ selected: row.key === selectedKey }"
        :data-testid="`${testId}-row`"
        :data-row-key="row.key"
        :aria-pressed="row.key === selectedKey"
        :title="rowTitle(row)"
        @click="emit('select', row.key === selectedKey ? null : row.key)"
      >
        <span class="row-label">
          <TagDot v-if="row.color" :color="row.color" size="row" />
          <span class="row-name">{{ row.label }}</span>
        </span>
        <!--
          Pass, fail, excluded, still to run, in that order: the bar reads left
          to right as "how much of this went well", which is the question being
          asked of it, and the unfilled tail is how much of it is still coming.
        -->
        <span class="bar" aria-hidden="true">
          <span class="bar-pass" :style="{ flexGrow: row.pass }" />
          <span class="bar-fail" :style="{ flexGrow: row.fail }" />
          <span class="bar-excluded" :style="{ flexGrow: row.excluded }" />
          <span class="bar-pending" :style="{ flexGrow: row.pending }" />
        </span>
        <span class="row-tally" :class="{ 'tally-fail': row.fail > 0 }">
          {{ row.pass }}/{{ row.total }}
        </span>
      </button>

      <InlineNote v-if="rows.length === 0" size="xs" class="breakdown-empty">Nothing in this run to break down.</InlineNote>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * One axis of a run, as a list of stacked bars.
 *
 * Instantiated twice on the results pane and asked two different questions with
 * the same shape: by group — is one area broken? — and by backend — is one
 * store broken? Two components would answer them in two visual languages, and
 * the whole value of putting them side by side is that they do not.
 *
 * No caption under either card. The titles carry it.
 *
 * A row is a filter: selecting it narrows the failures list below to that
 * group or that store, and selecting it again clears the filter.
 */
import type { Component } from 'vue';
import SectionLabel from '../shared/SectionLabel.vue';
import InlineNote from '../shared/InlineNote.vue';
import TagDot from '../tags/TagDot.vue';
import type { TestRunBreakdownRow } from '../../lib/testRunSummary';

defineProps<{
  title: string;
  rows: TestRunBreakdownRow[];
  icon?: Component;
  /** The row currently filtering the failures list, if any. */
  selectedKey?: string | null;
  testId: string;
}>();

const emit = defineEmits<{ select: [key: string | null] }>();

/** The split in words, so the bar is readable without reading its colours. */
function rowTitle(row: TestRunBreakdownRow): string {
  const parts = [`${row.pass} passed`, `${row.fail} failed`, `${row.excluded} excluded`];
  if (row.pending > 0) parts.push(`${row.pending} still to run`);
  return parts.join(', ');
}
</script>

<style scoped>
.breakdown {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--surface);
}

.breakdown-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h);
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.breakdown-icon {
  color: var(--ink-muted);
}

.breakdown-rows {
  display: flex;
  flex-direction: column;
  padding: var(--space-2) 0;
}

.breakdown-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  height: var(--control-h-sm);
  padding: 0 var(--space-3);
  border: 0;
  background: none;
  cursor: pointer;
}

.breakdown-row:hover {
  background: var(--surface-sunken);
}

.breakdown-row.selected {
  background: var(--action-surface);
}

.row-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  width: var(--grid-4);
  min-width: 0;
}

.row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-label);
  color: var(--ink-secondary);
}

.bar {
  display: flex;
  flex: 1;
  height: 8px;
  min-width: var(--grid-2);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface-sunken);
}

.bar-pass {
  background: var(--success);
}

.bar-fail {
  background: var(--danger);
}

.bar-excluded {
  background: var(--border-default);
}

/*
 * The tail of a run in flight: the bar's own track, left showing. Painting it
 * would make "not yet" look like a fourth verdict, and it is the absence of one.
 */
.bar-pending {
  background: transparent;
}

/*
 * The filled part grows as verdicts land, so it moves rather than jumping —
 * `flex-grow` is animatable, and a bar that steps is what a progress bar is.
 */
.bar-pass,
.bar-fail,
.bar-excluded,
.bar-pending {
  transition: flex-grow var(--duration-fast) ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .bar-pass,
  .bar-fail,
  .bar-excluded,
  .bar-pending {
    transition: none;
  }
}

.row-tally {
  width: var(--grid-2);
  text-align: right;
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
}

.tally-fail {
  color: var(--danger-ink);
}

.breakdown-empty {
  padding: var(--space-2) var(--space-3);
}
</style>
