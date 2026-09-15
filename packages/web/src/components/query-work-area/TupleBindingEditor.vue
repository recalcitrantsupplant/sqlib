<template>
  <section class="clause" data-testid="argument-clause">
    <header class="clause-header">
      <!--
        The signature is the widest thing here and the thing being named, so it
        gets the line to itself and the counts sit under it. Kept on one row,
        a seven-variable clause wrapped to two lines and squeezed the view
        toggle into an ellipsis.
      -->
      <div class="clause-heading">
        <span class="clause-title">
          VALUES <span class="clause-sig">{{ signature }}</span>
        </span>
        <div class="clause-meta">
          <span class="clause-count">{{ rowCountLabel }}</span>
          <span v-if="variables.length > 2" class="clause-arity">· {{ variables.length }} variables</span>
          <span v-if="line" class="clause-line" :title="`VALUES clause on line ${line}`">L{{ line }}</span>
        </div>
      </div>

      <!--
        A view, not the model. The same rows read three ways: stacked blocks
        that survive any arity, a spreadsheet for filling a lot of them fast,
        and the clause itself with each term a token. Stacked stays the default
        because it is the one that never needs explaining (design §4).
      -->
      <div class="view-toggle" role="group" aria-label="Row layout">
        <button
          v-for="option in VIEWS"
          :key="option.value"
          type="button"
          class="view-button"
          :class="{ 'view-button--selected': view === option.value }"
          :aria-pressed="view === option.value"
          :title="option.title"
          :data-testid="`argument-view-${option.value}`"
          @click="view = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </header>

    <div class="clause-body">
      <!--
        Linked sets first, and above the rows rather than among them: their rows
        are read out of the tuple set at execution and are not editable here,
        which is exactly what the rows below are.
      -->
      <TupleSetReferenceList
        :references="references"
        :variables="names"
        :library-id="libraryId"
        :disabled="disabled"
        @remove="removeReference"
        @repin="repinReference"
      />

      <!--
        The empty state belongs to the stacked view alone. The other two draw
        their own way to add the first row — a sheet's last line, a clause's
        empty brackets — and hiding them behind a sentence would leave the
        author with nothing to click.
      -->
      <template v-if="view === 'rows'">
        <InlineNote v-if="rows.length === 0 && references.length === 0" size="xs" data-testid="tuple-clause-empty">
          No values: this input is left open and will not filter results.
        </InlineNote>
        <InlineNote v-else-if="rows.length === 0" size="xs" data-testid="tuple-clause-empty">
          No rows typed here — this clause is filled by the linked set alone.
        </InlineNote>
      </template>

      <!-- Stacked: one block per row, variables listed down it. -->
      <ol v-if="view === 'rows' && rows.length" class="row-blocks">
        <li v-for="(row, rowIndex) in rows" :key="rowIndex" class="row-block">
          <div class="row-block-header">
            <span class="row-block-label">Row {{ rowIndex + 1 }}</span>
            <span class="row-block-summary">{{ summaries[rowIndex] }}</span>
            <button
              type="button"
              class="btn-row"
              title="Duplicate row"
              :disabled="disabled"
              @click="duplicateRow(rowIndex)"
            >
              <CopyPlus :size="13" />
            </button>
            <button
              type="button"
              class="btn-row btn-row--danger"
              title="Remove row"
              :disabled="disabled"
              @click="removeRow(rowIndex)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
          <div class="row-block-fields">
            <div v-for="name in names" :key="name" class="field">
              <label class="field-label">?{{ name }}</label>
              <ArgumentValueField
                :value="cell(row, name)"
                :variable="name"
                :disabled="disabled"
                @update="(next) => setCell(rowIndex, name, next)"
              />
            </div>
          </div>
        </li>
      </ol>

      <!-- Grid: the same rows as a sheet — one text box per cell, keys that move. -->
      <ValuesGrid
        v-else-if="view === 'grid'"
        :variables="names"
        :rows="rows"
        :disabled="disabled"
        @update:rows="emitRows"
        @add="addRow"
        @duplicate="duplicateRow"
        @remove="removeRow"
      />

      <!-- Inline: the VALUES block as it will be sent, every term a token. -->
      <ValuesClauseView
        v-else-if="view === 'inline'"
        :variables="names"
        :rows="rows"
        :disabled="disabled"
        @update:rows="emitRows"
        @add="addRow"
        @remove="removeRow"
      />

      <div class="clause-footer">
        <button
          v-if="view === 'rows'"
          type="button"
          class="btn-add"
          data-testid="argument-add-row"
          :disabled="disabled"
          @click="addRow"
        >
          <CirclePlus :size="13" /> Add row
        </button>
        <!--
          Rows typed here belong to this query; rows worth reusing belong to a
          tuple set, and this is the seam between the two.
        -->
        <TupleSetPicker
          :variables="names"
          :library-id="libraryId"
          :attached-to="references"
          :disabled="disabled"
          @load="loadFromTupleSet"
          @attach="attachTupleSet"
        />
        <InlineNote v-if="rows.length && view === 'rows'" as="span" size="xs">Blank cells bind UNDEF.</InlineNote>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { CopyPlus, Trash2, CirclePlus } from '@lucide/vue';
import ArgumentValueField from './ArgumentValueField.vue';
import ValuesGrid from './ValuesGrid.vue';
import ValuesClauseView from './ValuesClauseView.vue';
import TupleSetPicker from './TupleSetPicker.vue';
import TupleSetReferenceList from './TupleSetReferenceList.vue';
import InlineNote from '../shared/InlineNote.vue';
import type {
  ArgumentRow,
  ArgumentTupleBinding,
  SparqlBinding,
  SparqlValue,
  TupleSetReference,
} from '@/types/argument-sets';
import { bareVariable, summariseRow, tupleSignature } from '@/lib/argumentSignature';
import {
  referencesOf,
  withReference,
  withoutReference,
  withRepinnedReference,
} from '@/lib/tupleSetReferences';

/**
 * One VALUES clause and the sources filling it.
 *
 * Two kinds of source, unioned at execution the way `mergeArgumentSets` already
 * unions two argument sets contributing one clause: rows typed here, and tuple
 * sets linked by reference. Stacked is the default for the rows because it is
 * the shape that survives `VALUES (?a ?b ?c ?d ?e)` without explanation. Grid
 * is the one to reach for when there are many rows to fill — it is a
 * spreadsheet, keys and paste included — and Clause shows the block as it will
 * be sent, which is a preview and an editor at once.
 */
const props = defineProps<{
  variables: string[];
  modelValue: ArgumentTupleBinding;
  /** 1-based source line of the clause, when it could be located. */
  line?: number;
  /** Which library's tuple sets are on offer. Defaults to the active one. */
  libraryId?: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: ArgumentTupleBinding];
}>();

/**
 * The three ways to read one clause.
 *
 * None of them is disabled by arity any more: the old table gave up at four
 * variables because its columns were narrower than the values in them, and the
 * grid answers that by scrolling sideways instead of squeezing.
 */
const VIEWS = [
  { value: 'rows', label: 'Rows', title: 'One block per row' },
  { value: 'grid', label: 'Grid', title: 'A spreadsheet: type across, paste a block' },
  { value: 'inline', label: 'Inline', title: 'The VALUES clause as it will be sent' },
] as const;

type View = (typeof VIEWS)[number]['value'];

const names = computed(() => props.variables.map(bareVariable));
const view = ref<View>('rows');

const rows = computed<ArgumentRow[]>(() => props.modelValue?.rows ?? []);
const references = computed<TupleSetReference[]>(() =>
  (props.modelValue ? referencesOf(props.modelValue) : []));

const rowCountLabel = computed(() => {
  const count = rows.value.length;
  const typed = `${count} row${count === 1 ? '' : 's'}`;
  // The header counts what is stored here. A referenced set's rows are counted
  // on the reference itself, because how many there are is a property of the
  // tuple set's current version rather than of this clause.
  const linked = references.value.length;
  return linked ? `${typed} · ${linked} linked set${linked === 1 ? '' : 's'}` : typed;
});

const signature = computed(() => {
  const withMarks = names.value.map((name) => `?${name}`);
  return withMarks.length > 1 ? `(${withMarks.join(' ')})` : withMarks[0] ?? '';
});

/** The one-line précis under each stacked block, so a long list stays scannable. */
const summaries = computed(() =>
  rows.value.map((row) => summariseRow(names.value, (row.values ?? {}) as SparqlBinding)),
);

function cell(row: ArgumentRow, name: string): SparqlValue {
  return row.values?.[name] ?? { type: 'uri', value: '' };
}

function emitRows(next: ArgumentRow[]) {
  emit('update:modelValue', {
    ...props.modelValue,
    tupleSignature: props.modelValue?.tupleSignature ?? tupleSignature(names.value),
    variables: names.value,
    rows: next.map((row, position) => ({ ...row, position })),
  });
}

function blankRow(): ArgumentRow {
  const values: SparqlBinding = {};
  for (const name of names.value) values[name] = { type: 'uri', value: '' };
  return { values };
}

function addRow() {
  emitRows([...rows.value, blankRow()]);
}

function duplicateRow(index: number) {
  const source = rows.value[index];
  const copy: ArgumentRow = {
    values: Object.fromEntries(
      Object.entries(source.values ?? {}).map(([key, value]) => [key, { ...value }]),
    ),
  };
  const next = [...rows.value];
  next.splice(index + 1, 0, copy);
  emitRows(next);
}

function removeRow(index: number) {
  emitRows(rows.value.filter((_, at) => at !== index));
}

/**
 * Take rows from a tuple set into this clause.
 *
 * Appends by default: unioning several sources for one signature is what the
 * runtime already does (`mergeArgumentSets` concatenates rows sharing a
 * signature key), so appending is the behaviour that matches execution rather
 * than a UI convenience. Replace is opt-in on the picker.
 *
 * The rows arrive already narrowed to this clause's variables, so nothing here
 * has to reconcile column names.
 */
function loadFromTupleSet(payload: { rows: ArgumentRow[]; replace: boolean }) {
  emitRows(payload.replace ? payload.rows : [...rows.value, ...payload.rows]);
}

/**
 * Link a tuple set to this clause instead of copying its rows out.
 *
 * The reference arrives floating — no version — because that is what a draft
 * holds: a run reads the set's current version, and the version is written only
 * when the argument set is saved. The inline rows are left exactly as they are;
 * a reference is another source, not a replacement for the ones typed here.
 */
function attachTupleSet(payload: { reference: TupleSetReference }) {
  emit('update:modelValue', withReference(props.modelValue, payload.reference));
}

function removeReference(reference: TupleSetReference) {
  emit('update:modelValue', withoutReference(props.modelValue, reference));
}

/** Move a pin forward, on the author's say-so and never on its own. */
function repinReference(payload: { reference: TupleSetReference; versionId: string }) {
  emit('update:modelValue', withRepinnedReference(props.modelValue, payload.reference, payload.versionId));
}

function setCell(rowIndex: number, name: string, value: SparqlValue) {
  const next = rows.value.map((row, at) => {
    if (at !== rowIndex) return row;
    return { ...row, values: { ...(row.values ?? {}), [name]: value } };
  });
  emitRows(next);
}
</script>

<style scoped>
.clause {
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}

.clause-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: var(--space-3) var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.clause-heading {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.clause-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.clause-title {
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
}

.clause-sig {
  font-family: var(--font-mono);
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  color: var(--ink-secondary);
}

.clause-count,
.clause-arity {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.clause-line {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-muted);
  background: var(--surface-raised);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-2);
}

.view-toggle {
  display: inline-flex;
  flex-shrink: 0;
  align-self: center;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface);
}

.view-button {
  padding: var(--space-1) var(--space-4);
  border: none;
  border-right: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-micro);
  cursor: pointer;
}

.view-button:last-child {
  border-right: none;
}

.view-button--selected {
  background: var(--segment-selected);
  color: var(--segment-selected-ink);
}

.view-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.clause-body {
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row-blocks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row-block {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.row-block-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.row-block-label {
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  color: var(--ink-muted);
}

.row-block-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.row-block-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-4);
}

.field {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.field-label {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-row {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.btn-row:hover:not(:disabled) {
  background: var(--surface-subtle);
  color: var(--ink);
}

.btn-row--danger:hover:not(:disabled) {
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.btn-row:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.clause-footer {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-add {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: var(--space-1) var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-micro);
  cursor: pointer;
}

.btn-add:hover:not(:disabled) {
  background: var(--surface-subtle);
}

.btn-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

</style>
