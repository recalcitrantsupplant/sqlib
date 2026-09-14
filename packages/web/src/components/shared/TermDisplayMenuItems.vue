<script setup lang="ts">
/**
 * The term-display section of a column's header menu.
 *
 * Lives beside sort and filter because it is the same kind of thing: a
 * property of one column, decided where that column is configured. See
 * `useTermDisplay` for why there is no table-wide control.
 */
import { Check } from '@lucide/vue';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { TermDisplayMode } from '@/composables/useTermDisplay';

defineProps<{
  /** The mode the column is rendering in right now. */
  mode: TermDisplayMode;
}>();

const emit = defineEmits<{
  select: [mode: TermDisplayMode];
  selectAll: [mode: TermDisplayMode];
}>();

const modes: Array<{ value: TermDisplayMode; label: string }> = [
  { value: 'prefixed', label: 'Prefixed names' },
  { value: 'full', label: 'Full IRIs' },
];
</script>

<template>
  <div class="px-1 pb-1" data-testid="term-display-menu">
    <DropdownMenuItem
      v-for="option in modes"
      :key="option.value"
      class="flex items-center gap-2 rounded px-2 py-1 text-sm"
      :class="mode === option.value ? 'bg-accent/40 text-accent-foreground' : ''"
      :data-testid="`term-display-${option.value}`"
      :aria-checked="mode === option.value"
      role="menuitemradio"
      @select="emit('select', option.value)"
    >
      <Check v-if="mode === option.value" class="h-3 w-3" />
      <span v-else class="h-3 w-3" aria-hidden="true" />
      <span>{{ option.label }}</span>
    </DropdownMenuItem>
    <DropdownMenuItem
      class="flex items-center gap-2 rounded px-2 py-1 text-sm text-muted-foreground"
      data-testid="term-display-apply-all"
      @select="emit('selectAll', mode)"
    >
      <span class="h-3 w-3" aria-hidden="true" />
      <span>Apply to all columns</span>
    </DropdownMenuItem>
  </div>
</template>
