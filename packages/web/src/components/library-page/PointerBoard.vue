<template>
  <section class="board-section" data-testid="pointer-board">
    <div class="board-tools">
      <FilterBox v-model="text" class="board-filter" placeholder="Filter by name" test-id="board-filter" />
      <SegmentedToggle v-model="filter" :options="filterOptions" group-label="Show" />
      <span class="spacer" />
      <label v-if="groupOnlyCount > 0" class="toggle" title="Queries used only inside groups. They move with their group.">
        <input v-model="showGroupOnly" type="checkbox" data-testid="board-group-only" />
        Group-only ({{ groupOnlyCount }})
      </label>
    </div>

    <div class="table-wrap">
      <table class="board">
        <thead>
          <tr>
            <th>Name</th>
            <th title="The current version of everything">latest</th>
            <th v-for="env in environments" :key="env.id">{{ env.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visible" :key="row.entity.id" :data-testid="`board-row-${row.entity.name}`">
            <td>
              <span class="name">
                <span class="entity-name">{{ row.entity.name }}</span>
                <span class="kind">{{ KIND_LABELS[row.entity.kind] }}</span>
              </span>
            </td>
            <td v-for="(cell, column) in row.cells" :key="cell.environment ?? 'latest'">
              <DropdownMenu v-if="column > 0 && !row.entity.groupOnly && canPromote(cell.environment!)" @update:open="(open) => open && loadVersions(row)">
                <DropdownMenuTrigger as-child>
                  <button
                    type="button"
                    class="cell cell-button"
                    :class="`cell--${cell.state}`"
                    :title="cellTitle(row, column)"
                    :data-testid="`cell-${row.entity.name}-${envName(cell.environment)}`"
                  >
                    {{ cell.versionNumber !== null ? `v${cell.versionNumber}` : '—' }}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>{{ row.entity.name }} · {{ envName(cell.environment) }}</DropdownMenuLabel>
                  <DropdownMenuItem
                    v-if="catchUpTarget(row, column)"
                    :data-testid="`move-${row.entity.name}-${envName(cell.environment)}`"
                    @select="emitMove(row, column, catchUpTarget(row, column)!.version)"
                  >
                    Move {{ envName(cell.environment) }} to v{{ catchUpTarget(row, column)!.versionNumber }}
                    <span class="menu-meta">{{ envName(row.cells[column - 1].environment) }}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Other version</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem v-if="!versions[row.entity.id]" disabled>Loading…</DropdownMenuItem>
                      <DropdownMenuItem
                        v-for="option in versions[row.entity.id] ?? []"
                        :key="option.id"
                        :disabled="option.id === cell.version"
                        @select="emitMove(row, column, option.id)"
                      >
                        v{{ option.version }}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <template v-if="cell.version">
                    <DropdownMenuSeparator />
                    <DropdownMenuItem class="danger" @select="emitMove(row, column, null)">
                      Remove from {{ envName(cell.environment) }}
                    </DropdownMenuItem>
                  </template>
                </DropdownMenuContent>
              </DropdownMenu>
              <span
                v-else
                class="cell"
                :class="`cell--${cell.state}`"
                :title="cellTitle(row, column)"
                :data-testid="`cell-${row.entity.name}-${envName(cell.environment)}`"
              >
                {{ cell.versionNumber !== null ? `v${cell.versionNumber}` : '—' }}
              </span>
            </td>
          </tr>
          <tr v-if="visible.length === 0">
            <td :colspan="environments.length + 2" class="empty-row">Nothing matches.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { Environment } from '@sparql-query-lib/contracts';
import FilterBox from '@/components/shared/FilterBox.vue';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  KIND_LABELS,
  catchUpTarget,
  countBoard,
  filterBoard,
  type BoardFilter,
  type BoardRow,
  type PromotableEntity,
} from '@/lib/environmentBoard';

const props = defineProps<{
  environments: readonly Environment[];
  rows: readonly BoardRow[];
  canPromote: (environment: string) => boolean;
  versionsOf: (entity: PromotableEntity) => Promise<Array<{ id: string; version: number }>>;
}>();

const emit = defineEmits<{
  (e: 'move', value: { environment: string; entity: PromotableEntity; version: string | null; from: string | null }): void;
}>();

const text = ref('');
const filter = ref<BoardFilter>('all');
const showGroupOnly = ref(false);
const versions = reactive<Record<string, Array<{ id: string; version: number }>>>({});

const pool = computed(() => props.rows.filter((row) => showGroupOnly.value || !row.entity.groupOnly));
const groupOnlyCount = computed(() => props.rows.filter((row) => row.entity.groupOnly).length);
const counts = computed(() => countBoard(pool.value));
const lastName = computed(() => props.environments[props.environments.length - 1]?.name ?? '');

const filterOptions = computed(() => [
  { value: 'all', label: `All ${counts.value.all}`, testId: 'board-filter-all' },
  { value: 'behind', label: `Behind ${counts.value.behind}`, testId: 'board-filter-behind' },
  { value: 'missing', label: `Not in ${lastName.value} ${counts.value.missing}`, testId: 'board-filter-missing' },
]);

const visible = computed(() => filterBoard(pool.value, filter.value, text.value));

function envName(id: string | null): string {
  if (id === null) return 'latest';
  return props.environments.find((env) => env.id === id)?.name ?? id;
}

function cellTitle(row: BoardRow, column: number): string | undefined {
  const cell = row.cells[column];
  if (column === 0) return undefined;
  const left = row.cells[column - 1];
  if (cell.state === 'behind' && left.versionNumber !== null) return `${envName(left.environment)} has v${left.versionNumber}`;
  if (cell.state === 'missing') return `Not in ${envName(cell.environment)}`;
  return undefined;
}

async function loadVersions(row: BoardRow) {
  if (versions[row.entity.id]) return;
  try {
    versions[row.entity.id] = await props.versionsOf(row.entity);
  } catch {
    versions[row.entity.id] = [];
  }
}

function emitMove(row: BoardRow, column: number, version: string | null) {
  const cell = row.cells[column];
  if (!cell.environment) return;
  emit('move', { environment: cell.environment, entity: row.entity, version, from: cell.version });
}
</script>

<style scoped>
.board-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.board-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}


.board-filter {
  flex: 0 1 var(--grid-6);
  min-width: var(--grid-6);
}

.spacer {
  flex: 1;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-secondary);
  font-size: var(--text-label);
}


.table-wrap {
  align-self: flex-start;
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
}

.board {
  width: auto;
  border-collapse: collapse;
  font-size: var(--text-body);
}

.board th,
.board td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
  white-space: nowrap;
}

.board th {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.board tbody tr:last-child td {
  border-bottom: none;
}

.name {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-3);
}

.entity-name {
  color: var(--ink);
  font-weight: var(--weight-medium);
}

.kind {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.cell {
  display: inline-flex;
  align-items: center;
  min-width: var(--grid-1);
  height: var(--control-h-sm);
  justify-content: center;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-body);
  font-variant-numeric: tabular-nums;
}

.cell--missing {
  border-color: transparent;
  background: transparent;
  color: var(--ink-muted);
}

.cell--behind {
  border-color: var(--warning-border);
  background: var(--warning-surface);
  color: var(--warning-ink);
}

.cell-button {
  cursor: pointer;
}

.cell-button:hover {
  border-color: var(--action-border);
}

.cell-button.cell--missing {
  border-style: dashed;
  border-color: var(--border-default);
}

.menu-meta {
  margin-left: auto;
  padding-left: var(--space-4);
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.danger {
  color: var(--danger-ink);
}

.empty-row {
  color: var(--ink-muted);
  text-align: center;
}
</style>
