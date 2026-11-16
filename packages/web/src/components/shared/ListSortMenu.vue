<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        class="sort-button"
        :class="{ active: !isDefault }"
        :title="`Sort: ${option.label}, ${option.dirLabels[modelValue.dir]}`"
        :aria-label="`Sort: ${option.label}, ${option.dirLabels[modelValue.dir]}`"
        data-testid="list-sort"
      >
        <ArrowUpDown :size="12" />
        <ArrowDown v-if="!isDefault && modelValue.dir === 'desc'" :size="11" />
        <ArrowUp v-else-if="!isDefault" :size="11" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel class="sort-menu-label">Sort by</DropdownMenuLabel>
      <DropdownMenuItem
        v-for="item in options"
        :key="item.key"
        class="sort-menu-item"
        :data-testid="`list-sort-${item.key}`"
        @select="pickKey(item)"
      >
        <Check :size="13" :class="['sort-check', { hidden: item.key !== modelValue.key }]" />
        <span>{{ item.label }}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        v-for="dir in DIRECTIONS"
        :key="dir"
        class="sort-menu-item"
        :data-testid="`list-sort-dir-${dir}`"
        @select="emit('update:modelValue', { key: modelValue.key, dir })"
      >
        <Check :size="13" :class="['sort-check', { hidden: dir !== modelValue.dir }]" />
        <span>{{ option.dirLabels[dir] }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
/**
 * The sort control of a section sidebar: an icon button with a menu of keys,
 * then the two directions of the picked key.
 *
 * The button is icons only, so the filter field keeps its width at 288 px.
 * Any order other than name A to Z adds a direction arrow and takes the active
 * style that the group button uses when on. The tooltip names the order.
 */
import { computed } from 'vue';
import { ArrowDown, ArrowUp, ArrowUpDown, Check } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  DEFAULT_SORT,
  SORT_KEYS,
  sortKeyOption,
  type EntityListSort,
  type EntityListSortKey,
  type SortDirection,
  type SortKeyOption,
} from '../../lib/entityListSort';

const props = defineProps<{
  modelValue: EntityListSort;
  /** The keys this list offers, in menu order. All keys when absent. */
  keys?: EntityListSortKey[];
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: EntityListSort): void }>();

const DIRECTIONS: SortDirection[] = ['asc', 'desc'];

const options = computed(() =>
  props.keys ? SORT_KEYS.filter((item) => props.keys!.includes(item.key)) : SORT_KEYS,
);
const option = computed(() => sortKeyOption(props.modelValue.key));
const isDefault = computed(
  () => props.modelValue.key === DEFAULT_SORT.key && props.modelValue.dir === DEFAULT_SORT.dir,
);

function pickKey(item: SortKeyOption) {
  // Picking the key that is on keeps its direction; a new key starts in its own.
  const dir = item.key === props.modelValue.key ? props.modelValue.dir : item.defaultDir;
  emit('update:modelValue', { key: item.key, dir });
}
</script>

<style scoped>
.sort-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: var(--control-h);
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.sort-button:hover {
  color: var(--ink-secondary);
}

.sort-button.active {
  border-color: var(--action-border);
  background: var(--action-surface);
  color: var(--action-ink);
  font-weight: var(--weight-semibold);
}

.sort-menu-label {
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

.sort-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.sort-check.hidden {
  visibility: hidden;
}
</style>
