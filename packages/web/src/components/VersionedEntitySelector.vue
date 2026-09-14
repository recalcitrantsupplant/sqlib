<template>
  <section class="entity-selector">
    <SectionLabel as="h3">{{ title }}</SectionLabel>
    <FilterBox v-model="filterText" class="filter-input" :placeholder="filterPlaceholder" />

    <div class="items-container" :class="{ 'fill-height': fillHeight }">
      <div v-if="loading" class="loading-state">
        {{ loadingMessage }}
      </div>
      <div v-else-if="error" class="error-state">
        {{ error }}
      </div>
      <div v-else-if="filteredItems.length === 0" class="selector-empty">
        {{ computedEmptyMessage }}
      </div>
      <div v-else class="items-list">
        <div
          v-for="{ item, segments } in filteredItems"
          :key="item.id"
          class="item-row"
          :class="{ 'item-checked': item.isChecked, 'item-single-select': selectionMode === 'single' }"
          @click="selectionMode === 'single' ? handleSingleSelect(item) : undefined"
        >
          <label class="item-label">
            <input
              v-if="selectionMode === 'multiple'"
              type="checkbox"
              v-model="item.isChecked"
              class="item-checkbox"
              @change="emitSelection"
            />
            <input
              v-else
              type="radio"
              :checked="item.isChecked"
              :name="radioGroupName"
              class="item-checkbox"
              @change="handleSingleSelect(item)"
            />
            <div class="item-info">
              <div class="item-name">
                <template v-for="(segment, index) in segments" :key="index">
                  <mark v-if="segment.matched" class="item-name-hit">{{ segment.text }}</mark>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </div>
              <div v-if="item.description" class="item-description">
                {{ item.description }}
              </div>
            </div>
            <div class="version-selector">
              <template v-if="item.versions.length === 0">
                <span class="version-static version-unavailable">No versions</span>
              </template>
              <template v-else-if="item.versions.length === 1">
                <span class="version-static">Version {{ item.versions[0].version }}</span>
              </template>
              <template v-else>
                <SectionLabel as="span">Version</SectionLabel>
                <Select
                  :model-value="item.selectedVersionId ?? undefined"
                  :disabled="!item.isChecked"
                  @update:model-value="(value) => { item.selectedVersionId = (value as string | null) ?? null }"
                >
                  <SelectTrigger class="version-trigger" @click.stop>
                    <SelectValue>
                      {{ getVersionNumber(item) }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="version in item.versions"
                      :key="version.id"
                      :value="version.id"
                    >
                      {{ version.version }}{{ version.isCurrent ? ' (Current Version)' : '' }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <span v-if="!isLatestVersion(item)" class="version-warning-wrapper" title="Newer version available">
                  <Info :size="16" class="version-warning" />
                </span>
              </template>
            </div>
          </label>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Info } from '@lucide/vue';
import { fuzzyFilter } from '../lib/fuzzy';
import FilterBox from './shared/FilterBox.vue';
import SectionLabel from './shared/SectionLabel.vue';
import Select from './ui/select/Select.vue';
import SelectContent from './ui/select/SelectContent.vue';
import SelectItem from './ui/select/SelectItem.vue';
import SelectTrigger from './ui/select/SelectTrigger.vue';
import SelectValue from './ui/select/SelectValue.vue';

export interface EntityVersion {
  id: string;
  version: number;
  isCurrent: boolean;
}

export interface VersionedEntity {
  id: string;
  name: string;
  description?: string;
  versions: EntityVersion[];
  selectedVersionId: string | null;
  isChecked: boolean;
}

interface Props {
  items: VersionedEntity[];
  loading?: boolean;
  error?: string;
  title: string;
  emptyMessage?: string;
  emptyFilterMessage?: string;
  filterPlaceholder?: string;
  loadingMessage?: string;
  selectionMode?: 'single' | 'multiple';
  radioGroupName?: string;
  fillHeight?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  error: '',
  emptyMessage: 'No items available',
  emptyFilterMessage: 'No items match the filter',
  filterPlaceholder: 'Filter items...',
  loadingMessage: 'Loading...',
  selectionMode: 'multiple',
  radioGroupName: 'entity-selector',
  fillHeight: false,
});

const emit = defineEmits<{
  'update:selection': [items: VersionedEntity[]];
}>();

const filterText = ref('');

/*
 * Fuzzy on the name, ranked best-first, with the matched characters marked —
 * the same rule the chooser dropdowns follow (`lib/fuzzy`), because this list
 * is the same job in a bigger box: a library's queries are many and named by
 * hand, and "qgrp" should find "query-group smoke".
 *
 * The description stays a plain substring test, ORed in. A subsequence spread
 * across a paragraph matches almost anything, so fuzzy there would return the
 * whole library for two letters; a description that literally contains what
 * you typed is still worth a row.
 */
const filteredItems = computed(() => {
  const filter = filterText.value.trim();
  if (!filter) {
    return props.items.map(item => ({ item, segments: [{ text: item.name, matched: false }] }));
  }
  const ranked = fuzzyFilter(filter, props.items, item => item.name);
  const matchedIds = new Set(ranked.map(({ item }) => item.id));
  // Whatever the name missed but the description holds literally, unranked and
  // last — the same name-fuzzy / detail-substring split `fuzzyMatches` makes.
  const needle = filter.toLowerCase();
  const byDescription = props.items
    .filter(item => !matchedIds.has(item.id) && (item.description ?? '').toLowerCase().includes(needle))
    .map(item => ({ item, segments: [{ text: item.name, matched: false }] }));
  return [...ranked, ...byDescription];
});

const computedEmptyMessage = computed(() => {
  if (props.items.length > 0 && filteredItems.value.length === 0 && filterText.value) {
    return props.emptyFilterMessage;
  }
  return props.emptyMessage;
});

function getVersionNumber(item: VersionedEntity): string {
  if (!item.selectedVersionId) {
    return 'Select';
  }
  const version = item.versions.find(v => v.id === item.selectedVersionId);
  return version ? String(version.version) : 'Select';
}

function isLatestVersion(item: VersionedEntity): boolean {
  if (!item.selectedVersionId || item.versions.length === 0) {
    return true;
  }
  const currentVersion = item.versions.find(v => v.isCurrent);
  return currentVersion?.id === item.selectedVersionId;
}

function handleSingleSelect(item: VersionedEntity) {
  // Uncheck all others
  props.items.forEach(i => {
    i.isChecked = i.id === item.id;
  });
  // If no version selected, select the current version
  if (!item.selectedVersionId && item.versions.length > 0) {
    const currentVersion = item.versions.find(v => v.isCurrent);
    item.selectedVersionId = currentVersion?.id || item.versions[0].id;
  }
  emitSelection();
}

function emitSelection() {
  const selected = props.items.filter(item => item.isChecked);
  emit('update:selection', selected);
}
</script>

<style scoped>
.entity-selector {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* The dialog's box is taller than the shared default: it is the first thing
   in a full-size dialog, not a strip over a small panel. */
.filter-input {
  height: var(--control-h);
  font-size: var(--text-body-lg);
}

.items-container {
  flex: 1;
  min-height: 200px;
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
}

.items-container.fill-height {
  max-height: none;
  min-height: 0;
}

/*
 * One well, three states. The rule is shared because the well is: loading,
 * error and empty each fill the same 200px the list would have, so the
 * container does not resize as the request settles. The primitive states type
 * and padding but not that well, so converting one of the three would describe
 * it in two places and let the other two drift out of it.
 */
.loading-state,
.error-state,
.selector-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--ink-muted);
  font-size: var(--text-body-lg);
}

.error-state {
  color: var(--danger);
}

.items-list {
  display: flex;
  flex-direction: column;
}

.item-row {
  border-bottom: 1px solid var(--border-subtle);
  transition: background-color 0.15s;
}

.item-row:last-child {
  border-bottom: none;
}

.item-row:hover {
  background: var(--surface-subtle);
}

.item-row.item-checked {
  background: var(--action-surface);
}

.item-row.item-single-select {
  cursor: pointer;
}

.item-label {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: var(--space-5) var(--space-6);
  cursor: pointer;
  width: 100%;
}

.item-name-hit {
  background: none;
  color: var(--action);
  font-weight: var(--weight-semibold);
}

.item-checkbox {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.item-info {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: var(--text-content);
  font-weight: 500;
  color: var(--ink);
  margin-bottom: var(--space-1);
}

.item-description {
  font-size: var(--text-body);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.version-static {
  font-size: var(--text-body);
  color: var(--ink-secondary);
  padding: var(--space-2) var(--space-4);
  background: var(--surface-subtle);
  border-radius: var(--radius-sm);
}

.version-static.version-unavailable {
  color: var(--ink-muted);
  background: var(--surface-sunken);
  font-style: italic;
}

.version-trigger {
  width: 80px;
  height: 32px;
  font-size: var(--text-body);
}

.version-warning-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
}

.version-warning {
  color: var(--warning);
}
</style>
