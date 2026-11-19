<template>
  <div class="tag-filter-chips" data-testid="tag-filter-chips">
    <SegmentedToggle
      v-if="modelValue.tags.length > 1"
      :model-value="modelValue.match"
      :options="MATCH_OPTIONS"
      group-label="Match tags"
      size="sm"
      @update:model-value="(match) => emit('update:modelValue', { tags: modelValue.tags, match: match as TagMatch })"
    />
    <span
      v-for="tag in chosen"
      :key="tag.id"
      class="tag-chip"
      :data-testid="`tag-filter-chip-${tag.id}`"
    >
      <TagDot :color="tag.color" size="heading" />
      <span class="tag-chip-name">{{ tag.name }}</span>
      <button
        type="button"
        class="tag-chip-remove"
        :title="`Remove ${tag.name}`"
        :aria-label="`Remove ${tag.name}`"
        @click="remove(tag.id)"
      >
        <X :size="11" />
      </button>
    </span>
    <button type="button" class="tag-chips-clear" data-testid="tag-filter-clear" @click="clear">Clear</button>
  </div>
</template>

<script setup lang="ts">
/**
 * The chosen tags of a section's tag filter, as chips under the filter bar.
 *
 * "Any of | All of" leads the row once two tags are chosen, so the row reads
 * "Any of geo, perth". With one tag the two modes select the same rows. Any of
 * is the default: adding a tag then widens the list.
 */
import { computed } from 'vue';
import { X } from '@lucide/vue';
import TagDot from './TagDot.vue';
import SegmentedToggle from '../shared/SegmentedToggle.vue';
import type { TagFilter, TagMatch } from '../../lib/tagFilter';
import type { TagFilterOption } from './TagFilterMenu.vue';

const MATCH_OPTIONS = [
  { value: 'any', label: 'Any of', title: 'Rows with at least one of these tags', testId: 'tag-filter-match-any' },
  { value: 'all', label: 'All of', title: 'Rows with every one of these tags', testId: 'tag-filter-match-all' },
] as const;

const props = defineProps<{
  tags: TagFilterOption[];
  modelValue: TagFilter;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: TagFilter];
}>();

const chosen = computed(() => props.modelValue.tags
  .map((id) => props.tags.find((tag) => tag.id === id))
  .filter((tag): tag is TagFilterOption => !!tag));

function remove(id: string) {
  emit('update:modelValue', { tags: props.modelValue.tags.filter((value) => value !== id), match: props.modelValue.match });
}

function clear() {
  emit('update:modelValue', { tags: [], match: props.modelValue.match });
}
</script>

<style scoped>
.tag-filter-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 0 var(--space-4) var(--space-4);
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  height: 20px;
  padding: 0 var(--space-1) 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-label);
}

.tag-chip-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-chip-remove {
  display: inline-grid;
  place-items: center;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-full);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}

.tag-chip-remove:hover {
  background: var(--surface-subtle);
  color: var(--ink);
}

.tag-chips-clear {
  margin-left: auto;
  padding: 0 var(--space-2);
  border: none;
  background: none;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.tag-chips-clear:hover {
  color: var(--ink);
}
</style>
