<template>
  <div class="grid-wrap">
    <div ref="scrollRef" class="grid-scroll">
      <table class="values-grid" :style="gridStyle" :data-testid="testids">
        <!--
          Column widths belong to the table, not to whichever cell happened to
          be measured first. With `table-layout: fixed` these `col` elements are
          the only thing that sets them, so a header can no longer come out a
          different width from the body under it.
        -->
        <colgroup>
          <col class="col-index" />
          <col v-for="name in variables" :key="name" class="col-var" />
          <col class="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th class="grid-corner"></th>
            <!--
              A slot, because a tuple set authors its own column names where a
              query's are given by its VALUES clause. Everything below the head
              — the keys, the paste, the type badges — is the same editor.
            -->
            <th v-for="name in variables" :key="name" class="grid-head" :title="`?${name}`">
              <!--
                `column`, not `name`: a `:name` binding on a `<slot>` is read as
                a *dynamic slot name*, so the slot silently became one called
                "city" and rendered its fallback instead.
              -->
              <slot name="column-head" :column="name">?{{ name }}</slot>
            </th>
            <th class="grid-actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in rows" :key="rowIndex" :data-testid="`${testids}-row`">
            <td class="grid-index">{{ rowIndex + 1 }}</td>
            <td
              v-for="(name, colIndex) in variables"
              :key="name"
              class="grid-cell"
              :class="{
                'grid-cell--focused': focused?.row === rowIndex && focused?.col === colIndex,
                'grid-cell--undef': isUndef(cell(row, name)),
              }"
            >
              <input
                :ref="(el) => registerCell(el, rowIndex, colIndex)"
                type="text"
                class="grid-input"
                :data-testid="`${testids}-cell`"
                :data-row="rowIndex"
                :data-col="colIndex"
                :value="cell(row, name).value"
                :placeholder="focused?.row === rowIndex && focused?.col === colIndex ? termPlaceholder(cell(row, name)) : 'UNDEF'"
                :disabled="disabled"
                @focus="focused = { row: rowIndex, col: colIndex }"
                @blur="onBlur(rowIndex, name)"
                @input="setLexical(rowIndex, name, ($event.target as HTMLInputElement).value)"
                @keydown="onKeydown($event, rowIndex, colIndex)"
                @paste="onPaste($event, rowIndex, colIndex)"
              />

              <!--
                The type badge is the menu's trigger and the cell's only other
                control. It reads `IRI` / `xsd:integer` / `@en`, so a grid of
                bare text never hides what a term actually is.
              -->
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button
                    type="button"
                    class="grid-type"
                    :class="{ 'grid-type--literal': cell(row, name).type === 'literal' }"
                    :disabled="disabled"
                    :title="`Term type · ?${name}`"
                    :data-testid="`${testids}-type`"
                  >
                    {{ termTypeLabel(cell(row, name)) }}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="grid-type-menu">
                  <TermTypeMenuItems
                    :value="cell(row, name)"
                    :variable="name"
                    @update="setTerm(rowIndex, name, $event)"
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </td>
            <td class="grid-actions">
              <button
                type="button"
                class="btn-cell"
                title="Duplicate row"
                :disabled="disabled"
                @click="emit('duplicate', rowIndex)"
              >
                <CopyPlus :size="12" />
              </button>
              <button
                type="button"
                class="btn-cell btn-cell--danger"
                title="Remove row"
                :disabled="disabled"
                :data-testid="`${testids}-remove-row`"
                @click="emit('remove', rowIndex)"
              >
                <Trash2 :size="12" />
              </button>
            </td>
          </tr>

          <!-- The last line of the grid is the way to grow it, as a sheet's is. -->
          <tr class="grid-new">
            <td class="grid-index">
              <Plus :size="10" />
            </td>
            <td
              :colspan="variables.length + 1"
              class="grid-new-cell"
              @click="!disabled && emit('add')"
            >
              New row
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!--
      A keyboard grid holds one control per cell, so the type of the value being
      typed has nowhere to live in the cell itself. It lives here, on the cell
      that has focus, which is also where the paste and navigation keys are
      worth saying out loud.
    -->
    <p class="grid-status" :data-testid="`${testids}-status`">
      <template v-if="focusedTerm">
        <span class="grid-status-var">?{{ variables[focused!.col] }}</span>
        <span class="grid-status-type">{{ termTypeLabel(focusedTerm) }}</span>
        <span class="grid-status-hint">↑↓ move · Enter next row · ⌘V pastes a block</span>
      </template>
      <template v-else>Type a value; ⌘V pastes rows of TSV or CSV. Blank cells bind UNDEF.</template>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { CopyPlus, Plus, Trash2 } from '@lucide/vue';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import TermTypeMenuItems from './TermTypeMenuItems.vue';
import type { ArgumentRow, SparqlValue } from '@/types/argument-sets';
import {
  inferTerm,
  isUndef,
  parsePastedRows,
  termPlaceholder,
  termTypeLabel,
} from '@/lib/argumentTerms';

/**
 * The rows of one VALUES clause as a spreadsheet.
 *
 * Filling twelve bindings should be typing, not twelve trips through a
 * dropdown, so every cell is a plain text box and the keys behave the way a
 * sheet's do: arrows move, Enter drops to the next row and grows the grid at
 * the bottom, and a paste spills across the block it was cut from. What a
 * grid gives up is the room to show each term's type beside it, so the type is
 * a badge on the cell and a status line under the grid (mockup option 1b).
 */
const props = withDefaults(defineProps<{
  variables: string[];
  rows: ArgumentRow[];
  disabled?: boolean;
  /**
   * Stem for this grid's test ids, so a host that has its own spec vocabulary
   * keeps it — the tuple set builder's rows have been `builder-row` since long
   * before they were drawn by this component.
   */
  testids?: string;
}>(), { testids: 'argument-grid' });

const emit = defineEmits<{
  /** The whole row list, already rewritten — the caller owns positions. */
  'update:rows': [rows: ArgumentRow[]];
  add: [];
  duplicate: [index: number];
  remove: [index: number];
}>();

const scrollRef = ref<HTMLElement | null>(null);

/**
 * Fixed layout splits the free width equally between the term columns, and the
 * floor keeps them readable: past about six variables the table outgrows the
 * panel and the wrapper scrolls, which is the trade a grid is here to make.
 */
const MIN_TERM_COLUMN = 150;
const CHROME_COLUMNS = 30 + 52;

const gridStyle = computed(() => ({
  minWidth: `${CHROME_COLUMNS + props.variables.length * MIN_TERM_COLUMN}px`,
}));
const focused = ref<{ row: number; col: number } | null>(null);
const inputs = new Map<string, HTMLInputElement>();

/**
 * Cells whose term type the author set by hand.
 *
 * Inference is a convenience for values that arrive as bare text, and it must
 * never argue with someone who has already said what a term is. A cell that
 * carries anything other than a fresh blank cell's `uri` is taken as decided,
 * and one decided through the menu is remembered here.
 */
const decided = ref(new Set<string>());
const key = (row: number, name: string) => `${row}:${name}`;

const focusedTerm = computed<SparqlValue | null>(() => {
  const at = focused.value;
  if (!at) return null;
  const row = props.rows[at.row];
  const name = props.variables[at.col];
  if (!row || !name) return null;
  return cell(row, name);
});

function cell(row: ArgumentRow, name: string): SparqlValue {
  return row.values?.[name] ?? { type: 'uri', value: '' };
}

function registerCell(el: unknown, row: number, col: number) {
  const id = `${row}/${col}`;
  if (el instanceof HTMLInputElement) inputs.set(id, el);
  else inputs.delete(id);
}

function writeCells(patches: Array<{ row: number; name: string; value: SparqlValue }>) {
  const next = props.rows.map((row) => ({ ...row, values: { ...(row.values ?? {}) } }));
  // A paste can land past the last row; the clause is grown to hold it rather
  // than the overflow being dropped silently.
  for (const patch of patches) {
    while (next.length <= patch.row) {
      next.push({
        values: Object.fromEntries(props.variables.map((name) => [name, { type: 'uri', value: '' }])),
      });
    }
    next[patch.row].values[patch.name] = patch.value;
  }
  emit('update:rows', next);
}

function setLexical(row: number, name: string, text: string) {
  const current = props.rows[row] ? cell(props.rows[row], name) : { type: 'uri' as const, value: '' };
  writeCells([{ row, name, value: { ...current, value: text } }]);
}

function setTerm(row: number, name: string, value: SparqlValue) {
  decided.value.add(key(row, name));
  writeCells([{ row, name, value }]);
}

/** Typed text is read for what it is only once the author has left the cell. */
function onBlur(row: number, name: string) {
  if (focused.value?.row === row && props.variables[focused.value.col] === name) focused.value = null;
  const current = props.rows[row] ? cell(props.rows[row], name) : null;
  if (!current || decided.value.has(key(row, name))) return;
  if (current.type !== 'uri' || current.datatype || current['xml:lang']) return;
  const inferred = inferTerm(current.value);
  if (inferred.type === current.type && inferred.value === current.value && !inferred.datatype) return;
  writeCells([{ row, name, value: inferred }]);
}

async function focusCell(row: number, col: number) {
  await nextTick();
  inputs.get(`${row}/${col}`)?.focus();
  inputs.get(`${row}/${col}`)?.select();
}

function onKeydown(event: KeyboardEvent, row: number, col: number) {
  if (event.key === 'ArrowUp' && row > 0) {
    event.preventDefault();
    void focusCell(row - 1, col);
  } else if (event.key === 'ArrowDown' && row + 1 < props.rows.length) {
    event.preventDefault();
    void focusCell(row + 1, col);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (row + 1 < props.rows.length) {
      void focusCell(row + 1, col);
    } else if (!props.disabled) {
      // Enter on the last row is how a sheet grows: no reaching for Add row.
      emit('add');
      void focusCell(row + 1, col);
    }
  } else if (event.key === 'Escape') {
    (event.target as HTMLInputElement).blur();
  }
}

/**
 * A paste fills the block it was copied from, starting at this cell.
 *
 * Single-cell pastes fall through to the browser so that editing part of a
 * value still works; anything with a tab or a newline in it is a block.
 */
function onPaste(event: ClipboardEvent, row: number, col: number) {
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
  event.preventDefault();
  if (props.disabled) return;

  const block = parsePastedRows(text);
  const patches: Array<{ row: number; name: string; value: SparqlValue }> = [];
  block.forEach((cells, rowOffset) => {
    cells.forEach((value, colOffset) => {
      const name = props.variables[col + colOffset];
      if (!name) return; // Wider than the clause: the extra columns have nowhere to go.
      const at = row + rowOffset;
      decided.value.add(key(at, name));
      patches.push({ row: at, name, value: inferTerm(value) });
    });
  });
  writeCells(patches);
}
</script>

<style scoped>
.grid-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/*
  Horizontal scroll rather than a width limit: a grid is the view that is meant
  to survive eight variables, and squeezing them is what the stacked view is
  already for.
*/
.grid-scroll {
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

/*
  `values-grid`, never `grid`: Tailwind ships a `.grid { display: grid }`
  utility, and a table wearing that class stops being a table — thead and tbody
  become blocks and lay their columns out independently, which is exactly the
  header-misaligned-from-body bug this had. The scoped attribute does not save
  you; the utility has the same specificity and wins on source order.
*/
.values-grid {
  table-layout: fixed;
  border-collapse: collapse;
  width: 100%;
}

.col-index {
  width: 30px;
}

.col-actions {
  width: 52px;
}

.grid-head {
  height: 24px;
  padding: 0 var(--space-3);
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--surface-subtle);
  border-right: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-default);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  font-weight: 500;
  color: var(--ink-muted);
}

.grid-corner,
.grid-index {
  text-align: center;
  background: var(--surface-subtle);
  border-right: 1px solid var(--border-default);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.grid-corner {
  border-bottom: 1px solid var(--border-default);
}

.grid-cell {
  /* The room the type badge sits in, so a long value never runs under it. */
  --grid-type-gutter: 34px;

  position: relative;
  padding: 0;
  border-right: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.grid-cell--focused {
  box-shadow: inset 0 0 0 2px var(--action);
}

.grid-input {
  width: 100%;
  height: 24px;
  padding: 0 var(--grid-type-gutter) 0 var(--space-3);
  border: none;
  background: transparent;
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
}

.grid-input:focus {
  outline: none;
}

.grid-input::placeholder {
  color: var(--ink-muted);
}

.grid-cell--undef .grid-input {
  font-style: italic;
}

.grid-type {
  position: absolute;
  top: 3px;
  right: 3px;
  height: 18px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: var(--text-micro);
  cursor: pointer;
}

.grid-cell:hover .grid-type,
.grid-cell--focused .grid-type {
  background: var(--surface-subtle);
  color: var(--ink-muted);
}

.grid-type--literal {
  color: var(--violet-500);
}

.grid-type:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.grid-type-menu {
  min-width: 190px;
}

.grid-actions {
  white-space: nowrap;
  text-align: center;
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.btn-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-disabled);
  cursor: pointer;
}

.btn-cell:hover:not(:disabled) {
  background: var(--surface-raised);
  color: var(--ink);
}

.btn-cell--danger:hover:not(:disabled) {
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.btn-cell:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.grid-new .grid-index {
  color: var(--ink-muted);
}

.grid-new-cell {
  height: 22px;
  padding: 0 var(--space-3);
  background: var(--surface-subtle);
  color: var(--ink-muted);
  font-size: var(--text-micro);
  cursor: pointer;
}

.grid-new-cell:hover {
  color: var(--ink);
}

.grid-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.grid-status-var {
  font-family: var(--font-mono);
  color: var(--ink-secondary);
}

.grid-status-type {
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
}
</style>
