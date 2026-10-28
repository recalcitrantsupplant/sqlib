<template>
  <span class="clause" data-testid="run-bar-reading">
    <span class="joiner">reading</span>
    <button v-if="isUpdate" type="button" class="reading inert" disabled title="An update names its graphs in its text">
      graphs in text
    </button>
    <PopoverRoot v-else v-model:open="open">
      <PopoverTrigger as-child>
        <button
          type="button"
          :class="['reading', { active: dataset.restricted.value, danger: matchesNothing }]"
          :title="clauseTitle"
          data-testid="run-bar-graphs"
        >
          {{ clauseLabel }}<ChevronDown :size="11" class="chevron" />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent align="start" :side-offset="4" :style="{ zIndex: 50 }" @open-auto-focus.prevent>
          <div class="pop" role="dialog" aria-label="Graphs this query reads" data-testid="graph-dataset-picker">
            <div v-if="showEmptyAsk" class="ask" data-testid="graph-empty-ask">
              <span class="ask-text">No graphs chosen. The run will match nothing.</span>
              <button type="button" class="btn-compact" @click="dataset.restricted.value = false; emit('dismiss-empty')">Read all</button>
              <button type="button" class="btn-compact btn-primary" @click="runAnyway">Run anyway</button>
            </div>
            <div class="pop-head">
              <div class="title-row">
                <h3 class="pop-title">Graphs this query reads</h3>
                <InlineNote as="span" size="xs">instead of FROM</InlineNote>
              </div>
              <span class="which">
                <SegmentedToggle
                  :model-value="dataset.restricted.value ? 'choose' : 'all'"
                  :options="whichOptions"
                  group-label="Which graphs"
                  size="default"
                  @update:model-value="(value) => (dataset.restricted.value = value === 'choose')"
                />
              </span>
              <div v-if="dataset.restricted.value" class="tools">
                <FilterBox v-model="filter" placeholder="Filter graphs" />
                <label class="switch-row">
                  <input type="checkbox" :checked="separate" data-testid="graph-split" @change="setSplit(($event.target as HTMLInputElement).checked)" />
                  Split default / named
                </label>
              </div>
            </div>

            <template v-if="dataset.restricted.value">
              <div class="rows">
                <p v-if="loading" class="row-note">Loading graphs…</p>
                <p v-else-if="loadError" class="row-note error">{{ loadError }}</p>
                <template v-for="graph in visibleGraphs" :key="graph">
                  <div v-if="separate" class="row">
                    <span class="iri" :title="graph"><span class="pre">{{ splitIri(graph).head }}</span>{{ splitIri(graph).tail }}</span>
                    <span class="dn" role="group" :aria-label="graph">
                      <button type="button" :class="{ on: dataset.defaultGraphs.value.includes(graph) }" :aria-pressed="dataset.defaultGraphs.value.includes(graph)" @click="toggle(dataset.defaultGraphs, graph)">Default</button>
                      <button type="button" :class="{ on: dataset.namedGraphs.value.includes(graph) }" :aria-pressed="dataset.namedGraphs.value.includes(graph)" @click="toggle(dataset.namedGraphs, graph)">Named</button>
                    </span>
                  </div>
                  <label v-else class="row">
                    <input type="checkbox" :checked="dataset.graphs.value.includes(graph)" :aria-label="`Read ${graph}`" @change="toggle(dataset.graphs, graph)" />
                    <span class="iri" :title="graph"><span class="pre">{{ splitIri(graph).head }}</span>{{ splitIri(graph).tail }}</span>
                  </label>
                </template>
                <p v-if="!loading && !loadError && visibleGraphs.length === 0" class="row-note">No graphs to show.</p>
              </div>
              <InlineNote v-if="truncated" size="xs" class="pad">The backend has more than {{ GRAPH_LIST_LIMIT }} graphs. Paste the others.</InlineNote>
              <div v-if="pasting" class="paste">
                <textarea v-model="pasted" rows="2" placeholder="One IRI per line" aria-label="Paste graph IRIs" data-testid="graph-paste" />
                <button type="button" class="btn-compact" :disabled="!pasted.trim()" @click="addPasted">Add</button>
              </div>
            </template>

            <div class="pop-foot">
              <InlineNote as="span" size="xs" class="foot-note">
                <template v-if="policed">Only the graphs {{ backendName }}'s policy lets you read.</template>
                <template v-else-if="matchesNothing">No graphs chosen: the run matches nothing.</template>
              </InlineNote>
              <button v-if="dataset.restricted.value && !pasting" type="button" class="link" @click="pasting = true">Paste IRIs</button>
              <button v-if="dataset.restricted.value" type="button" class="link" @click="dataset.clear(); dataset.restricted.value = true">Clear</button>
            </div>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </span>
</template>

<script setup lang="ts">
/**
 * "reading …": the graphs a query reads, as a clause of the run sentence
 * instead of `FROM` in its text.
 *
 * The clause says the state at a glance: all graphs, the count a policy
 * leaves readable, the count chosen, or none. Pressing it opens the list.
 * The list is loaded from the backend the run targets; under a graph policy
 * it is already narrowed to what the caller may read, so the picker never
 * offers a graph the run would drop.
 */
import { computed, ref, watch, type Ref } from 'vue';
import { ChevronDown } from '@lucide/vue';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { useApiClient } from '@/composables/useApiClient';
import InlineNote from '@/components/shared/InlineNote.vue';
import FilterBox from '@/components/shared/FilterBox.vue';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';
import { splitIri } from '@/lib/accessModel';
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
  backendName?: string;
  /** The backend has a graph policy, so its list is already what this caller may read. */
  policed?: boolean;
  isUpdate?: boolean;
  /** A run was asked for with no graphs chosen; the clause asks first. */
  askingEmpty?: boolean;
}>();

const emit = defineEmits<{
  (e: 'run-anyway'): void;
  (e: 'dismiss-empty'): void;
}>();

const api = useApiClient();

const open = ref(false);
const available = ref<string[]>([]);
const loadedFor = ref<string | null>(null);
const truncated = ref(false);
const loading = ref(false);
const loadError = ref<string | null>(null);
const filter = ref('');
const pasting = ref(false);
const pasted = ref('');

const separate = computed(() => props.dataset.applyTo.value === 'separate');
const summary = computed(() => datasetSummary(props.dataset.payload()));
const matchesNothing = computed(() => summary.value === 'none');

const clauseLabel = computed(() => {
  if (props.dataset.restricted.value) return matchesNothing.value ? '0 graphs' : summary.value;
  if (props.policed && loadedFor.value === props.backendId) return `${available.value.length} readable`;
  return props.policed ? 'readable graphs' : 'all graphs';
});

const clauseTitle = computed(() => {
  if (matchesNothing.value) return 'No graphs chosen: the run matches nothing';
  if (props.dataset.restricted.value) return 'The graphs this run reads';
  return props.policed ? 'Every graph the policy lets you read' : 'Every graph in the backend';
});

const whichOptions = computed(() => [
  { value: 'all', label: loadedFor.value === props.backendId ? `All I can read · ${available.value.length}` : 'All I can read' },
  { value: 'choose', label: 'Choose' },
]);

/** Loaded graphs, plus any chosen ones the list does not hold, so a pasted IRI stays visible. */
const visibleGraphs = computed(() => {
  const chosen = [...props.dataset.graphs.value, ...props.dataset.defaultGraphs.value, ...props.dataset.namedGraphs.value];
  const all = [...new Set([...chosen, ...available.value])];
  const needle = filter.value.trim().toLowerCase();
  return needle ? all.filter((graph) => graph.toLowerCase().includes(needle)) : all;
});

watch(open, (isOpen) => {
  if (isOpen && props.backendId && loadedFor.value !== props.backendId) void loadGraphs();
});

watch(() => props.backendId, () => {
  available.value = [];
  loadedFor.value = null;
  if (open.value) void loadGraphs();
});

watch(() => props.askingEmpty, (asking) => {
  if (asking) open.value = true;
});

watch(open, (isOpen) => {
  if (!isOpen && props.askingEmpty) emit('dismiss-empty');
});

const showEmptyAsk = computed(() => props.askingEmpty && matchesNothing.value);

function toggle(list: Ref<string[]>, graph: string) {
  list.value = list.value.includes(graph) ? list.value.filter((g) => g !== graph) : [...list.value, graph];
}

/** Turning the split on starts both lists from the one list, so nothing chosen is lost. */
function setSplit(on: boolean) {
  if (on) {
    props.dataset.defaultGraphs.value = [...props.dataset.graphs.value];
    props.dataset.namedGraphs.value = [...props.dataset.graphs.value];
    props.dataset.applyTo.value = 'separate';
  } else {
    props.dataset.graphs.value = [...new Set([...props.dataset.defaultGraphs.value, ...props.dataset.namedGraphs.value])];
    props.dataset.applyTo.value = 'both';
  }
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
  pasting.value = false;
}

function runAnyway() {
  open.value = false;
  emit('run-anyway');
}

async function loadGraphs() {
  const backendId = props.backendId;
  if (!backendId) return;
  loading.value = true;
  loadError.value = null;
  try {
    const response = await api.runSparql({ query: LIST_GRAPHS_QUERY, backendId });
    const bindings = (response as { results?: { bindings?: Array<Record<string, { value: string }>> } }).results?.bindings ?? [];
    const graphs = bindings.map((row) => row.g?.value).filter((g): g is string => typeof g === 'string');
    truncated.value = graphs.length > GRAPH_LIST_LIMIT;
    available.value = graphs.slice(0, GRAPH_LIST_LIMIT).sort();
    loadedFor.value = backendId;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.clause {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
}

.joiner {
  color: var(--ink-muted);
  font-size: var(--text-body);
  font-style: italic;
  white-space: nowrap;
}

.reading {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  white-space: nowrap;
  cursor: pointer;
}

.reading:hover:not(:disabled) {
  border-color: var(--border-hover);
  background: var(--surface-subtle);
}

.reading.active {
  border-color: var(--action-border);
  background: var(--action-surface);
  color: var(--action-ink);
}

.reading.danger {
  border-color: var(--danger-border);
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.reading.inert {
  cursor: default;
  opacity: 0.5;
}

.chevron {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.pop {
  display: flex;
  flex-direction: column;
  width: 380px;
  max-height: 70vh;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.ask {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--danger-border);
  background: var(--danger-surface);
}

.ask-text {
  flex: 1;
  min-width: 160px;
  color: var(--danger-ink);
  font-size: var(--text-body);
}

.pop-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
}

.title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.pop-title {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
}

.which :deep(.segmented) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: 100%;
}

.tools {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.tools :deep(.filter-box) {
  flex: 1;
}

.switch-row {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ink-secondary);
  font-size: var(--text-label);
  white-space: nowrap;
}

.switch-row input {
  margin: 0;
}

.rows {
  flex: 1;
  min-height: 0;
  padding: var(--space-2) 0;
  border-top: 1px solid var(--border-subtle);
  overflow-y: auto;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 28px;
  padding: 0 var(--space-5);
  cursor: pointer;
}

.row:hover {
  background: var(--surface-subtle);
}

.row input {
  margin: 0;
}

.iri {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pre {
  color: var(--ink-muted);
}

.dn {
  display: inline-grid;
  grid-template-columns: repeat(2, var(--grid-2));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.dn button {
  height: var(--control-h-sm);
  padding: 0;
  border: 0;
  background: var(--surface);
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.dn button + button {
  border-left: 1px solid var(--border-default);
}

.dn button.on {
  background: var(--segment-selected);
  color: var(--segment-selected-ink);
  font-weight: var(--weight-semibold);
}

.row-note {
  margin: 0;
  padding: var(--space-3) var(--space-5);
  color: var(--ink-muted);
  font-size: var(--text-body);
}

.row-note.error {
  color: var(--danger-ink);
}

.pad {
  padding: 0 var(--space-5) var(--space-3);
}

.paste {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--border-subtle);
}

.paste textarea {
  flex: 1;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  resize: vertical;
}

.pop-foot {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
}

.foot-note {
  flex: 1;
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--action);
  font-size: var(--text-label);
  cursor: pointer;
}
</style>
