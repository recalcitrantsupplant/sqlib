<template>
  <nav class="rail" aria-label="Notebook contents" data-testid="notebook-rail">
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
</template>

<script setup lang="ts">
import { Badge } from '../ui/badge';
import InlineNote from '../shared/InlineNote.vue';

/**
 * The notebook's contents: one row per cell, in document order.
 *
 * A tab in the right-hand panel rather than a rail of its own. It had a column
 * once, which cost the reading column more width than the list was worth — and
 * it belongs beside what the notebook has produced, which is the other question
 * you ask about a document you are not currently reading.
 */
defineProps<{
  entries: Array<{ id: string; index: number; label: string; badge: string | null; prose: boolean }>;
}>();
</script>

<style scoped>
.rail {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--space-3);
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

</style>
