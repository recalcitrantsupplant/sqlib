<template>
  <DropdownMenu @update:open="(open) => open && load()">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="icon-control icon-control--sm"
        :title="`More for ${row.entity.name}`"
        :aria-label="`More for ${row.entity.name}`"
        :data-testid="`row-menu-${row.entity.name}`"
      >
        <MoreHorizontal />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel>{{ row.entity.name }} · {{ environmentName }}</DropdownMenuLabel>
      <DropdownMenuSub v-if="movesOf">
        <DropdownMenuSubTrigger :data-testid="`row-history-${row.entity.name}`">History</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem v-if="!moves" disabled>Loading…</DropdownMenuItem>
          <DropdownMenuItem v-else-if="!moves.length" disabled>No recorded moves</DropdownMenuItem>
          <div
            v-for="move in moves ?? []"
            :key="move.id"
            class="history-row"
            :data-testid="`history-row-${row.entity.name}`"
          >
            <span class="history-versions">{{ versionLabel(move.fromVersionNumber) }} → {{ versionLabel(move.toVersionNumber) }}</span>
            <span class="history-person"><PersonChip :iri="move.movedBy" /></span>
            <span class="history-when">{{ formatDateTime(move.movedAt) }}</span>
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub v-if="mayMove">
        <DropdownMenuSubTrigger>Other version</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem v-if="!versions" disabled>Loading…</DropdownMenuItem>
          <DropdownMenuItem
            v-for="option in versions ?? []"
            :key="option.id"
            :disabled="option.id === cell.version"
            @select="emit('move', option.id)"
          >
            v{{ option.version }}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <template v-if="mayMove && cell.version">
        <DropdownMenuSeparator />
        <DropdownMenuItem class="danger" @select="emit('move', null)">Remove from {{ environmentName }}</DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { MoreHorizontal } from '@lucide/vue';
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
import PersonChip from '@/components/shared/PersonChip.vue';
import type { EnvironmentMove } from '@/composables/useApiClient';
import type { BoardRow, PromotableEntity } from '@/lib/environmentBoard';
import { formatDateTime } from '@/lib/time';

const props = defineProps<{
  row: BoardRow;
  column: number;
  environmentName: string;
  /** False for a caller who may not move this environment's pointers: the menu shows the history only. */
  mayMove?: boolean;
  versionsOf: (entity: PromotableEntity) => Promise<Array<{ id: string; version: number }>>;
  movesOf?: (entity: PromotableEntity) => Promise<EnvironmentMove[]>;
}>();

const emit = defineEmits<{ (e: 'move', version: string | null): void }>();

const cell = computed(() => props.row.cells[props.column]);
const versions = ref<Array<{ id: string; version: number }> | null>(null);

const moves = ref<EnvironmentMove[] | null>(null);

function versionLabel(number: number | null | undefined): string {
  return typeof number === 'number' ? `v${number}` : '—';
}

/** Versions load once; the history loads on every open, so a move just made shows. */
async function load() {
  if (props.movesOf) {
    moves.value = null;
    props.movesOf(props.row.entity).then(
      (list) => { moves.value = list; },
      () => { moves.value = []; },
    );
  }
  if (!props.mayMove || versions.value) return;
  try {
    versions.value = await props.versionsOf(props.row.entity);
  } catch {
    versions.value = [];
  }
}
</script>

<style scoped>
.danger {
  color: var(--danger-ink);
}

.history-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-body);
}

.history-person {
  min-width: 0;
}

.history-versions {
  min-width: 64px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.history-when {
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
