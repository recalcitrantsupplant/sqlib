<template>
  <div class="sources-editor" data-testid="memory-sources-editor">
    <InlineNote v-if="graphsError" tone="danger">{{ graphsError }}</InlineNote>
    <InlineNote v-else-if="!loading && dataGraphs.length === 0 && rows.length === 0">
      No data graphs in the library yet. Create one under Data, or start the store unseeded.
    </InlineNote>

    <div v-for="row in rows" :key="row.key" class="source-row" data-testid="memory-source-row">
      <div class="source-line">
        <!--
          Typed at rather than scrolled: a library's data graphs are many and
          hand-named, and a store is seeded by naming them one row at a time.
        -->
        <SearchSelect
          class="source-select--graph"
          test-id="source-graph-select"
          aria-label="Data graph"
          placeholder="Choose a data graph…"
          :disabled="disabled"
          :model-value="row.graphId || null"
          :options="graphOptionsFor(row)"
          @update:model-value="(value) => { row.graphId = value; onGraphChange(row); }"
        />

        <SegmentedToggle
          :model-value="row.pin"
          :options="PIN_OPTIONS"
          group-label="Version to load"
          :disabled="disabled"
          @update:model-value="(value) => onPinChange(row, value as 'head' | 'version')"
        />

        <select
          v-if="row.pin === 'version'"
          v-model="row.versionId"
          class="source-select source-select--version"
          :disabled="disabled || !row.graphId"
          aria-label="Pinned version"
          data-testid="source-version-select"
          @change="emitChange"
        >
          <option value="" disabled>Version…</option>
          <option v-for="version in versionsOf(row.graphId)" :key="version.id" :value="version.id">
            v{{ version.version }}{{ version.comment ? ` — ${version.comment}` : '' }}
          </option>
          <option v-if="row.versionId && !knownVersion(row)" :value="row.versionId">{{ row.versionId }}</option>
        </select>

        <button
          v-if="!disabled"
          class="remove-button"
          type="button"
          title="Remove this source"
          aria-label="Remove this source"
          data-testid="source-remove"
          @click="removeRow(row)"
        >
          <X :size="12" />
        </button>
      </div>

      <input
        v-model="row.namedGraph"
        type="text"
        class="named-graph-input"
        :disabled="disabled"
        placeholder="Named graph IRI (optional — default graph if empty)"
        aria-label="Named graph"
        data-testid="source-named-graph"
        @change="emitChange"
      />
    </div>

    <button
      v-if="!disabled"
      class="add-source-button"
      type="button"
      data-testid="add-memory-source"
      @click="addRow"
    >
      <Plus :size="12" />Add a data graph
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Plus, X } from '@lucide/vue';
import InlineNote from '../shared/InlineNote.vue';
import SearchSelect from '../shared/SearchSelect.vue';
import SegmentedToggle from '../shared/SegmentedToggle.vue';
import { useDataGraphsStore } from '../../composables/useDataGraphsStore';
import type { MemoryStoreSource } from '../../lib/memoryBackendConfig';

/**
 * The data graphs an in-memory store is hydrated from.
 *
 * Each row is one source, and the head/pin toggle is the whole sync decision:
 * a tracked graph reloads the store whenever a new version is saved, a pinned
 * version never changes. The editor holds incomplete rows locally and reports
 * `complete` with every change, so the owner decides when a state is worth
 * saving — the draft form waits for Create, the saved record commits any
 * complete change as it happens.
 */
const props = withDefaults(
  defineProps<{
    /** The saved sources, in wire shape. */
    sources: MemoryStoreSource[];
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  (e: 'change', payload: { sources: MemoryStoreSource[]; complete: boolean }): void;
}>();

const PIN_OPTIONS = [
  { value: 'head', label: 'Track latest', title: 'Follow the graph — the store reloads when a new version is saved' },
  { value: 'version', label: 'Pin version', title: 'Load one immutable version, forever' },
] as const;

interface SourceRow {
  key: number;
  graphId: string;
  pin: 'head' | 'version';
  versionId: string;
  namedGraph: string;
}

const store = useDataGraphsStore();
const dataGraphs = store.dataGraphs;
const loading = store.loading;
const graphsError = ref<string | null>(null);

const rows = ref<SourceRow[]>([]);
let nextKey = 1;

void store.loadDataGraphs().then(() => {
  graphsError.value = store.error.value;
  void resolvePinnedGraphs();
});

function knownGraph(graphId: string): boolean {
  return dataGraphs.value.some((graph) => graph.id === graphId);
}

function versionsOf(graphId: string) {
  return graphId ? store.versionsFor(graphId).value : [];
}

function knownVersion(row: SourceRow): boolean {
  return versionsOf(row.graphId).some((version) => version.id === row.versionId);
}

function toWireSources(current: SourceRow[]): MemoryStoreSource[] {
  const sources: MemoryStoreSource[] = [];
  for (const row of current) {
    const namedGraph = row.namedGraph.trim();
    if (row.pin === 'head' && row.graphId) {
      sources.push({ dataGraphId: row.graphId, ...(namedGraph ? { namedGraph } : {}) });
    } else if (row.pin === 'version' && row.versionId) {
      sources.push({ dataGraphVersionId: row.versionId, ...(namedGraph ? { namedGraph } : {}) });
    }
  }
  return sources;
}

const complete = computed(() =>
  rows.value.every((row) => (row.pin === 'head' ? row.graphId.length > 0 : row.versionId.length > 0)),
);

function emitChange() {
  emit('change', { sources: toWireSources(rows.value), complete: complete.value });
}

function rowsFromSources(sources: MemoryStoreSource[]): SourceRow[] {
  return sources.map((source) => ({
    key: nextKey++,
    graphId: source.dataGraphId ?? '',
    pin: source.dataGraphVersionId ? 'version' : 'head',
    versionId: source.dataGraphVersionId ?? '',
    namedGraph: source.namedGraph ?? '',
  }));
}

/*
 * Re-seed from the prop only when it says something the rows do not already:
 * a commit round-trips through the parent and arrives back here as the same
 * sources, and rebuilding then would wipe an in-progress incomplete row.
 */
watch(
  () => props.sources,
  (sources) => {
    const incoming = JSON.stringify(sources);
    const current = JSON.stringify(toWireSources(rows.value.filter((row) =>
      row.pin === 'head' ? row.graphId : row.versionId,
    )));
    if (incoming === current && rows.value.length > 0) return;
    if (incoming === '[]' && rows.value.length > 0 && toWireSources(rows.value).length === 0) return;
    rows.value = rowsFromSources(sources);
    void resolvePinnedGraphs();
  },
  { immediate: true, deep: true },
);

/**
 * A pinned source stores only the version id, but the row wants to show which
 * graph it belongs to. Version listings carry `isPartOf`, so scan the (few,
 * small) graphs' version lists until the id turns up.
 */
async function resolvePinnedGraphs() {
  const unresolved = rows.value.filter((row) => row.pin === 'version' && row.versionId && !row.graphId);
  if (unresolved.length === 0) return;
  for (const graph of dataGraphs.value) {
    const pending = rows.value.filter((row) => row.pin === 'version' && row.versionId && !row.graphId);
    if (pending.length === 0) return;
    try {
      const versions = store.versionsFor(graph.id).value.length > 0
        ? store.versionsFor(graph.id).value
        : await store.loadVersions(graph.id);
      for (const row of pending) {
        if (versions.some((version) => version.id === row.versionId)) {
          row.graphId = graph.id;
        }
      }
    } catch {
      // A graph whose versions cannot be listed just stays unresolved.
    }
  }
}

async function ensureVersionsLoaded(graphId: string) {
  if (!graphId || store.versionsFor(graphId).value.length > 0) return;
  try {
    await store.loadVersions(graphId);
  } catch {
    // The select falls back to showing the raw id.
  }
}

/*
 * A source can name a graph the list no longer has (deleted, or not yet
 * loaded); the row keeps it, showing the raw id, rather than silently blanking.
 */
function graphOptionsFor(row: SourceRow) {
  const options = dataGraphs.value.map((graph) => ({ value: graph.id, label: graph.name }));
  if (row.graphId && !knownGraph(row.graphId)) options.push({ value: row.graphId, label: row.graphId });
  return options;
}

function onGraphChange(row: SourceRow) {
  row.versionId = '';
  if (row.pin === 'version') void ensureVersionsLoaded(row.graphId);
  emitChange();
}

function onPinChange(row: SourceRow, pin: 'head' | 'version') {
  if (row.pin === pin) return;
  row.pin = pin;
  if (pin === 'version') {
    void ensureVersionsLoaded(row.graphId);
  } else {
    row.versionId = '';
  }
  emitChange();
}

function addRow() {
  rows.value.push({ key: nextKey++, graphId: '', pin: 'head', versionId: '', namedGraph: '' });
  emitChange();
}

function removeRow(row: SourceRow) {
  rows.value = rows.value.filter((candidate) => candidate.key !== row.key);
  emitChange();
}
</script>

<style scoped>
.sources-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}


.source-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-subtle);
}

.source-line {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.source-select {
  box-sizing: border-box;
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
}

.source-select:focus {
  outline: none;
  border-color: var(--action);
}

/* The chooser paints its own box (see `SearchSelect`); this only places it. */
.source-select--graph {
  flex: 1;
  min-width: 160px;
}

.source-select--version {
  flex: 1;
  min-width: 120px;
}

.remove-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.remove-button:hover {
  color: var(--danger);
}

.named-graph-input {
  box-sizing: border-box;
  width: 100%;
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.named-graph-input:focus {
  outline: none;
  border-color: var(--action);
}

.named-graph-input::placeholder {
  font-family: inherit;
}

.add-source-button {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: 26px;
  padding: 0 var(--space-5);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-body);
  cursor: pointer;
}

.add-source-button:hover {
  border-color: var(--action);
  color: var(--action);
}
</style>
