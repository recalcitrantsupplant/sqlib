<template>
  <span v-if="cell.movedAt" class="moved" :title="formatDateTime(cell.movedAt)" data-testid="pointer-moved-by">
    <PersonChip :iri="cell.movedBy" />
    <span class="when">{{ formatDayMonth(cell.movedAt) }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * Who moved an environment pointer to the version it holds, and the day.
 * Renders nothing when no move is recorded: a pointer copied in when the
 * environment was created, or moved before moves were recorded.
 */
import PersonChip from '@/components/shared/PersonChip.vue';
import { formatDateTime, formatDayMonth } from '@/lib/time';
import type { BoardCell } from '@/lib/environmentBoard';

defineProps<{ cell: BoardCell }>();
</script>

<style scoped>
.moved {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.when {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
