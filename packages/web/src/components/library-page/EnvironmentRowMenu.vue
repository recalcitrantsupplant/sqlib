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
      <DropdownMenuSub>
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
      <template v-if="cell.version">
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
import type { BoardRow, PromotableEntity } from '@/lib/environmentBoard';

const props = defineProps<{
  row: BoardRow;
  column: number;
  environmentName: string;
  versionsOf: (entity: PromotableEntity) => Promise<Array<{ id: string; version: number }>>;
}>();

const emit = defineEmits<{ (e: 'move', version: string | null): void }>();

const cell = computed(() => props.row.cells[props.column]);
const versions = ref<Array<{ id: string; version: number }> | null>(null);

async function load() {
  if (versions.value) return;
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
</style>
