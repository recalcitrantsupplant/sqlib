<template>
  <aside class="rail" aria-label="Notebook contents" data-testid="notebook-rail">
    <div class="rail__head">
      <SectionLabel as="h2">Outline</SectionLabel>
    </div>

    <nav class="outline">
      <a
        v-for="entry in entries"
        :key="entry.id"
        class="entry"
        :href="`#cell-${entry.id}`"
        :data-testid="`notebook-outline-${entry.id}`"
      >
        <span class="entry__index">{{ entry.index }}</span>
        <span class="entry__name" :class="{ 'entry__name--prose': entry.prose }">{{ entry.label }}</span>
        <Badge v-if="entry.badge" variant="secondary" class="entry__badge">{{ entry.badge }}</Badge>
      </a>
      <InlineNote v-if="entries.length === 0" size="xs" class="empty-note">No cells yet</InlineNote>
    </nav>

    <div class="rail__divider"></div>

    <div class="rail__head">
      <SectionLabel as="h2">Values</SectionLabel>
      <InlineNote as="span" size="xs">this session</InlineNote>
    </div>

    <div class="values">
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
          <span v-if="staleNames.includes(value.name)" class="value__stale">stale</span>
        </div>
        <div class="value__stats">{{ describeValue(value) }}</div>
      </div>
      <InlineNote v-if="values.length === 0" size="xs" class="empty-note">
        Nothing has run. Each run binds a name here.
      </InlineNote>
    </div>

    <div class="rail__foot">
      Values live in this session. <strong>Save</strong> writes one to the library as a data graph
      or tuple set.
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Badge } from '../ui/badge';
import InlineNote from '../shared/InlineNote.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import { describeValue, type NotebookValue } from '../../lib/notebookValues';

/**
 * The notebook's contents, beside the document rather than above it.
 *
 * Two lists, and the second is the one the library page had no place for: what
 * this session has produced, with the stats that say whether it is worth
 * keeping. A value that went stale is marked in both places — in the rail
 * because that is where you look to see what you have, on the cell because that
 * is where you decide to re-run.
 */
defineProps<{
  entries: Array<{ id: string; index: number; label: string; badge: string | null; prose: boolean }>;
  values: NotebookValue[];
  staleNames: string[];
}>();
</script>

<style scoped>
.rail {
  width: 264px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-default);
  background: var(--surface);
  overflow: hidden;
}

.rail__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-4) var(--space-3);
}


.rail__divider {
  height: 1px;
  margin: var(--space-4) var(--space-4) 0;
  background: var(--border-subtle);
}

.outline {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 var(--space-3);
  overflow-y: auto;
}

.entry {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  color: inherit;
  text-decoration: none;
}

.entry:hover {
  background: var(--surface-subtle);
  text-decoration: none;
}

.entry__index {
  width: var(--space-5);
  flex-shrink: 0;
  text-align: right;
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.entry__name {
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--text-body);
}

.entry__name--prose {
  font-family: var(--font-sans);
  font-weight: var(--weight-semibold);
}

.entry__badge {
  font-size: var(--text-micro);
}

.values {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  overflow-y: auto;
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

.value__stale {
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  color: var(--warning-ink);
}

.value__stats {
  margin-top: var(--space-1);
  font-size: var(--text-micro);
  color: var(--ink-secondary);
}

/*
 * The margin and the dashed well stay with the rail, as the note primitive
 * asks: where a note sits is a fact about the block above it, and the class
 * lands on the note's own root because Vue puts the parent's scope attribute
 * there.
 */
.empty-note {
  display: block;
  margin: 0 var(--space-3);
  padding: var(--space-5) var(--space-3);
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-sm);
  text-align: center;
}

.rail__foot {
  margin-top: auto;
  padding: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-micro);
  line-height: var(--leading-normal);
  color: var(--ink-muted);
}
</style>
