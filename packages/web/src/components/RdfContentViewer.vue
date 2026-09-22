<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import MediaTypeCodeViewer from '@/components/MediaTypeCodeViewer.vue';
import RdfTermTable from '@/components/shared/RdfTermTable.vue';
import type { RdfTermTableColumn } from '@/components/shared/RdfTermTable.vue';
import type { DataTableState } from '@/composables/useDataTable';
import {
  parseNTriples,
  isNTriplesContentType,
  type RdfRow,
} from '@/lib/ntriples-nquads-table-converter';

const props = withDefaults(
  defineProps<{
    content: string;
    contentType: string;
    title?: string;
    showMetadata?: boolean;
    hideToolbar?: boolean;
    loading?: boolean;
    error?: string | null;
    /**
     * Drop the nested Table / Raw pair. A caller whose own view set already
     * names this view — the rule set panel's Graph — would otherwise stack two
     * levels of view switching, which is the thing that promotion removed.
     */
    hideViewTabs?: boolean;
    /** Let a caller host the filter, the row count and paging — see DataTable. */
    hideFilterRow?: boolean;
    hideRowCount?: boolean;
  }>(),
  {
    title: undefined,
    showMetadata: true,
    hideToolbar: false,
    loading: false,
    error: null,
    hideViewTabs: false,
    hideFilterRow: false,
    hideRowCount: false,
  },
);

const emit = defineEmits<{ state: [DataTableState] }>();

/** The filter, bindable from outside for a caller that hosts the input. */
const globalFilter = defineModel<string | undefined>('globalFilter', { default: undefined });

const tableRef = ref<{
  setPageIndex: (index: number) => void;
  setPageSize: (size: number) => void;
} | null>(null);

defineExpose({
  setPageIndex: (index: number) => tableRef.value?.setPageIndex(index),
  setPageSize: (size: number) => tableRef.value?.setPageSize(size),
});

// Determine if this format supports table view (only N-Triples for now)
const isTabularFormat = computed(() => isNTriplesContentType(props.contentType));

const hasContent = computed(() => !!(props.content && props.content.length > 0));

const activeTab = ref<'table' | 'raw'>('table');

// Auto-switch to appropriate tab based on format
watch(
  [isTabularFormat, hasContent],
  ([tabular, hasData]) => {
    if (tabular && hasData) {
      activeTab.value = 'table';
    } else if (hasData) {
      activeTab.value = 'raw';
    }
  },
  { immediate: true },
);

// Parse N-Triples if applicable
const tabularRows = computed<RdfRow[]>(() => {
  if (!isTabularFormat.value || !props.content) {
    return [];
  }

  return parseNTriples(props.content);
});

const rowCount = computed(() => tabularRows.value.length);

// Define table columns for N-Triples (s, p, o)
const columns = computed<RdfTermTableColumn[]>(() => {
  if (!isTabularFormat.value) {
    return [];
  }

  return [
    { key: 's', label: 's', filterable: true },
    { key: 'p', label: 'p', filterable: true },
    { key: 'o', label: 'o', filterable: true },
  ];
});

const normalizedContentType = computed(() => {
  if (!props.contentType) {
    return null;
  }
  const [type] = props.contentType.split(';');
  return type.trim().toLowerCase();
});
</script>

<template>
  <div class="rdf-content-viewer" :class="{ 'viewer--minimal': hideToolbar }">
    <!-- Toolbar -->
    <div v-if="!hideToolbar" class="viewer-toolbar">
      <div v-if="isTabularFormat" class="tabs-list" role="tablist" aria-label="RDF content display mode">
        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === 'table'"
          class="tab-button"
          :class="{ active: activeTab === 'table' }"
          :disabled="!hasContent"
          @click="activeTab = 'table'"
        >
          Table
        </button>

        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === 'raw'"
          class="tab-button"
          :class="{ active: activeTab === 'raw' }"
          :disabled="!hasContent"
          @click="activeTab = 'raw'"
        >
          Raw
        </button>
      </div>
      <div v-else class="tabs-list">
        <div class="tab-label">{{ title || 'RDF Content' }}</div>
      </div>
      <div v-if="showMetadata" class="viewer-metadata">
        <span v-if="activeTab === 'table' && isTabularFormat" class="metadata-text">
          {{ rowCount }} {{ rowCount === 1 ? 'triple' : 'triples' }}
        </span>
        <span v-if="normalizedContentType" class="metadata-text">
          {{ normalizedContentType }}
        </span>
      </div>
    </div>

    <!-- Minimal inline tabs when toolbar is hidden but format is tabular -->
    <div v-if="hideToolbar && !hideViewTabs && isTabularFormat && hasContent" class="minimal-tabs">
      <button
        type="button"
        class="minimal-tab"
        :class="{ active: activeTab === 'table' }"
        @click="activeTab = 'table'"
      >
        Table
      </button>
      <button
        type="button"
        class="minimal-tab"
        :class="{ active: activeTab === 'raw' }"
        @click="activeTab = 'raw'"
      >
        Raw
      </button>
    </div>

    <!-- Content -->
    <div class="viewer-body">
      <div
        v-if="loading"
        class="viewer-message"
      >
        Loading RDF content…
      </div>
      <div
        v-else-if="error"
        class="viewer-message error"
        role="alert"
      >
        {{ error }}
      </div>
      <div v-else-if="!hasContent" class="viewer-message">
        No RDF content available
      </div>
      <div v-else>
        <!-- Table view for N-Triples -->
        <div v-if="activeTab === 'table' && isTabularFormat">
          <RdfTermTable
            ref="tableRef"
            v-model:global-filter="globalFilter"
            :columns="columns"
            :data="tabularRows"
            filter-placeholder="Search triples…"
            empty-text="No triples found in content."
            :enable-filters="true"
            :hide-filter-row="hideFilterRow"
            :hide-row-count="hideRowCount"
            @state="emit('state', $event)"
          />
        </div>
        <!-- Raw view for all formats -->
        <div v-else-if="activeTab === 'raw' || !isTabularFormat">
          <MediaTypeCodeViewer
            :content="content"
            :content-type="contentType"
            min-height="360px"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rdf-content-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.viewer-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-4) var(--space-6) 0 var(--space-6);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.tabs-list {
  display: flex;
  gap: 4px;
}

.tab-label {
  padding: var(--space-4) var(--space-6);
  font-size: var(--text-body-lg);
  font-weight: 600;
  color: var(--ink-secondary);
}

.tab-button {
  padding: var(--space-4) var(--space-6);
  font-size: var(--text-body-lg);
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  position: relative;
  top: 1px;
}

.tab-button:hover:not(:disabled) {
  color: var(--ink-secondary);
  background: rgba(0, 0, 0, 0.03);
}

.tab-button.active {
  color: var(--action);
  border-bottom-color: var(--action);
  background: var(--surface);
}

.tab-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.viewer-metadata {
  display: flex;
  align-items: center;
  gap: 8px;
}

.metadata-text {
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink-muted);
  padding: var(--space-2) var(--space-4);
  background: var(--surface-raised);
  border-radius: var(--radius);
}

.viewer-body {
  flex: 1;
  padding: var(--space-6);
  background: var(--surface);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.viewer--minimal .viewer-body {
  padding: 0;
  background: transparent;
}

.minimal-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: var(--space-5);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.minimal-tab {
  padding: var(--space-2) var(--space-5);
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink-muted);
  background: transparent;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.15s;
}

.minimal-tab:hover {
  color: var(--ink-secondary);
  background: var(--surface-subtle);
}

.minimal-tab.active {
  color: var(--action);
  background: var(--action-surface);
}

.viewer-message {
  padding: var(--space-8);
  text-align: center;
  font-size: var(--text-content);
  color: var(--ink-muted);
}

.viewer-message.error {
  color: var(--danger-ink);
}

/* Dark rules hang off the .dark class the theme switch sets, not the OS
   preference: a preference pinned in Settings against the OS otherwise
   left this block applying in light mode, or not applying in dark. */
.dark .viewer-toolbar {
  background: var(--gray-800);
  border-bottom-color: var(--border-hover);
}

.dark .tab-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.dark .tab-button.active {
  color: var(--action);
  border-bottom-color: var(--action-border);
  background: var(--gray-900);
}

.dark .viewer-body {
  background: var(--gray-900);
}

.dark .viewer-message.error {
  color: var(--danger);
}
</style>
