<template>
  <div class="tag-picker" data-testid="tag-picker" @keydown.esc.stop="emit('close')">
    <div class="picker-head">
      <Tags :size="13" class="picker-icon" />
      <span class="picker-title">Tags on “{{ entityName }}”</span>
    </div>

    <label class="picker-search">
      <Search :size="12" />
      <input
        ref="searchInput"
        v-model="term"
        type="text"
        class="search-input"
        placeholder="Find or create a tag"
        aria-label="Find or create a tag"
        data-testid="tag-picker-search"
        @keydown.enter.prevent="commitEnter"
      />
    </label>

    <div class="picker-list" role="listbox" :aria-multiselectable="true">
      <button
        v-for="tag in matching"
        :key="tag.id"
        type="button"
        class="picker-row"
        :class="{ on: tag.on }"
        role="option"
        :aria-selected="tag.on"
        :data-testid="`tag-option-${tag.id}`"
        @click="emit('toggle', tag.id)"
      >
        <span class="picker-check"><Check v-if="tag.on" :size="13" /></span>
        <TagDot :color="tag.color" size="heading" />
        <span class="picker-name">{{ tag.name }}</span>
        <span class="picker-count">{{ tag.count }}</span>
      </button>

      <InlineNote v-if="matching.length === 0 && !canCreate" class="picker-empty">
        No tags in this library yet — type a name to make one.
      </InlineNote>
    </div>

    <!--
      Create-on-enter, with the colour shown before the tag exists: the swatch
      is the promise that pressing Enter gives you *that* colour, which is the
      whole of the auto-assign rule made visible (tags mockup 1c).
    -->
    <button
      v-if="canCreate"
      type="button"
      class="picker-create"
      data-testid="tag-picker-create"
      @click="emit('create', term.trim())"
    >
      <span class="picker-check"><Plus :size="13" /></span>
      <span class="picker-name">Create “{{ term.trim() }}”</span>
      <span class="picker-next">
        <TagDot :color="nextColor" size="heading" />
        <span class="next-label">next free colour</span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * Assigning tags to one entity, and creating them while you are there.
 *
 * Create-on-enter is the point: a tag vocabulary that has to be built in a
 * settings screen first is a vocabulary nobody builds. Typing a name that does
 * not exist offers to make it — in the current library, with the next free
 * palette colour — and applies it in the same gesture.
 *
 * Names fold for the match the way the server folds them for uniqueness, so
 * typing `geo` when `Geo` exists offers the existing tag rather than a
 * create row the server would reject as a clash.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { Check, Plus, Search, Tags } from '@lucide/vue';
import type { Tag } from '@sparql-query-lib/contracts';
import InlineNote from '../shared/InlineNote.vue';
import TagDot from './TagDot.vue';

const props = withDefaults(defineProps<{
  tags: Tag[];
  /** Tag ids the entity currently carries. */
  selected: string[];
  entityName: string;
  /** Library-wide usage counts, keyed by tag id. */
  counts?: Record<string, number>;
  /** The colour a tag created right now would take. */
  nextColor: string;
}>(), { counts: () => ({}) });

const emit = defineEmits<{
  (e: 'toggle', tagId: string): void;
  (e: 'create', name: string): void;
  (e: 'close'): void;
}>();

const term = ref('');
const searchInput = ref<HTMLInputElement | null>(null);

onMounted(() => {
  void nextTick(() => searchInput.value?.focus());
});

const fold = (value: string) => value.trim().toLowerCase();

const matching = computed(() => {
  const needle = fold(term.value);
  return props.tags
    .filter((tag) => !needle || fold(tag.name).includes(needle))
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color ?? null,
      on: props.selected.includes(tag.id),
      count: props.counts[tag.id] ?? 0,
    }));
});

/** Nothing to create when the name is empty or already taken, case aside. */
const canCreate = computed(() => {
  const needle = fold(term.value);
  return needle.length > 0 && !props.tags.some((tag) => fold(tag.name) === needle);
});

/**
 * Enter means the obvious thing: create when the name is new, otherwise toggle
 * the one tag the term names. With several matches it does nothing — picking
 * between them is what the list is for.
 */
function commitEnter() {
  if (canCreate.value) {
    emit('create', term.value.trim());
    term.value = '';
    return;
  }
  const exact = props.tags.find((tag) => fold(tag.name) === fold(term.value));
  if (exact) {
    emit('toggle', exact.id);
    term.value = '';
    return;
  }
  if (matching.value.length === 1) emit('toggle', matching.value[0].id);
}
</script>

<style scoped>
.tag-picker {
  display: flex;
  width: 260px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-md);
}

.picker-head {
  display: flex;
  height: 30px;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.picker-icon {
  color: var(--ink-muted);
}

.picker-title {
  overflow: hidden;
  color: var(--ink);
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-search {
  display: flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  margin: var(--space-4) var(--space-4) var(--space-2);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
}

.search-input {
  min-width: 0;
  flex: 1;
  border: none;
  background: none;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
  outline: none;
}

.picker-list {
  display: flex;
  max-height: 220px;
  flex-direction: column;
  padding: 0 var(--space-3) var(--space-2);
  overflow-y: auto;
}

.picker-row,
.picker-create {
  display: flex;
  height: 26px;
  align-items: center;
  gap: 8px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  text-align: left;
  cursor: pointer;
}

.picker-row:hover,
.picker-create:hover {
  background: var(--surface-raised);
}

.picker-row.on {
  background: var(--surface-sunken);
}

.picker-check {
  display: inline-flex;
  width: 14px;
  justify-content: center;
  color: var(--action);
}

.picker-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-count {
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.picker-create {
  height: 28px;
  margin: 0 var(--space-3) var(--space-3);
  border-top: 1px solid var(--border-subtle);
  border-radius: 0;
  padding-top: var(--space-1);
}

.picker-next {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.next-label {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

/* Inset to the menu it stands in, which is the menu's fact. */
.picker-empty {
  margin: var(--space-2) var(--space-3) var(--space-4);
}
</style>
