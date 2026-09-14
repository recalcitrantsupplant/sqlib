<template>
  <div class="callable-table">
    <div class="header-row">
      <span />
      <span class="column-label name-label">Callable</span>
      <span class="column-label inputs-label">Inputs</span>
      <span class="column-label returns-label">Returns</span>
      <span />
    </div>

    <EmptyState v-if="callables.length === 0" size="sm" :title="emptyMessage" />

    <template v-for="callable in callables" :key="callable.id">
      <CallableRow
        :callable="callable"
        :stacked="stacked"
        :expanded="expandedId === callable.id"
        @toggle="emit('toggle', callable.id)"
        @open="(tab) => emit('open', callable.id, tab)"
        @open-work-area="emit('open-work-area', callable)"
      />
      <!--
        The detail expands in place below its own row, one at a time. Putting
        it inside the row would make it a sixth grid column; putting it here
        keeps every row's grid identical, which is what makes signatures align
        down the list.
      -->
      <CallableDetail
        v-if="expandedId === callable.id"
        :callable="callable"
        :siblings="callables"
        :backend-name="backendName"
        :backend-id="backendId"
        :library-id="libraryId"
        :active-tab="activeTab"
        @update:active-tab="(tab) => emit('update:activeTab', tab)"
        @save="emit('save', callable)"
        @open-work-area="emit('open-work-area', callable)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import CallableRow from './CallableRow.vue';
import EmptyState from '../shared/EmptyState.vue';
import CallableDetail, { type DetailTab } from './CallableDetail.vue';
import type { Callable } from '../../lib/callables';

defineProps<{
  callables: Callable[];
  stacked: boolean;
  expandedId: string | null;
  activeTab: DetailTab;
  backendName: string | null;
  backendId: string | null;
  libraryId: string | null;
  emptyMessage: string;
}>();

const emit = defineEmits<{
  (e: 'toggle', id: string): void;
  (e: 'open', id: string, tab: 'try' | 'code'): void;
  (e: 'open-work-area', callable: Callable): void;
  (e: 'save', callable: Callable): void;
  (e: 'update:activeTab', tab: DetailTab): void;
}>();
</script>

<style scoped>
.callable-table {
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

/* Identical to CallableRow's grid — see the note there. */
.header-row {
  /*
   * Alignment offsets, not spacing: each lines a header label up with its
   * column's content rather than with the rail beside it — 12px of cell
   * padding plus that rail's own width and gap. The two rails are different
   * widths, so the two offsets are too, and neither is a scale step.
   */
  --inputs-rail-indent: 48px;
  --returns-rail-indent: 82px;

  display: grid;
  grid-template-columns: 26px 230px minmax(0, 1.02fr) minmax(0, 0.98fr) 112px;
  align-items: center;
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.column-label {
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
}

.name-label {
  padding: var(--space-3) var(--space-4) var(--space-3) 0;
}

/* The left padding is the rail indent declared on .header-row above. */
.inputs-label {
  padding: var(--space-3) var(--space-5) var(--space-3) var(--inputs-rail-indent);
  border-left: 1px solid var(--border-subtle);
}

.returns-label {
  padding: var(--space-3) var(--space-5) var(--space-3) var(--returns-rail-indent);
  border-left: 1px solid var(--border-subtle);
}
</style>
