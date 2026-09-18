<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Insert a cell</DialogTitle>
        <DialogDescription>
          A cell references a library entity and tracks its current version. Nothing is copied
          into the notebook.
        </DialogDescription>
      </DialogHeader>

      <div class="controls">
        <input
          v-model="search"
          type="search"
          class="search"
          placeholder="Filter"
          aria-label="Filter the library"
          data-testid="notebook-insert-search"
        />
        <button type="button" class="button" data-testid="notebook-insert-markdown" @click="chooseMarkdown">
          Markdown cell
        </button>
      </div>

      <div class="tabs">
        <button
          v-for="tab in TABS"
          :key="tab.kind"
          type="button"
          class="tab"
          :class="{ 'tab--active': kind === tab.kind }"
          :data-testid="`notebook-insert-tab-${tab.kind}`"
          @click="kind = tab.kind"
        >
          {{ tab.label }} <span class="tab__count">{{ countFor(tab.kind) }}</span>
        </button>
      </div>

      <div class="list" data-testid="notebook-insert-list">
        <button
          v-for="target in visible"
          :key="target.id"
          type="button"
          class="row"
          :data-testid="`notebook-insert-${target.id}`"
          @click="choose(target)"
        >
          <span class="row__kind">{{ kindLabel(target) }}</span>
          <span class="row__name">{{ target.name }}</span>
          <span class="row__desc">{{ target.description ?? '' }}</span>
          <span class="row__sig">{{ signature(target) }}</span>
        </button>
        <p v-if="visible.length === 0" class="empty">Nothing here matches.</p>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { fuzzyMatches } from '../../lib/fuzzy';
import type { NotebookTarget } from '../../composables/useNotebook';

/**
 * The picker that makes adding a cell an *import*.
 *
 * All three entity kinds are here because all three run through the API — the
 * reason the notebook is not built on the export bundle, which carries no rule
 * sets at all. A tab per kind rather than one merged list: "what does this
 * library have to reason with" is a different question from "which query do I
 * want", and the counts answer the first one on the way past.
 */
const props = defineProps<{
  open: boolean;
  targets: NotebookTarget[];
  /** Which tab opens — the Add row's buttons each name a kind. */
  kind?: NotebookTarget['kind'];
}>();

const emit = defineEmits<{
  (e: 'update:open', open: boolean): void;
  (e: 'update:kind', kind: NotebookTarget['kind']): void;
  (e: 'insert', target: NotebookTarget): void;
  (e: 'insert-markdown'): void;
}>();

const TABS = [
  { kind: 'query' as const, label: 'Queries' },
  { kind: 'group' as const, label: 'Groups' },
  { kind: 'ruleset' as const, label: 'Rule sets' },
];

const search = ref('');

const kind = computed({
  get: () => props.kind ?? 'query',
  set: (value: NotebookTarget['kind']) => emit('update:kind', value),
});

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

watch(isOpen, (open) => {
  if (open) search.value = '';
});

function countFor(wanted: NotebookTarget['kind']): number {
  return props.targets.filter((target) => target.kind === wanted).length;
}

const visible = computed(() =>
  props.targets
    .filter((target) => target.kind === kind.value)
    .filter((target) => fuzzyMatches(search.value, target.name, target.description)),
);

const KIND_LABELS: Record<string, string> = {
  BINDINGS: 'SELECT',
  BOOLEAN: 'ASK',
  GRAPH: 'CONSTRUCT',
  UPDATE: 'UPDATE',
};

function kindLabel(target: NotebookTarget): string {
  if (target.kind === 'ruleset') return 'RULES';
  if (target.kind === 'group') return 'GROUP';
  return KIND_LABELS[target.resultKind] ?? target.resultKind;
}

/** What the cell will ask for, in one line — the same words the cell header uses. */
function signature(target: NotebookTarget): string {
  const parts = target.slots.map(
    (vars, index) => `slot ${index + 1}: ${vars.map((name) => `?${name}`).join(' ')}`,
  );
  if (target.kind === 'ruleset') parts.push('takes a base graph');
  if (parts.length === 0) parts.push('no arguments');
  return parts.join(' · ');
}

function choose(target: NotebookTarget) {
  emit('insert', target);
  isOpen.value = false;
}

function chooseMarkdown() {
  emit('insert-markdown');
  isOpen.value = false;
}
</script>

<style scoped>
.controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.search {
  flex-grow: 1;
  height: var(--control-h);
  box-sizing: border-box;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
}

.button {
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-body);
  cursor: pointer;
}

.button:hover {
  background: var(--surface-subtle);
}

.tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-subtle);
}

.tab {
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ink-secondary);
  font-size: var(--text-body);
  cursor: pointer;
}

.tab--active {
  border-bottom-color: var(--ink);
  color: var(--ink);
  font-weight: var(--weight-semibold);
}

.tab__count {
  color: var(--ink-muted);
}

.list {
  max-height: var(--space-9);
  min-height: var(--space-9);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.row:hover {
  background: var(--surface-subtle);
}

.row__kind {
  width: var(--grid-2);
  flex-shrink: 0;
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  color: var(--ink-secondary);
}

.row__name {
  width: var(--grid-6);
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__desc {
  flex-grow: 1;
  min-width: 0;
  font-size: var(--text-micro);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__sig {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.empty {
  margin: 0;
  padding: var(--space-5);
  text-align: center;
  font-size: var(--text-body);
  color: var(--ink-muted);
}
</style>
