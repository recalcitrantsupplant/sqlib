<template>
  <section class="graph-picker" data-testid="graph-dataset-picker">
    <header class="picker-header">
      <h3 class="picker-title">Graphs</h3>
      <InlineNote as="span">{{ summary }}</InlineNote>
    </header>

    <InlineNote v-if="isUpdate">An update names its graphs in its text. This choice applies to queries only.</InlineNote>

    <template v-else>
      <div class="row" role="radiogroup" aria-label="Graphs to read">
        <label class="check">
          <input v-model="dataset.restricted.value" type="radio" :value="false" />
          All graphs
        </label>
        <label class="check">
          <input v-model="dataset.restricted.value" type="radio" :value="true" data-testid="graph-restrict" />
          Only these graphs
        </label>
      </div>

      <template v-if="dataset.restricted.value">
        <label class="field">
          <span class="label">Apply to</span>
          <select v-model="dataset.applyTo.value" data-testid="graph-apply-to">
            <option value="both">Default and named graphs</option>
            <option value="default">Default graph only</option>
            <option value="named">Named graphs only</option>
            <option value="separate">Separate lists</option>
          </select>
        </label>

        <div class="row">
          <button type="button" class="btn-compact" :disabled="!backendId || loading" data-testid="graph-load" @click="loadGraphs">
            {{ loading ? 'Loading…' : available.length ? 'Reload graphs' : 'Load graphs' }}
          </button>
          <input
            v-if="available.length"
            v-model="filter"
            class="filter"
            type="search"
            placeholder="Filter graphs"
            aria-label="Filter graphs"
          />
          <button type="button" class="btn-compact" @click="clearSelection">Clear</button>
        </div>
        <p v-if="loadError" class="error">{{ loadError }}</p>
        <InlineNote v-if="truncated">The backend has more than {{ GRAPH_LIST_LIMIT }} graphs. Paste the others below.</InlineNote>

        <table v-if="visibleGraphs.length" class="graphs">
          <thead>
            <tr>
              <th>Graph</th>
              <template v-if="separate">
                <th>Default</th>
                <th>Named</th>
              </template>
              <th v-else>Read</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="graph in visibleGraphs" :key="graph">
              <td class="iri"><code>{{ graph }}</code></td>
              <template v-if="separate">
                <td class="cell"><input type="checkbox" :aria-label="`${graph} as a default graph`" :checked="dataset.defaultGraphs.value.includes(graph)" @change="toggle(dataset.defaultGraphs, graph)" /></td>
                <td class="cell"><input type="checkbox" :aria-label="`${graph} as a named graph`" :checked="dataset.namedGraphs.value.includes(graph)" @change="toggle(dataset.namedGraphs, graph)" /></td>
              </template>
              <td v-else class="cell"><input type="checkbox" :aria-label="`Read ${graph}`" :checked="dataset.graphs.value.includes(graph)" @change="toggle(dataset.graphs, graph)" /></td>
            </tr>
          </tbody>
        </table>

        <label class="field">
          <span class="label">Paste graph IRIs</span>
          <textarea v-model="pasted" rows="2" placeholder="One IRI per line" data-testid="graph-paste" />
        </label>
        <div class="row">
          <button type="button" class="btn-compact" :disabled="!pasted.trim()" @click="addPasted">Add</button>
        </div>

        <p v-if="selectedNothing" class="warning" data-testid="graph-empty-warning">
          No graphs selected. The query will match nothing.
        </p>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
/**
 * The graphs a query reads, as a run-time choice instead of `FROM` clauses.
 *
 * The list of graphs is loaded on demand, from the backend the run targets.
 * Under a graph policy that list is already narrowed to what the caller may
 * read, so the picker never offers a graph the run would drop.
 */
import { computed, ref, type Ref } from 'vue';
import { useApiClient } from '@/composables/useApiClient';
import InlineNote from '@/components/shared/InlineNote.vue';
import {
  GRAPH_LIST_LIMIT,
  LIST_GRAPHS_QUERY,
  datasetSummary,
  parseGraphIris,
  type GraphDatasetComposable,
} from '@/lib/graphDataset';

const props = defineProps<{
  dataset: GraphDatasetComposable;
  backendId: string | null;
  isUpdate?: boolean;
}>();

const api = useApiClient();

const available = ref<string[]>([]);
const truncated = ref(false);
const loading = ref(false);
const loadError = ref<string | null>(null);
const filter = ref('');
const pasted = ref('');

const separate = computed(() => props.dataset.applyTo.value === 'separate');
const summary = computed(() => (props.isUpdate ? '' : `reads ${datasetSummary(props.dataset.payload())}`));

/** Loaded graphs, plus any chosen ones the list does not hold, so a pasted IRI stays visible. */
const visibleGraphs = computed(() => {
  const chosen = [...props.dataset.graphs.value, ...props.dataset.defaultGraphs.value, ...props.dataset.namedGraphs.value];
  const all = [...new Set([...chosen, ...available.value])];
  const needle = filter.value.trim().toLowerCase();
  return needle ? all.filter((graph) => graph.toLowerCase().includes(needle)) : all;
});

const selectedNothing = computed(() => {
  const dataset = props.dataset.payload();
  return dataset !== null && datasetSummary(dataset) === 'none';
});

function toggle(list: Ref<string[]>, graph: string) {
  list.value = list.value.includes(graph) ? list.value.filter((g) => g !== graph) : [...list.value, graph];
}

function clearSelection() {
  props.dataset.graphs.value = [];
  props.dataset.defaultGraphs.value = [];
  props.dataset.namedGraphs.value = [];
}

function addPasted() {
  const iris = parseGraphIris(pasted.value);
  if (separate.value) {
    props.dataset.defaultGraphs.value = [...new Set([...props.dataset.defaultGraphs.value, ...iris])];
    props.dataset.namedGraphs.value = [...new Set([...props.dataset.namedGraphs.value, ...iris])];
  } else {
    props.dataset.graphs.value = [...new Set([...props.dataset.graphs.value, ...iris])];
  }
  pasted.value = '';
}

async function loadGraphs() {
  if (!props.backendId) return;
  loading.value = true;
  loadError.value = null;
  try {
    const response = await api.runSparql({ query: LIST_GRAPHS_QUERY, backendId: props.backendId });
    const bindings = (response as { results?: { bindings?: Array<Record<string, { value: string }>> } }).results?.bindings ?? [];
    const graphs = bindings.map((row) => row.g?.value).filter((g): g is string => typeof g === 'string');
    truncated.value = graphs.length > GRAPH_LIST_LIMIT;
    available.value = graphs.slice(0, GRAPH_LIST_LIMIT).sort();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.graph-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

.picker-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.picker-title {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.label {
  color: var(--ink-secondary);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

.check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink);
  font-size: var(--text-body);
}

select,
.filter,
textarea {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
}

textarea {
  font-family: var(--font-mono);
  font-size: var(--text-label);
  resize: vertical;
}

.graphs {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-label);
}

.graphs th,
.graphs td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--ink);
  text-align: left;
}

.graphs th {
  color: var(--ink-muted);
  font-weight: var(--weight-medium);
}

.iri {
  overflow-wrap: anywhere;
}

.cell {
  width: 4rem;
  text-align: center;
}

.warning {
  margin: 0;
  color: var(--warning-ink);
  font-size: var(--text-body);
}

.error {
  margin: 0;
  color: var(--danger-ink);
  font-size: var(--text-body);
}
</style>
