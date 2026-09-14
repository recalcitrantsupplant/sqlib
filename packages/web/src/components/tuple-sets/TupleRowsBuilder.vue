<template>
  <div class="rows-builder">
    <div class="builder-toolbar">
      <button
        type="button"
        class="btn-add"
        data-testid="builder-add-column"
        :disabled="disabled"
        @click="addColumn"
      >
        <CirclePlus :size="13" /> Add column
      </button>
      <button
        type="button"
        class="btn-add"
        data-testid="builder-add-row"
        :disabled="disabled || columns.length === 0"
        :title="columns.length === 0 ? 'Add a column first — a row with no columns binds nothing' : 'Add a row'"
        @click="addRow"
      >
        <CirclePlus :size="13" /> Add row
      </button>
      <span class="builder-count">{{ countLabel }}</span>

      <!--
        The same two views as the arguments panel, and the same reasoning: a
        grid is how you fill a lot of rows, stacked blocks are how you read one
        with many columns. Grid leads here because a tuple set is a relation —
        tabular is its natural shape, not a density preference.
      -->
      <div v-if="columns.length > 0" class="view-toggle" role="group" aria-label="Row layout">
        <button
          v-for="option in VIEWS"
          :key="option.value"
          type="button"
          class="view-button"
          :class="{ 'view-button--selected': view === option.value }"
          :aria-pressed="view === option.value"
          :title="option.title"
          :data-testid="`builder-view-${option.value}`"
          @click="view = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <InlineNote v-if="columns.length === 0" data-testid="builder-empty">
      No columns yet. A tuple set is one relation — name its columns, then fill
      in rows. Columns are the variables a VALUES clause will bind.
    </InlineNote>

    <ValuesGrid
      v-else-if="view === 'grid'"
      testids="builder"
      :variables="columns"
      :rows="gridRows"
      :disabled="disabled"
      @update:rows="writeGridRows"
      @add="addRow"
      @duplicate="duplicateRow"
      @remove="removeRow"
    >
      <!--
        The column head is where a tuple set differs from a query's arguments:
        the names are authored here rather than read off a VALUES clause.
      -->
      <template #column-head="{ column: name }">
        <div class="column-head-inner">
          <span class="var-mark">?</span>
          <input
            class="column-name"
            data-testid="builder-column-name"
            :value="name"
            :disabled="disabled"
            placeholder="name"
            :aria-label="`Column ${columns.indexOf(name) + 1} name`"
            @input="(event) => renameColumn(columns.indexOf(name), (event.target as HTMLInputElement).value)"
          />
          <button
            type="button"
            class="btn-icon btn-icon--danger"
            title="Remove column"
            data-testid="builder-remove-column"
            :disabled="disabled"
            @click="removeColumn(columns.indexOf(name))"
          >
            <Trash2 :size="12" />
          </button>
          <!--
            A default, not a schema. SPARQL Results JSON types every cell
            individually, so this only seeds new cells — any one of them can
            still be something else. Calling it a column type would promise a
            constraint the format does not carry.
          -->
          <select
            class="column-kind"
            data-testid="builder-column-kind"
            :value="columnDefault(name)"
            :disabled="disabled"
            :aria-label="`Default term type for ${name || 'column'}`"
            @change="(event) => setColumnDefault(name, (event.target as HTMLSelectElement).value)"
          >
            <option value="uri">IRI</option>
            <option value="">plain literal</option>
            <option v-for="datatype in XSD_DATATYPES" :key="datatype.value" :value="datatype.value">
              {{ datatype.label }}
            </option>
          </select>
        </div>
      </template>
    </ValuesGrid>

    <!-- Stacked: one block per row, columns listed down it. -->
    <ol v-else class="row-blocks">
      <li v-for="(row, rowIndex) in rows" :key="rowIndex" class="row-block" data-testid="builder-row">
        <div class="row-block-header">
          <span class="row-block-label">Row {{ rowIndex + 1 }}</span>
          <button
            type="button"
            class="btn-icon"
            title="Duplicate row"
            :disabled="disabled"
            @click="duplicateRow(rowIndex)"
          >
            <CopyPlus :size="12" />
          </button>
          <button
            type="button"
            class="btn-icon btn-icon--danger"
            title="Remove row"
            data-testid="builder-remove-row"
            :disabled="disabled"
            @click="removeRow(rowIndex)"
          >
            <Trash2 :size="12" />
          </button>
        </div>
        <div class="row-block-fields">
          <div v-for="(column, columnIndex) in columns" :key="columnIndex" class="field">
            <label class="field-label">?{{ column || `column${columnIndex + 1}` }}</label>
            <ArgumentValueField
              :value="cell(row, column)"
              :variable="column || `column${columnIndex + 1}`"
              :disabled="disabled"
              @update="(next) => setCell(rowIndex, column, next)"
            />
          </div>
        </div>
      </li>
    </ol>

    <InlineNote v-if="columns.length > 0">
      A blank cell binds UNDEF — it is left out of the saved rows rather than
      stored as an empty value, which would bind the empty literal and match
      nothing.
    </InlineNote>
  </div>
</template>

<script setup lang="ts">
/**
 * Author a tuple set's rows by hand: its columns, and a typed term per cell.
 *
 * The cell editor is `ArgumentValueField`, unchanged and shared with the query
 * arguments panel — one IRI/literal/datatype/language control, so a term means
 * the same thing and is edited the same way wherever it is entered.
 *
 * What this does *not* share is `TupleBindingEditor`, the arguments panel's row
 * grid, and the reason is the difference between the two screens rather than an
 * accident of layout. There, the variables are given: a query declares its
 * VALUES clause and the panel fills it, so renaming a column would be renaming
 * something the query said. Here, the columns *are* the thing being authored —
 * a tuple set defines a relation rather than answering one — so column
 * authoring is the feature, and a grid that cannot do it is the wrong grid.
 *
 * The model is exactly SPARQL Results JSON in pieces: `columns` is `head.vars`
 * and `rows` is `results.bindings`. That is why the builder needs no import
 * step and no new source format — what it produces already *is* the stored
 * form (`docs/concepts.md`).
 */
import { computed, ref } from 'vue';
import { CirclePlus, CopyPlus, Trash2 } from '@lucide/vue';
import ArgumentValueField from '../query-work-area/ArgumentValueField.vue';
import ValuesGrid from '../query-work-area/ValuesGrid.vue';
import InlineNote from '../shared/InlineNote.vue';
import {
  XSD_DATATYPES,
  type ArgumentRow,
  type SparqlBinding,
  type SparqlValue,
} from '@/types/argument-sets';

const props = defineProps<{
  columns: string[];
  rows: SparqlBinding[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:columns': [value: string[]];
  'update:rows': [value: SparqlBinding[]];
}>();

/**
 * Per-column seed for new cells, keyed by column name.
 *
 * Local to the editor and deliberately not emitted: it describes how to make
 * the *next* cell, not what any existing cell is. Persisting it would imply the
 * format enforces a column type, which it does not.
 */
const columnDefaults = ref<Record<string, string>>({});

const VIEWS = [
  { value: 'grid', label: 'Grid', title: 'A spreadsheet: type across, paste a block' },
  { value: 'rows', label: 'Rows', title: 'One block per row' },
] as const;

type View = (typeof VIEWS)[number]['value'];

const view = ref<View>('grid');

/**
 * The grid speaks `ArgumentRow`; a tuple set stores the binding alone.
 *
 * The wrapper is the whole difference — `results.bindings` entries *are* the
 * rows — so it is put on here rather than teaching the grid a second shape.
 */
const gridRows = computed<ArgumentRow[]>(() => props.rows.map((values) => ({ values })));

function writeGridRows(next: ArgumentRow[]) {
  emit('update:rows', next.map((row) => row.values ?? {}));
}

const countLabel = computed(() => {
  const columnCount = props.columns.length;
  const rowCount = props.rows.length;
  return `${columnCount} ${columnCount === 1 ? 'column' : 'columns'} · ${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`;
});

function columnDefault(column: string): string {
  return columnDefaults.value[column] ?? 'uri';
}

function setColumnDefault(column: string, next: string) {
  columnDefaults.value = { ...columnDefaults.value, [column]: next };
}

/** A fresh cell for a column, honouring that column's seed. */
function seedCell(column: string): SparqlValue {
  const seed = columnDefault(column);
  if (seed === 'uri') return { type: 'uri', value: '' };
  if (seed === '') return { type: 'literal', value: '' };
  return { type: 'literal', value: '', datatype: seed };
}

function cell(row: SparqlBinding, column: string): SparqlValue {
  return row[column] ?? { type: 'uri', value: '' };
}

/**
 * A name every column can be told apart by.
 *
 * Rows are keyed by column name, so two columns sharing one would be a single
 * binding wearing two headers — edit one and the other changes. Numbering the
 * duplicate is the smallest fix that keeps typing forward.
 */
function uniqueColumnName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let suffix = 2;
  while (taken.includes(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

function addColumn() {
  const name = uniqueColumnName(`column${props.columns.length + 1}`, props.columns);
  emit('update:columns', [...props.columns, name]);
  // Existing rows gain the column as UNDEF rather than as a blank term: a row
  // written before the column existed genuinely has no value for it.
  emit('update:rows', [...props.rows]);
}

function renameColumn(index: number, rawName: string) {
  const previous = props.columns[index];
  const name = rawName.trim();
  if (name === previous) return;

  const others = props.columns.filter((_, at) => at !== index);
  // An empty name is allowed while typing — it is only refused at save, so
  // clearing the field to retype it does not fight the user mid-word.
  const next = name.length > 0 ? uniqueColumnName(name, others) : name;

  emit('update:columns', props.columns.map((column, at) => (at === index ? next : column)));
  emit('update:rows', props.rows.map((row) => {
    if (!(previous in row)) return row;
    const { [previous]: moved, ...rest } = row;
    return next.length > 0 ? { ...rest, [next]: moved } : rest;
  }));

  const seed = columnDefaults.value[previous];
  if (seed !== undefined && next.length > 0) {
    const { [previous]: _dropped, ...rest } = columnDefaults.value;
    columnDefaults.value = { ...rest, [next]: seed };
  }
}

function removeColumn(index: number) {
  const removed = props.columns[index];
  emit('update:columns', props.columns.filter((_, at) => at !== index));
  emit('update:rows', props.rows.map((row) => {
    const { [removed]: _dropped, ...rest } = row;
    return rest;
  }));
}

function addRow() {
  const row: SparqlBinding = {};
  for (const column of props.columns) row[column] = seedCell(column);
  emit('update:rows', [...props.rows, row]);
}

function duplicateRow(index: number) {
  const source = props.rows[index];
  const copy = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, { ...value }]),
  ) as SparqlBinding;
  const next = [...props.rows];
  next.splice(index + 1, 0, copy);
  emit('update:rows', next);
}

function removeRow(index: number) {
  emit('update:rows', props.rows.filter((_, at) => at !== index));
}

function setCell(rowIndex: number, column: string, value: SparqlValue) {
  emit('update:rows', props.rows.map((row, at) => (
    at === rowIndex ? { ...row, [column]: value } : row
  )));
}
</script>

<style scoped>
.rows-builder {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.builder-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.btn-add {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.btn-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.builder-count {
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.view-toggle {
  display: inline-flex;
  margin-left: auto;
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
  flex: 1;
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
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

.column-head-inner {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.var-mark {
  color: var(--ink-muted);
  font-family: var(--font-mono);
}

.column-name {
  width: 100%;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.column-name:hover:not(:disabled),
.column-name:focus {
  border-color: var(--border-default);
  background: var(--surface);
  outline: none;
}

.column-kind {
  width: 100%;
  margin-top: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-muted);
  font-family: inherit;
  font-size: calc(var(--text-label) * 0.9);
}

.btn-icon {
  display: inline-flex;
  padding: var(--space-1);
  border: none;
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}

.btn-icon:hover:not(:disabled) {
  color: var(--ink);
}

.btn-icon--danger:hover:not(:disabled) {
  color: var(--danger-ink);
}

.btn-icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
