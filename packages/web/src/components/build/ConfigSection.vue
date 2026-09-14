<template>
  <section class="config-section">
    <header class="section-head">
      <span class="section-title">{{ title }}</span>
      <span class="section-count">{{ rows.length }}</span>
      <!--
        "not callable — they change what queries return" earns its place: a
        ruleset in a list of callables reads as something you can POST to, and
        it is not.
      -->
      <InlineNote v-if="note" as="span" data-testid="config-section-note">{{ note }}</InlineNote>
      <span class="rule" />
    </header>

    <InlineNote v-if="rows.length === 0" class="empty">{{ emptyMessage }}</InlineNote>

    <div v-for="row in rows" :key="row.id" class="config-row" :data-config-id="row.id">
      <Scale v-if="kind === 'ruleset'" :size="14" class="row-icon" />
      <Server v-else :size="14" class="row-icon" />
      <span class="row-name">{{ row.name }}</span>
      <StatusBadge v-if="row.badge" size="xs" :dot="false" :tone="row.badgeTone" data-testid="config-row-badge">{{ row.badge }}</StatusBadge>
      <span v-for="(fact, index) in row.facts" :key="index" class="row-fact">{{ fact }}</span>
      <button type="button" class="row-open" :title="openTitle" @click="emit('open', row.id)">
        <ArrowUpRight :size="11" />
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Scale, Server, ArrowUpRight } from '@lucide/vue';
import InlineNote from '../shared/InlineNote.vue';
import StatusBadge from '../shared/StatusBadge.vue';

export interface ConfigRow {
  id: string;
  name: string;
  badge: string | null;
  badgeTone: 'neutral' | 'success' | 'warning';
  facts: string[];
}

defineProps<{
  title: string;
  /** Chooses the glyph, and nothing else. */
  kind: 'ruleset' | 'backend';
  rows: ConfigRow[];
  note?: string;
  emptyMessage: string;
  openTitle: string;
}>();

const emit = defineEmits<{ (e: 'open', id: string): void }>();
</script>

<style scoped>
.config-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex-shrink: 0;
}

.section-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-1) 0;
}

.section-title {
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-muted);
}

.section-count {
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.rule {
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

/* Aligned with the rows it stands in for, which is the section's fact. */
.empty {
  padding: 0 var(--space-1);
}

.config-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.row-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.row-name {
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  color: var(--ink);
}

.row-fact {
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.row-open {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: auto;
  flex-shrink: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  cursor: pointer;
}

.row-open:hover {
  background: var(--surface-subtle);
}
</style>
