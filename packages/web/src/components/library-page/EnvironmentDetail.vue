<template>
  <section class="detail" :data-testid="`environment-detail-${environment.name}`">
    <header class="head">
      <h2 class="name">{{ environment.name }}</h2>
      <span class="spacer" />
      <template v-if="canControl">
        <button type="button" class="btn-compact" :data-testid="`environment-edit-${environment.name}`" @click="emit('edit')">Edit</button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button type="button" class="icon-control" :title="`More for ${environment.name}`" :aria-label="`More for ${environment.name}`" :data-testid="`environment-menu-${environment.name}`">
              <MoreHorizontal />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem :disabled="isFirst" @select="emit('reorder', -1)">Move up the chain</DropdownMenuItem>
            <DropdownMenuItem :disabled="isLast" @select="emit('reorder', 1)">Move down the chain</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="danger" :data-testid="`environment-delete-${environment.name}`" @select="emit('delete')">Delete…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
    </header>

    <dl v-if="facts.length" class="facts">
      <template v-for="fact in facts" :key="fact.label">
        <dt>{{ fact.label }}</dt><dd :title="fact.value">{{ fact.value }}</dd>
      </template>
    </dl>

    <InlineNote v-if="notice" :tone="notice.tone === 'danger' ? 'danger' : 'muted'" as="div" class="notice" data-testid="board-notice">
      <span>{{ notice.text }}</span>
      <button type="button" class="icon-control icon-control--sm" title="Dismiss" aria-label="Dismiss" @click="emit('dismiss')"><X /></button>
    </InlineNote>

    <section v-if="view.differing.length" class="group" data-testid="environment-differing">
      <header class="group-head">
        <SectionLabel as="h3">Behind {{ previousName }}</SectionLabel>
        <StatusBadge tone="warning" size="xs" :dot="false">{{ view.differing.length }}</StatusBadge>
        <span class="spacer" />
        <button
          v-if="mayPromote && view.differing.length > 1"
          type="button"
          class="btn-compact btn-primary"
          :disabled="busy"
          data-testid="environment-move-all"
          @click="emit('move-all', view.differing.map((row) => moveOf(row, catchUpTarget(row, column)!.version)))"
        >
          Move all {{ view.differing.length }}
        </button>
      </header>
      <ul class="list">
        <li v-for="row in view.differing" :key="row.entity.id" class="item" :data-testid="`environment-item-${row.entity.name}`">
          <span class="entity">{{ row.entity.name }}</span>
          <span class="kind">{{ KIND_LABELS[row.entity.kind] }}</span>
          <span class="spacer" />
          <span class="versions">
            <span class="chip" :class="`chip--${row.cells[column].state}`">{{ label(row.cells[column]) }}</span>
            <ArrowRight :size="12" class="arrow" aria-hidden="true" />
            <span class="chip">{{ label(catchUpTarget(row, column)!) }}</span>
          </span>
          <template v-if="mayPromote">
            <button
              type="button"
              class="btn-compact row-button"
              :disabled="busy"
              :data-testid="`move-${row.entity.name}-${environment.name}`"
              @click="emit('move', moveOf(row, catchUpTarget(row, column)!.version))"
            >
              {{ row.cells[column].version ? 'Move' : 'Add' }}
            </button>
            <RowMenu :row="row" :column="column" :environment-name="environment.name" :versions-of="versionsOf" @move="(version) => emit('move', moveOf(row, version))" />
          </template>
        </li>
      </ul>
    </section>

    <section v-if="view.inStep.length" class="group">
      <button type="button" class="fold" :aria-expanded="inStepOpen" data-testid="environment-in-step" @click="inStepOpen = !inStepOpen">
        <ChevronRight :size="12" class="fold-icon" :class="{ open: inStepOpen }" />
        {{ view.inStep.length }} in step with {{ previousName }}
      </button>
      <ul v-if="inStepOpen" class="list">
        <li v-for="row in view.inStep" :key="row.entity.id" class="item" :data-testid="`environment-item-${row.entity.name}`">
          <span class="entity">{{ row.entity.name }}</span>
          <span class="kind">{{ KIND_LABELS[row.entity.kind] }}</span>
          <span class="spacer" />
          <span class="chip" :class="`chip--${row.cells[column].state}`">{{ label(row.cells[column]) }}</span>
          <RowMenu v-if="mayPromote" :row="row" :column="column" :environment-name="environment.name" :versions-of="versionsOf" @move="(version) => emit('move', moveOf(row, version))" />
        </li>
      </ul>
    </section>

    <EmptyState v-if="!view.differing.length && !view.inStep.length" size="sm" title="Nothing to promote yet" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowRight, ChevronRight, MoreHorizontal, X } from '@lucide/vue';
import type { Backend, Environment } from '@sparql-query-lib/contracts';
import EmptyState from '@/components/shared/EmptyState.vue';
import InlineNote from '@/components/shared/InlineNote.vue';
import SectionLabel from '@/components/shared/SectionLabel.vue';
import StatusBadge from '@/components/shared/StatusBadge.vue';
import RowMenu from '@/components/library-page/EnvironmentRowMenu.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  KIND_LABELS,
  catchUpTarget,
  environmentView,
  type BoardCell,
  type BoardRow,
  type PointerMove,
  type PromotableEntity,
} from '@/lib/environmentBoard';

const props = defineProps<{
  environment: Environment;
  /** The environment's column on the board: 1 for the first in the chain. */
  column: number;
  previousName: string;
  rows: readonly BoardRow[];
  backends: readonly Backend[];
  holders: { promote: string[]; execute: string[] } | null;
  canControl: boolean;
  mayPromote: boolean;
  isFirst: boolean;
  isLast: boolean;
  busy?: boolean;
  notice: { tone: 'warning' | 'danger'; text: string } | null;
  versionsOf: (entity: PromotableEntity) => Promise<Array<{ id: string; version: number }>>;
}>();

const emit = defineEmits<{
  (e: 'edit'): void;
  (e: 'reorder', by: -1 | 1): void;
  (e: 'delete'): void;
  (e: 'move', value: PointerMove): void;
  (e: 'move-all', value: PointerMove[]): void;
  (e: 'dismiss'): void;
}>();

const inStepOpen = ref(false);
watch(() => props.environment.id, () => { inStepOpen.value = false; });

const view = computed(() => environmentView(props.rows, props.column));

const facts = computed(() => {
  const list: Array<{ label: string; value: string }> = [];
  const backend = props.backends.find((candidate) => candidate.id === props.environment.defaultBackend);
  if (backend) list.push({ label: 'Backend', value: backend.name });
  if (props.holders?.promote.length) list.push({ label: 'Promote', value: props.holders.promote.join(', ') });
  if (props.holders?.execute.length) list.push({ label: 'Run', value: props.holders.execute.join(', ') });
  return list;
});

function label(cell: BoardCell): string {
  return cell.versionNumber !== null ? `v${cell.versionNumber}` : '—';
}

function moveOf(row: BoardRow, version: string | null): PointerMove {
  return { environment: props.environment.id, entity: row.entity, version, from: row.cells[props.column].version };
}
</script>

<style scoped>
.detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-6);
  min-width: 0;
  max-width: 640px;
  padding: var(--space-6) var(--space-7);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.name {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
}

.spacer {
  flex: 1;
}

.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-3) var(--space-7);
  margin: 0;
  font-size: var(--text-body);
}

.facts dt {
  color: var(--ink-muted);
}

.facts dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notice {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.notice span {
  flex: 1;
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.group-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--control-h);
}

.list {
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  list-style: none;
}

.item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--grid-unit);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--text-body);
}

.item:last-child {
  border-bottom: none;
}

.entity {
  overflow: hidden;
  color: var(--ink);
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kind {
  flex-shrink: 0;
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.versions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2);
}

.arrow {
  color: var(--ink-muted);
}

.chip {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  min-width: var(--grid-1);
  height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-body);
  font-variant-numeric: tabular-nums;
}

.chip--behind {
  border-color: var(--warning-border);
  background: var(--warning-surface);
  color: var(--warning-ink);
}

.chip--missing {
  border-style: dashed;
  color: var(--ink-muted);
}

.fold {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  font: inherit;
  font-size: var(--text-body);
  cursor: pointer;
}

.fold:hover {
  color: var(--ink-secondary);
}

.fold-icon {
  transition: transform var(--duration-fast);
}

.fold-icon.open {
  transform: rotate(90deg);
}

.row-button {
  height: var(--control-h-sm);
}

.danger {
  color: var(--danger-ink);
}
</style>
