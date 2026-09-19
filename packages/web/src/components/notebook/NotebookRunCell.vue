<template>
  <section class="cell" :data-testid="`notebook-cell-${cell.id}`">
    <div class="cell__gutter">
      <span class="cell__index">{{ index }}</span>
    </div>

    <div class="cell__card">
      <PanelHeader :title="targetName" :subtitle="target?.description ?? undefined" sunken>
        <template #icon>
          <Badge variant="secondary" class="head__kind">{{ kindLabel }}</Badge>
        </template>
        <template #actions>
          <span
            v-if="state.stale"
            class="chip chip--warning"
            :data-testid="`notebook-stale-${cell.id}`"
            title="An upstream value was rebound after this cell ran."
          >stale</span>
          <NuxtLink v-if="editorLink" :to="editorLink" class="head__link">
            <Pencil :size="11" /> Open in editor
          </NuxtLink>
          <!--
            One overflow menu rather than three words. Moving and removing a
            cell are rare beside running it, and three text buttons in the bar
            read as loudly as the query's own name.
          -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Cell actions"
                :data-testid="`notebook-menu-${cell.id}`"
              >
                <MoreHorizontal :size="13" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @select="$emit('move', -1)">Move up</DropdownMenuItem>
              <DropdownMenuItem @select="$emit('move', 1)">Move down</DropdownMenuItem>
              <DropdownMenuItem
                :data-testid="`notebook-remove-${cell.id}`"
                @select="$emit('remove')"
              >Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </template>
      </PanelHeader>

      <p v-if="!target" class="notice notice--error" :data-testid="`notebook-missing-${cell.id}`">
        This cell names something this library no longer holds.
      </p>

      <template v-else>
        <!-- One row per parameter slot: where it comes from, and what that means. -->
        <div v-if="target.slots.length > 0" class="inputs">
          <div v-for="(vars, slotIndex) in target.slots" :key="slotIndex" class="input-row">
            <SectionLabel as="span">slot {{ slotIndex + 1 }}</SectionLabel>
            <span class="input-row__vars">{{ vars.map((name) => `?${name}`).join(' ') }}</span>

            <label class="visually-hidden" :for="`${cell.id}-slot-${slotIndex}`">
              Source for slot {{ slotIndex + 1 }}
            </label>
            <select
              :id="`${cell.id}-slot-${slotIndex}`"
              class="select"
              :data-testid="`notebook-slot-source-${cell.id}-${slotIndex}`"
              :value="sourceValue(slotIndex)"
              @change="onSourceChange(slotIndex, ($event.target as HTMLSelectElement).value)"
            >
              <option value="typed">Typed values</option>
              <option v-for="option in rowValueOptions" :key="option.name" :value="`@${option.name}`">
                @{{ option.name }}
              </option>
            </select>

            <template v-if="wiredValue(slotIndex)">
              <InlineNote as="span" size="xs">{{ wiredValue(slotIndex)?.summary }} · by value</InlineNote>
              <label class="visually-hidden" :for="`${cell.id}-empty-${slotIndex}`">
                If that value is empty
              </label>
              <select
                :id="`${cell.id}-empty-${slotIndex}`"
                class="select"
                :value="emptyMode(slotIndex)"
                @change="onEmptyChange(slotIndex, ($event.target as HTMLSelectElement).value)"
              >
                <option value="skip">If empty, skip this cell</option>
                <option value="empty">If empty, run with no rows</option>
                <option value="stop">If empty, stop</option>
              </select>
            </template>
          </div>
        </div>

        <!-- A rule set takes a graph rather than rows: its one input is G0. -->
        <div v-if="cell.kind === 'ruleset'" class="inputs">
          <div class="input-row">
            <SectionLabel as="span">base graph</SectionLabel>
            <label class="visually-hidden" :for="`${cell.id}-graph`">Base graph</label>
            <select
              :id="`${cell.id}-graph`"
              class="select"
              :data-testid="`notebook-graph-source-${cell.id}`"
              :value="graphSourceValue"
              @change="onGraphChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">None — the rule set's own DATA blocks</option>
              <option v-for="option in graphValueOptions" :key="option.name" :value="`@${option.name}`">
                @{{ option.name }}
              </option>
            </select>
            <InlineNote v-if="graphSourceSummary" as="span" size="xs">{{ graphSourceSummary }} · by value</InlineNote>
          </div>
        </div>

        <!-- The same builder the library page and the exported page use. -->
        <div v-if="showArgs" class="args">
          <sqlib-args ref="argsEl" @change="onArgsChange"></sqlib-args>
        </div>

        <!--
          What the cell will run. A notebook that shows a name and a Run button
          and never the query is asking for trust it has not earned — and the
          query is the thing a reader is being walked through. Eight lines,
          the rest one click away, the same CodePeek the library page uses.
        -->
        <div v-if="target.queryString" class="query">
          <CodePeek
            label="Query"
            :content="target.queryString"
            content-type="application/sparql-query"
            :collapsed-lines="8"
            :test-id="`notebook-query-${cell.id}`"
          />
        </div>
      </template>

      <!--
        The same run sentence the query screen writes, minus its "with" clause:
        a notebook's arguments are the cell above it, so the inputs term would
        be naming something the reader can already see. What is left is the
        part a notebook could not say at all before — which store this runs
        against, and what it asks for back.
      -->
      <RunBar
        v-if="target"
        :running="state.status === 'running'"
        :run-disabled="!target"
        :run-label="state.stale ? 'Re-run' : 'Run'"
        :backend="backendChoice"
        :format="formatChoice"
        :create-targets="canWrite && value ? ['test'] : []"
        recipe-noun="arguments"
        @run="$emit('run')"
        @update:backend="$emit('update', { backend: $event } as Partial<RunCell>)"
        @update:format="$emit('update', { accept: $event } as Partial<RunCell>)"
        @create="$emit('save-as-test')"
      />

      <div class="outbar">
        <span class="outbar__status" :data-testid="`notebook-status-${cell.id}`">{{ statusLine }}</span>
        <span class="outbar__spacer"></span>
        <span class="outbar__label">out</span>
        <label class="visually-hidden" :for="`${cell.id}-out`">Value name</label>
        <input
          :id="`${cell.id}-out`"
          class="out-name"
          type="text"
          :value="cell.out"
          :data-testid="`notebook-out-${cell.id}`"
          @change="$emit('rename', ($event.target as HTMLInputElement).value)"
        />
        <span v-if="value" class="chip" :data-testid="`notebook-stats-${cell.id}`">{{ describeValue(value) }}</span>
        <Button
          v-if="value && value.type !== 'boolean'"
          size="sm"
          variant="outline"
          :data-testid="`notebook-save-${cell.id}`"
          @click="$emit('save')"
        >
          Save…
        </Button>
      </div>

      <p v-if="state.error" class="notice notice--error" :data-testid="`notebook-error-${cell.id}`">
        {{ state.error }}
      </p>
      <p v-else-if="state.status === 'skipped'" class="notice">
        Skipped — the value feeding it had no rows.
      </p>

      <div v-if="value?.type === 'rows'" class="result">
        <table class="result-table">
          <thead>
            <tr>
              <th v-for="column in value.columns" :key="column" scope="col">?{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in previewRows" :key="rowIndex">
              <td v-for="column in value.columns" :key="column">{{ cellText(row, column) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="result__foot">
          {{ previewRows.length }} of {{ value.bindings.length }} rows shown
        </p>
      </div>

      <CodePeek
        v-else-if="value?.type === 'graph'"
        label="Graph"
        :content="value.content"
        :content-type="value.format"
        :collapsed-lines="6"
      />

      <p v-else-if="value?.type === 'boolean'" class="result__boolean">{{ value.answer }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ClipboardCheck, MoreHorizontal, Pencil, Play } from '@lucide/vue';
import { Badge } from '../ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import CodePeek from '../shared/CodePeek.vue';
import RunBar from '../shared/RunBar.vue';
import InlineNote from '../shared/InlineNote.vue';
import PanelHeader from '../shared/PanelHeader.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import { describeValue, type NotebookValue } from '../../lib/notebookValues';
import { getAllMediaTypeOptions, getMediaTypeChoiceGroups } from '../../lib/mediaTypes';
import { QueryTypeIri } from '@sparql-query-lib/types';
import type { RunCell, SlotSource } from '../../lib/notebookFormat';
import type { CellRunState, NotebookTarget } from '../../composables/useNotebook';

/**
 * One run cell: a reference to a library entity, its inputs, and what it bound.
 *
 * Every kind of run cell renders through this one component because they differ
 * in two lines — which badge, and whether the input is slots or a base graph —
 * and a component per kind would triple the runbar, the stat chip and the
 * result preview, which are the parts anyone actually looks at.
 *
 * The cell never edits the entity it names. Editing is a backlink, exactly as
 * the library page has it: that is what keeps a notebook safe to hand to
 * someone who cannot write to the library.
 */
const props = defineProps<{
  cell: RunCell;
  index: number;
  target: NotebookTarget | null;
  state: CellRunState;
  value: NotebookValue | null;
  /** Values bound above this cell, with a rendered summary for the chip. */
  valueOptions: Array<{ name: string; type: NotebookValue['type']; summary: string }>;
  /** Whether this reader may write to the library at all. */
  canWrite?: boolean;
  /** Stores this cell may run against, and which one the library defaults to. */
  backendOptions?: Array<{ value: string; label: string }>;
  defaultBackend?: string | null;
  backendsLoading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'run'): void;
  (e: 'remove'): void;
  (e: 'move', delta: -1 | 1): void;
  (e: 'rename', name: string): void;
  (e: 'update', patch: Partial<RunCell>): void;
  (e: 'save'): void;
  (e: 'save-as-test'): void;
}>();

interface ArgsElement extends HTMLElement {
  signature: { inputs: string[][]; limits?: string[]; offsets?: string[] };
  payload: unknown;
  valid: boolean;
}

const argsEl = ref<ArgsElement | null>(null);

const KIND_LABELS: Record<string, string> = {
  BINDINGS: 'SELECT',
  BOOLEAN: 'ASK',
  GRAPH: 'CONSTRUCT',
  UPDATE: 'UPDATE',
};

const kindLabel = computed(() => {
  if (!props.target) return 'MISSING';
  if (props.target.kind === 'ruleset') return 'RULE SET';
  if (props.target.kind === 'group') return 'GROUP';
  return KIND_LABELS[props.target.resultKind] ?? props.target.resultKind;
});

const targetName = computed(() => props.target?.name ?? props.cell.label ?? 'Unknown');

/**
 * The link out to the editor.
 *
 * The entity's *own* query parameter, not a generic `item`: the screen reads
 * `?query=`, `?queryGroup=` and `?ruleSet=` to open something, and `item` is
 * not among them. Linking with it set the section and selected nothing, so the
 * link went to the right screen and the wrong place — inherited from the page
 * this one replaced, where it was just as broken.
 */
const EDITOR_PARAM = { query: 'query', group: 'queryGroup', ruleset: 'ruleSet' } as const;
const EDITOR_SECTION = { query: 'queries', group: 'queryGroups', ruleset: 'rules' } as const;

const editorLink = computed(() => {
  if (!props.target) return null;
  return {
    path: '/',
    query: {
      section: EDITOR_SECTION[props.target.kind],
      [EDITOR_PARAM[props.target.kind]]: props.target.id,
    },
  };
});

const slots = computed<SlotSource[]>(() =>
  props.cell.kind === 'ruleset' ? [] : (props.cell.slots ?? []),
);

/** Only rows can fill a parameter slot; a graph has nowhere to go in a VALUES block. */
const rowValueOptions = computed(() => props.valueOptions.filter((option) => option.type === 'rows'));
const graphValueOptions = computed(() => props.valueOptions.filter((option) => option.type === 'graph'));

function sourceValue(index: number): string {
  const slot = slots.value[index];
  return slot?.from === 'value' ? `@${slot.ref}` : 'typed';
}

function wiredValue(index: number) {
  const slot = slots.value[index];
  if (slot?.from !== 'value') return null;
  return props.valueOptions.find((option) => option.name === slot.ref) ?? null;
}

function emptyMode(index: number): string {
  const slot = slots.value[index];
  return slot?.from === 'value' ? (slot.whenEmpty ?? 'skip') : 'skip';
}

function writeSlots(next: SlotSource[]) {
  emit('update', { slots: next } as Partial<RunCell>);
}

function slotsWith(index: number, slot: SlotSource | undefined): SlotSource[] {
  const width = props.target?.slots.length ?? slots.value.length;
  const next: SlotSource[] = [];
  for (let position = 0; position < width; position += 1) {
    const current = position === index ? slot : slots.value[position];
    next.push(current ?? { from: 'typed', bindings: [{}] });
  }
  return next;
}

function onSourceChange(index: number, selection: string) {
  if (selection === 'typed') {
    writeSlots(slotsWith(index, { from: 'typed', bindings: [{}] }));
    return;
  }
  writeSlots(slotsWith(index, { from: 'value', ref: selection.slice(1), whenEmpty: 'skip' }));
}

function onEmptyChange(index: number, mode: string) {
  const slot = slots.value[index];
  if (slot?.from !== 'value') return;
  writeSlots(slotsWith(index, { ...slot, whenEmpty: mode as 'skip' | 'empty' | 'stop' }));
}

const graphSourceValue = computed(() => {
  if (props.cell.kind !== 'ruleset') return '';
  const input = props.cell.inputGraph;
  return input?.from === 'value' ? `@${input.ref}` : '';
});

const graphSourceSummary = computed(() => {
  if (props.cell.kind !== 'ruleset') return null;
  const input = props.cell.inputGraph;
  if (input?.from !== 'value') return null;
  return props.valueOptions.find((option) => option.name === input.ref)?.summary ?? null;
});

function onGraphChange(selection: string) {
  emit('update', {
    inputGraph: selection ? { from: 'value', ref: selection.slice(1) } : undefined,
  } as Partial<RunCell>);
}

/** Which slots the builder is responsible for — the ones not fed by a value. */
const typedSlotIndices = computed(() =>
  (props.target?.slots ?? [])
    .map((_vars, index) => index)
    .filter((index) => slots.value[index]?.from !== 'value'),
);

const showArgs = computed(() => {
  if (!props.target || props.cell.kind === 'ruleset') return false;
  return (
    typedSlotIndices.value.length > 0 ||
    props.target.limitParameters.length > 0 ||
    props.target.offsetParameters.length > 0
  );
});

/*
 * The builder is told about the typed slots only. Showing it a slot that a
 * value fills would offer a second way to set the same input, and the two would
 * disagree the moment someone used both.
 */
watch(
  [argsEl, typedSlotIndices, () => props.target],
  () => {
    const element = argsEl.value;
    if (!element || !props.target) return;
    element.signature = {
      inputs: typedSlotIndices.value.map((index) => props.target!.slots[index] ?? []),
      limits: props.target.limitParameters,
      offsets: props.target.offsetParameters,
    };
  },
  { immediate: true },
);

function onArgsChange(event: Event) {
  const detail = (event as CustomEvent<{ payload: unknown; valid: boolean }>).detail;
  if (!detail || detail.payload === undefined) return;
  const payload = detail.payload as {
    arguments?: Array<{ arguments?: { bindings?: Array<Record<string, unknown>> } }>;
    limits?: Record<string, number>;
    offsets?: Record<string, number>;
  };

  const next = [...slots.value];
  typedSlotIndices.value.forEach((slotIndex, position) => {
    next[slotIndex] = {
      from: 'typed',
      bindings: payload.arguments?.[position]?.arguments?.bindings ?? [{}],
    };
  });

  emit('update', {
    slots: next,
    ...(props.cell.kind === 'query'
      ? { limits: payload.limits ?? {}, offsets: payload.offsets ?? {} }
      : {}),
  } as Partial<RunCell>);
}

/**
 * The store and the format, as the run sentence's two choices.
 *
 * A rule set has neither: it runs in process over the graph it is handed, so
 * the sentence for one is Run and nothing else.
 */
/*
 * What the run asks for when the cell has not been told otherwise. The same
 * default the query screen opens on, so a query moved into a notebook comes
 * back in the format its author is used to reading.
 */
const DEFAULT_MEDIA_TYPE = 'application/sparql-results+json';

/** The result shape, in the vocabulary the format groups are keyed by. */
const queryTypeForFormats = computed(() => {
  if (!props.target) return null;
  if (props.target.resultKind === 'GRAPH') return QueryTypeIri.construct;
  if (props.target.resultKind === 'BOOLEAN') return QueryTypeIri.ask;
  return QueryTypeIri.select;
});

const backendChoice = computed(() => {
  if (!props.target || props.target.kind === 'ruleset') return null;
  return {
    value: (props.cell.kind === 'ruleset' ? null : props.cell.backend) ?? props.defaultBackend ?? '',
    options: props.backendOptions ?? [],
    loading: props.backendsLoading ?? false,
    title: 'The store this cell runs against',
  };
});

const formatChoice = computed(() => {
  if (!props.target || props.target.kind === 'ruleset') return null;
  const accept = props.cell.kind === 'ruleset' ? null : props.cell.accept;
  return {
    value: accept ?? DEFAULT_MEDIA_TYPE,
    options: getAllMediaTypeOptions(),
    groups: getMediaTypeChoiceGroups(queryTypeForFormats.value),
    title: 'The format the results come back in',
  };
});

const statusLine = computed(() => {
  if (props.state.status === 'running') return 'running…';
  if (props.state.status === 'error') return 'failed';
  if (props.state.status === 'skipped') return 'skipped';
  if (props.state.status === 'ok') {
    const duration = props.state.durationMs === null ? '' : ` · ${props.state.durationMs} ms`;
    return props.state.stale ? `ran against an older input${duration}` : `ran${duration}`;
  }
  return 'not run yet';
});

const previewRows = computed(() =>
  props.value?.type === 'rows' ? props.value.bindings.slice(0, 5) : [],
);

/** A SPARQL JSON term, as one line of table text. */
function cellText(row: Record<string, unknown>, column: string): string {
  const term = row[column] as { value?: unknown } | undefined;
  if (!term) return '';
  return String(term.value ?? '');
}
</script>

<style scoped>
.cell {
  display: flex;
  gap: var(--space-4);
}

.cell__gutter {
  width: var(--space-7);
  flex-shrink: 0;
  text-align: right;
  padding-top: var(--space-5);
}

.cell__index {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.cell__card {
  flex-grow: 1;
  min-width: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  background: var(--surface);
  overflow: hidden;
}


.head__kind {
  font-size: var(--text-micro);
}




.head__link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-micro);
}

/*
 * The cell's title is the entity's own name, and the app sets an entity's name
 * in the code face everywhere it is the subject rather than the prose — the
 * rule `StratificationPanel` follows for a rule's name. `:deep` because the
 * title belongs to <PanelHeader>; this is the form its guard names.
 */
.cell__card :deep(.panel-header__title) {
  font-family: var(--font-mono);
  font-size: var(--text-body-lg);
}


.query {
  padding: var(--space-4) var(--space-4) 0;
}

.inputs {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-4) 0;
}

.input-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}


.input-row__vars {
  font-family: var(--font-mono);
  font-size: var(--text-body);
  color: var(--ink-secondary);
}


.select {
  height: var(--control-h-sm);
  box-sizing: border-box;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--text-micro);
}

.args {
  padding: var(--space-4) var(--space-4) 0;
}

.outbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  flex-wrap: wrap;
}

.outbar__status {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.outbar__spacer {
  flex-grow: 1;
}

.outbar__label {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.chip {
  height: var(--control-h-sm);
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  font-size: var(--text-micro);
  color: var(--ink-secondary);
}

.chip--warning {
  border-color: var(--warning-border);
  background: var(--warning-surface);
  color: var(--warning-ink);
}

.notice {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-body);
  color: var(--ink-muted);
}

.notice--error {
  color: var(--danger-ink);
  background: var(--danger-surface);
}

.result {
  padding: 0 var(--space-4) var(--space-4);
}

.result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-body);
}

.result-table th {
  text-align: left;
  font-weight: var(--weight-semibold);
  color: var(--ink-secondary);
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
}

.result-table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

.result__foot {
  margin: var(--space-2) 0 0;
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.result__boolean {
  margin: 0;
  padding: 0 var(--space-4) var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--text-body-lg);
}

/*
 * `<sqlib-args>` in the app's clothes.
 *
 * The element is light DOM precisely so each host can theme it: the exported
 * page injects the runtime's own ARGS_ELEMENT_STYLES, and the app dresses the
 * same class names in its tokens instead. Without this the element renders as
 * raw unstyled HTML — which is exactly what shipped, because every test
 * asserted on DOM text and none of them could see it.
 */
:deep(.sqlib-args__modes) {
  display: inline-flex;
  gap: 0;
  padding: var(--space-1);
  margin-bottom: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface-subtle);
}

:deep(.sqlib-args__mode) {
  height: var(--control-h-sm, 24px);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  font: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

:deep(.sqlib-args__mode[aria-pressed='true']) {
  background: var(--surface);
  color: var(--ink);
  font-weight: var(--weight-semibold);
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
}

:deep(.sqlib-args__slot) { margin-bottom: var(--space-4); }

:deep(.sqlib-args__slot-label) {
  margin-bottom: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

:deep(.sqlib-args__table) {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-label);
}

:deep(.sqlib-args__table th) {
  padding: 0 var(--space-3) var(--space-2);
  text-align: left;
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  color: var(--ink-muted);
}

:deep(.sqlib-args__table td) { padding: var(--space-1) var(--space-3); vertical-align: top; }

:deep(.sqlib-args__cell) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

:deep(.sqlib-args__cell select),
:deep(.sqlib-args__cell input),
:deep(.sqlib-args__limit input) {
  height: var(--control-h-sm, 24px);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: inherit;
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

:deep(.sqlib-args__cell input) { flex: 3 1 14rem; min-width: 8rem; }

/* Datatype and language qualify the value; they should not rival it for width. */
:deep(.sqlib-args__cell input[placeholder='datatype IRI']),
:deep(.sqlib-args__cell input[placeholder='lang']) { flex: 1 1 7rem; min-width: 4rem; }
:deep(.sqlib-args__cell input:focus),
:deep(.sqlib-args__limit input:focus) { border-color: var(--action); outline: none; }
:deep(.sqlib-args__cell input.sqlib-args__invalid) { border-color: var(--danger-ink); }

:deep(.sqlib-args__error) {
  flex-basis: 100%;
  color: var(--danger-ink);
  font-size: var(--text-micro);
}

:deep(.sqlib-args__row-actions) { white-space: nowrap; }

:deep(.sqlib-args__button) {
  height: var(--control-h-sm, 24px);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

:deep(.sqlib-args__button:hover) { background: var(--surface-subtle); color: var(--ink); }

:deep(.sqlib-args__limits) {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

:deep(.sqlib-args__limit) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  color: var(--ink-muted);
}

:deep(.sqlib-args__limit input) { width: 6rem; }

:deep(.sqlib-args__json) {
  width: 100%;
  min-height: 9rem;
  padding: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  color: inherit;
  font-family: var(--font-mono);
  font-size: var(--text-label);
  resize: vertical;
}

:deep(.sqlib-args__note) {
  margin: var(--space-2) 0 0;
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

:deep(.sqlib-args__note--warn) { color: var(--warning-ink, var(--ink-secondary)); }
:deep(.sqlib-args__empty) { font-size: var(--text-label); color: var(--ink-muted); }

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
