<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="tag-filter-button"
        :class="{ active: modelValue.tags.length > 0, open }"
        :title="buttonTitle"
        :aria-label="buttonTitle"
        data-testid="tag-filter"
      >
        <Tag :size="13" />
        <span v-if="modelValue.tags.length > 0" class="tag-filter-number" data-testid="tag-filter-count">
          {{ modelValue.tags.length }}
        </span>
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        align="start"
        :side-offset="4"
        :collision-padding="8"
        :style="{ zIndex: 50 }"
        @open-auto-focus.prevent="focusSearch"
      >
        <div class="tag-filter-pop" data-testid="tag-filter-menu">
          <div class="tag-filter-head">
            <label class="tag-filter-search">
              <Search :size="12" />
              <input
                ref="searchInput"
                v-model="term"
                type="text"
                class="tag-filter-input"
                :placeholder="`Search ${offered.length.toLocaleString()} tags`"
                aria-label="Search tags"
                data-testid="tag-filter-search"
                @keydown.down.prevent="move(1)"
                @keydown.up.prevent="move(-1)"
                @keydown.enter.prevent="toggleHighlighted"
              />
            </label>
          </div>

          <div class="tag-filter-list" role="listbox" aria-multiselectable="true" aria-label="Tags">
            <template v-for="(row, index) in drawn" :key="row.kind === 'label' ? row.key : row.tag.id">
              <SectionLabel v-if="row.kind === 'label'" class="tag-filter-label">{{ row.text }}</SectionLabel>
              <button
                v-else
                type="button"
                role="option"
                class="tag-filter-item"
                :class="{ highlighted: index === highlight, zero: row.count === 0 }"
                :aria-selected="row.on"
                :data-testid="`tag-filter-option-${row.tag.id}`"
                @mouseenter="highlight = index"
                @click="toggle(row.tag.id)"
              >
                <Check :size="12" :class="['tag-filter-check', { hidden: !row.on }]" />
                <TagDot :color="row.tag.color" size="heading" />
                <span class="tag-filter-name">
                  <template v-for="(segment, i) in row.segments" :key="i">
                    <mark v-if="segment.matched">{{ segment.text }}</mark>
                    <template v-else>{{ segment.text }}</template>
                  </template>
                </span>
                <span class="tag-filter-count">{{ row.count }}</span>
              </button>
            </template>
            <div v-if="remaining > 0" class="tag-filter-more">
              <button type="button" class="btn-compact" data-testid="tag-filter-more" @click="shown += PAGE">
                Show {{ Math.min(PAGE, remaining) }} more
              </button>
            </div>
            <div v-if="matches.length === 0 && term.trim()" class="tag-filter-empty">No tag matches “{{ term.trim() }}”.</div>
          </div>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
/**
 * The tag filter of a section list: a button in the filter bar and a menu of
 * the library's tags.
 *
 * A library can hold a thousand tags, so the menu draws 50 at a time and the
 * search box covers all of them. The search is fuzzy on the name, the rule
 * every name filter in the app uses (`lib/fuzzy.ts`).
 *
 * The chosen tags come first. A tag that no row of this section carries is
 * left out unless it is chosen, so the menu never offers a tag that empties
 * the list on its own.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { Check, Search, Tag } from '@lucide/vue';
import TagDot from './TagDot.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import { fuzzyFilter, type MatchSegment } from '../../lib/fuzzy';
import type { TagFilter } from '../../lib/tagFilter';

export interface TagFilterOption {
  id: string;
  name: string;
  color?: string | null;
}

/** How many tags one step of the list draws. */
const PAGE = 50;

const props = defineProps<{
  tags: TagFilterOption[];
  /** Per tag id, how many rows of the section carry it. */
  counts: Record<string, number>;
  modelValue: TagFilter;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: TagFilter];
}>();

const open = ref(false);
const term = ref('');
const shown = ref(PAGE);
const highlight = ref(-1);
const searchInput = ref<HTMLInputElement | null>(null);

const chosen = computed(() => new Set(props.modelValue.tags));
const countOf = (id: string) => props.counts[id] ?? 0;

const byName = (a: TagFilterOption, b: TagFilterOption) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** The tags the menu can offer: carried by a row here, or already chosen. */
const offered = computed(() =>
  props.tags.filter((tag) => chosen.value.has(tag.id) || countOf(tag.id) > 0).sort(byName));

const matches = computed(() => fuzzyFilter(term.value, offered.value, (tag) => tag.name));

type Row =
  | { kind: 'label'; key: string; text: string }
  | { kind: 'tag'; tag: TagFilterOption; on: boolean; count: number; segments: MatchSegment[] };

const toRow = (match: { item: TagFilterOption; segments: MatchSegment[] }): Row => ({
  kind: 'tag',
  tag: match.item,
  on: chosen.value.has(match.item.id),
  count: countOf(match.item.id),
  segments: match.segments,
});

/** Chosen tags first when nothing is typed. A search ranks every tag together. */
const ordered = computed<Row[]>(() => {
  if (term.value.trim()) return matches.value.map(toRow);
  const on = matches.value.filter((match) => chosen.value.has(match.item.id)).map(toRow);
  const rest = matches.value.filter((match) => !chosen.value.has(match.item.id)).map(toRow);
  if (on.length === 0) return rest;
  return [...on, { kind: 'label', key: 'label:all', text: 'All tags' }, ...rest];
});

const drawn = computed(() => ordered.value.slice(0, shown.value));
const remaining = computed(() => Math.max(0, ordered.value.length - shown.value));

const buttonTitle = computed(() => {
  const count = props.modelValue.tags.length;
  if (count === 0) return 'Filter by tag';
  const names = props.modelValue.tags.map((id) => props.tags.find((tag) => tag.id === id)?.name ?? 'tag');
  return `Filtered by ${names.join(props.modelValue.match === 'any' ? ' or ' : ' and ')}`;
});

watch(term, () => {
  shown.value = PAGE;
  highlight.value = term.value.trim() ? firstTagIndex() : -1;
});

watch(open, (value) => {
  if (value) return;
  term.value = '';
  shown.value = PAGE;
  highlight.value = -1;
});

function firstTagIndex(): number {
  return drawn.value.findIndex((row) => row.kind === 'tag');
}

function focusSearch() {
  void nextTick(() => searchInput.value?.focus());
}

function toggle(id: string) {
  const tags = chosen.value.has(id)
    ? props.modelValue.tags.filter((value) => value !== id)
    : [...props.modelValue.tags, id];
  emit('update:modelValue', { tags, match: props.modelValue.match });
}

function move(step: 1 | -1) {
  const rows = drawn.value;
  if (rows.length === 0) return;
  let next = highlight.value;
  for (let i = 0; i < rows.length; i += 1) {
    next = (next + step + rows.length) % rows.length;
    if (rows[next]?.kind === 'tag') break;
  }
  highlight.value = next;
}

function toggleHighlighted() {
  const row = drawn.value[highlight.value];
  if (row?.kind === 'tag') toggle(row.tag.id);
}
</script>

<style scoped>
.tag-filter-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-1);
  margin-right: calc(-1 * var(--space-3));
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.tag-filter-button:hover,
.tag-filter-button.open {
  background: var(--surface-subtle);
  color: var(--ink-secondary);
}

.tag-filter-button.active {
  background: var(--action-surface);
  color: var(--action-ink);
  font-weight: var(--weight-semibold);
}

.tag-filter-number {
  font-variant-numeric: tabular-nums;
}

.tag-filter-pop {
  display: flex;
  flex-direction: column;
  width: 300px;
  max-height: min(480px, var(--reka-popover-content-available-height, 60vh));
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-md);
}

.tag-filter-head {
  flex-shrink: 0;
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.tag-filter-search {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
}

.tag-filter-search:focus-within {
  border-color: var(--action-border);
}

.tag-filter-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
  outline: none;
}

.tag-filter-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-1) 0 var(--space-2);
}

.tag-filter-label {
  padding: var(--space-3) var(--space-4) var(--space-1);
}

.tag-filter-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: var(--space-2) var(--space-4);
  border: none;
  background: none;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
}

.tag-filter-item.highlighted {
  background: var(--surface-subtle);
}

.tag-filter-item.zero {
  color: var(--ink-muted);
}

.tag-filter-check {
  flex-shrink: 0;
  color: var(--action-ink);
}

.tag-filter-check.hidden {
  visibility: hidden;
}

.tag-filter-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-filter-name mark {
  background: none;
  color: var(--action-ink);
  font-weight: var(--weight-semibold);
}

.tag-filter-count {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
}

.tag-filter-more {
  display: flex;
  justify-content: center;
  padding: var(--space-3) 0 var(--space-1);
}

.tag-filter-empty {
  padding: var(--space-4);
  color: var(--ink-muted);
  font-size: var(--text-body);
}
</style>
