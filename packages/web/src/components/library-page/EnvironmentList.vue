<template>
  <nav class="env-list" aria-label="Environments" data-testid="environment-list">
    <header class="list-head">
      <SectionLabel as="h2">Environments</SectionLabel>
      <span class="spacer" />
      <button
        v-if="canControl"
        type="button"
        class="icon-control icon-control--sm"
        title="Add environment"
        aria-label="Add environment"
        data-testid="environment-add"
        @click="emit('add')"
      >
        <Plus />
      </button>
    </header>

    <div class="row row-latest" title="The current version of everything">
      <span class="chain-mark"><Circle :size="8" /></span>
      <span class="name">latest</span>
    </div>
    <button
      v-for="(env, index) in environments"
      :key="env.id"
      type="button"
      class="row"
      :class="{ selected: env.id === selected }"
      :aria-current="env.id === selected ? 'true' : undefined"
      :data-testid="`environment-row-${env.name}`"
      @click="emit('select', env.id)"
    >
      <span class="chain-mark"><ArrowDown :size="12" /></span>
      <span class="name">{{ env.name }}</span>
      <span class="spacer" />
      <StatusBadge
        v-if="differingCount(index + 1) > 0"
        tone="warning"
        :dot="false"
        :title="`${differingCount(index + 1)} behind ${previousName(index)}`"
      >
        {{ differingCount(index + 1) }}
      </StatusBadge>
    </button>

    <span class="spacer-v" />
    <button
      type="button"
      class="row row-compare"
      :class="{ selected: selected === COMPARE_ALL }"
      :aria-current="selected === COMPARE_ALL ? 'true' : undefined"
      data-testid="environment-compare-all"
      @click="emit('select', COMPARE_ALL)"
    >
      <span class="chain-mark"><Table2 :size="12" /></span>
      <span class="name">Compare all</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { ArrowDown, Circle, Plus, Table2 } from '@lucide/vue';
import type { Environment } from '@sparql-query-lib/contracts';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import StatusBadge from '@/components/shared/StatusBadge.vue';
import { COMPARE_ALL, environmentView, type BoardRow } from '@/lib/environmentBoard';

const props = defineProps<{
  environments: readonly Environment[];
  rows: readonly BoardRow[];
  /** An environment id, or `compare` for the whole board. */
  selected: string | null;
  canControl: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', value: string): void;
  (e: 'add'): void;
}>();

function differingCount(column: number): number {
  return environmentView(props.rows, column).differing.length;
}

function previousName(index: number): string {
  return index === 0 ? 'latest' : props.environments[index - 1].name;
}
</script>

<style scoped>
.env-list {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: var(--grid-6);
  padding-bottom: var(--space-4);
  border-right: 1px solid var(--border-default);
  background: var(--surface-subtle);
  overflow-y: auto;
}

.list-head {
  display: flex;
  align-items: center;
  padding: var(--space-5) var(--space-4) var(--space-3) var(--space-5);
}

.spacer {
  flex: 1;
}

.spacer-v {
  flex: 1;
  min-height: var(--space-6);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--control-h);
  padding: 0 var(--space-4) 0 var(--space-5);
  border: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
}

.row:hover {
  background: var(--surface-sunken);
}

.row:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: calc(-1 * var(--focus-ring-width));
}

.row.selected {
  background: var(--action-surface);
  box-shadow: inset 2px 0 0 var(--action);
}

.row-latest {
  color: var(--ink-muted);
  cursor: default;
}

.row-latest:hover {
  background: transparent;
}

.row-compare {
  color: var(--ink-secondary);
}

.chain-mark {
  display: inline-flex;
  justify-content: center;
  width: var(--icon);
  color: var(--ink-muted);
}

.name {
  font-weight: var(--weight-medium);
}
</style>
