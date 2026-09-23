<template>
  <section class="log" data-testid="splash-activity">
    <SectionLabel as="h2" class="log-heading">
      Activity
      <span class="log-rule" />
      <span class="log-count">{{ countLabel }}</span>
    </SectionLabel>

    <EmptyState
      v-if="entries.length === 0"
      size="sm"
      title="Nothing has been written yet"
      description="Queries, groups, rule sets and everything beside them appear here as they are created and edited."
    />

    <ul v-else class="rows">
      <li v-for="entry in entries" :key="entry.id" class="row">
        <span class="row-when" :title="entry.at">{{ age(entry.at) }}</span>
        <span class="row-verb" :class="`row-verb--${entry.verb}`">{{ entry.verb }}</span>
        <button
          type="button"
          class="row-what"
          :title="`Open ${entry.name}`"
          :data-testid="`splash-activity-open-${entry.id}`"
          @click="emit('open', entry)"
        >
          {{ entry.name }}
        </button>
        <span v-if="entry.version !== null" class="row-version">v{{ entry.version }}</span>
        <span class="row-kind">{{ kindOf(entry) }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/**
 * What changed in this library, most recent first.
 *
 * One wide column rather than a card, because the long thing on the row is the
 * entity's name and a name is what a reader scans for. The verb comes before
 * it, so the column of verbs reads down the left the way a log does.
 *
 * Two verbs only — created and updated — and that is the honest limit of what
 * the rows can say. The log is derived from the records that exist now
 * (`useLibraryInventory`), so a deleted entity leaves nothing to sort: there is
 * no stored change history to read, and inventing one from the live change feed
 * would make the screen say something different to a tab that happened to be
 * open at the time.
 */
import { computed } from 'vue';
import SectionLabel from '../shared/SectionLabel.vue';
import EmptyState from '../shared/EmptyState.vue';
import { formatCompactAge } from '../../lib/time';
import { SECTION_DEFINITIONS } from '../../lib/sections';
import type { ActivityEntry } from '../../composables/useLibraryInventory';

const props = defineProps<{ entries: ActivityEntry[] }>();

const emit = defineEmits<{ (e: 'open', entry: ActivityEntry): void }>();

const countLabel = computed(() =>
  props.entries.length === 1 ? '1 change' : `${props.entries.length} changes`,
);

/** The section's own singular noun — "rule set", not the entity's class name. */
function kindOf(entry: ActivityEntry): string {
  return SECTION_DEFINITIONS[entry.section].noun;
}

function age(at: string): string {
  return formatCompactAge(at);
}
</script>

<style scoped>
.log {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
}

/* The heading's rule runs to the count at the right, which is what makes the
   block read as a log rather than as another card. */
.log-heading {
  display: flex;
  align-items: center;
  align-self: stretch;
}

.log-rule {
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

.log-count {
  color: var(--ink-muted);
  font-weight: var(--weight-normal);
}

.rows {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  height: var(--control-h);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--text-body);
}

.row-when {
  flex: 0 0 var(--grid-2);
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
}

.row-verb {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: var(--control-h-sm);
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
}

.row-verb--created {
  background: var(--success-surface);
  color: var(--success-ink);
}

.row-verb--updated {
  background: var(--action-surface);
  color: var(--action-ink);
}

.row-what {
  min-width: 0;
  overflow: hidden;
  border: none;
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
  text-align: left;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
}

.row-what:hover,
.row-what:focus-visible {
  text-decoration: underline;
}

.row-version {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
}

.row-kind {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--ink-muted);
  font-size: var(--text-micro);
}
</style>
