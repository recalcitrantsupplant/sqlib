<template>
  <div class="clause-view" data-testid="argument-clause-view">
    <!--
      One grid for the whole block, so a value sits under the variable it
      binds. Reading a row of a seven-variable clause meant counting brackets
      before this; now the column does the counting.

      The lead column is right-aligned, which is what puts each row's `(`
      directly under the `(` of `VALUES (` and starts every term column at the
      same x as its `?name`.
    -->
    <div class="clause-grid" :style="gridStyle">
      <span class="lead kw">VALUES <span class="punct">(</span></span>
      <span v-for="name in variables" :key="name" class="var">?{{ name }}</span>
      <span class="punct">) {</span>
      <span></span>

      <template v-for="(row, rowIndex) in rows" :key="rowIndex">
        <span class="lead punct">(</span>
        <DropdownMenu v-for="name in variables" :key="name">
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="token"
              :class="{
                'token--undef': isUndef(cell(row, name)),
                'token--literal': cell(row, name).type === 'literal',
              }"
              :disabled="disabled"
              :title="`?${name} · ${termTypeLabel(cell(row, name))}`"
              data-testid="argument-clause-token"
            >{{ termToSparql(cell(row, name)) }}</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="token-menu">
            <div class="token-field" @click.stop @keydown.stop>
              <label class="token-field-label" :for="`token-${rowIndex}-${name}`">?{{ name }}</label>
              <input
                :id="`token-${rowIndex}-${name}`"
                type="text"
                class="token-field-control"
                data-testid="argument-clause-token-value"
                :placeholder="termPlaceholder(cell(row, name))"
                :value="cell(row, name).value"
                @input="setLexical(rowIndex, name, ($event.target as HTMLInputElement).value)"
              />
            </div>
            <DropdownMenuSeparator />
            <TermTypeMenuItems
              :value="cell(row, name)"
              :variable="name"
              @update="setTerm(rowIndex, name, $event)"
            />
          </DropdownMenuContent>
        </DropdownMenu>
        <span class="punct">)</span>
        <button
          type="button"
          class="row-remove"
          title="Remove row"
          :disabled="disabled"
          @click="emit('remove', rowIndex)"
        >
          <X :size="11" />
        </button>
      </template>

      <span class="lead"></span>
      <span class="span-rest">
        <button type="button" class="clause-add" :disabled="disabled" @click="emit('add')">
          <Plus :size="11" /> row
        </button>
        <span v-if="!rows.length" class="clause-view-empty">
          — no rows, so the clause is written empty and leaves this input open.
        </span>
      </span>

      <span class="lead punct">}</span>
      <span class="span-rest"></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Plus, X } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import TermTypeMenuItems from './TermTypeMenuItems.vue';
import type { ArgumentRow, SparqlValue } from '@/types/argument-sets';
import { isUndef, termPlaceholder, termToSparql, termTypeLabel } from '@/lib/argumentTerms';

/**
 * The clause as it will be sent, with every term a token you click to edit.
 *
 * There were two views of the same thing on screen — this form, and the
 * substituted query under it — and this collapses them: the form *is* the
 * preview. It also teaches the mechanism, because someone reading it can see
 * that arguments are `VALUES` rows rather than a settings panel.
 *
 * The cost, taken deliberately, is that an empty clause is a bare pair of
 * brackets; the stacked view stays the default for that reason.
 */
const props = defineProps<{
  variables: string[];
  rows: ArgumentRow[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:rows': [rows: ArgumentRow[]];
  add: [];
  remove: [index: number];
}>();

/**
 * Lead, one column per variable, then the closing bracket and the remove
 * button. `max-content` is what does the aligning: a column is as wide as the
 * widest of its variable name and its terms, so every row agrees.
 */
const gridStyle = computed(() => ({
  gridTemplateColumns: `max-content repeat(${props.variables.length}, max-content) max-content max-content`,
}));

function cell(row: ArgumentRow, name: string): SparqlValue {
  return row.values?.[name] ?? { type: 'uri', value: '' };
}

function write(rowIndex: number, name: string, value: SparqlValue) {
  emit(
    'update:rows',
    props.rows.map((row, at) =>
      at === rowIndex ? { ...row, values: { ...(row.values ?? {}), [name]: value } } : row,
    ),
  );
}

function setLexical(rowIndex: number, name: string, text: string) {
  write(rowIndex, name, { ...cell(props.rows[rowIndex], name), value: text });
}

function setTerm(rowIndex: number, name: string, value: SparqlValue) {
  write(rowIndex, name, value);
}
</script>

<style scoped>
.clause-view {
  /*
    The body of a VALUES block is indented under its header, and that indent
    aligns with the clause's own brackets rather than with the spacing scale.
  */
  --clause-indent: 14px;

  font-family: var(--font-mono);
  font-size: var(--text-micro);
  overflow-x: auto;
}

.clause-grid {
  display: grid;
  align-items: center;
  justify-content: start;
  column-gap: 8px;
  row-gap: 3px;
}

/* Right-aligned so every row's `(` lands under the `(` of `VALUES (`. */
.lead {
  justify-self: end;
  white-space: nowrap;
}

.kw {
  color: var(--ink-muted);
  font-weight: var(--weight-semibold);
}

.var {
  justify-self: start;
  padding: 0 var(--space-3);
  color: var(--action);
  white-space: nowrap;
}

.punct {
  color: var(--ink-muted);
}

.span-rest {
  display: flex;
  align-items: center;
  gap: 6px;
  grid-column: 2 / -1;
}

.clause-view-empty {
  font-family: var(--font-sans, inherit);
  color: var(--ink-muted);
}

.token {
  justify-self: stretch;
  height: 20px;
  max-width: 34ch;
  padding: 0 var(--space-3);
  overflow: hidden;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: text;
}

.token:hover:not(:disabled),
.token[data-state='open'] {
  border-color: var(--action);
  color: var(--ink);
}

.token--literal {
  color: var(--violet-500);
}

/* UNDEF is a value the clause really carries, so it is drawn faint, not absent. */
.token--undef {
  background: transparent;
  border-color: var(--border-subtle);
  color: var(--ink-muted);
}

.token:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.row-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-disabled);
  cursor: pointer;
}

.row-remove:hover:not(:disabled) {
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.row-remove:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.clause-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 var(--space-3);
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
}

.clause-add:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--ink);
}

.clause-add:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.token-menu {
  min-width: 240px;
}

.token-field {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  padding: var(--space-2) var(--space-4);
}

.token-field-label {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

.token-field-control {
  width: 100%;
  height: 24px;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
}

.token-field-control:focus {
  outline: none;
  border-color: var(--action);
}
</style>
