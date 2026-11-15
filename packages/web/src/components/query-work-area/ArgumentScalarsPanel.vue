<template>
  <section class="scalars" data-testid="argument-scalars">
    <header class="scalars-header">
      <span class="scalars-title">Scalars</span>
      <span class="scalars-count">{{ rows.length || 'none' }}</span>
    </header>

    <InlineNote v-if="rows.length === 0" size="xs" class="scalars-empty">
      No parameterised LIMIT or OFFSET clauses supplied. Parameterise with a
      leading <code class="hint-code">000</code> then an identifier — a LIMIT
      clause with identifier 1 has the signature
      <code class="hint-code">LIMIT 0001</code>.
    </InlineNote>

    <ul v-else class="scalars-list">
      <li
        v-for="row in rows"
        :key="`${row.parameterKind}-${row.parameterId}`"
        class="scalar-row"
        :data-testid="`argument-scalar-${row.parameterKind}-${row.parameterId}`"
      >
        <code class="scalar-clause">
          {{ row.parameterKind === 'limit' ? 'LIMIT' : 'OFFSET' }}
          <span class="scalar-zeros">000</span><span class="scalar-id">{{ row.parameterId }}</span>
        </code>
        <span
          v-if="lineFor(row)"
          class="clause-line"
          :title="`${row.parameterKind === 'limit' ? 'LIMIT' : 'OFFSET'} clause on line ${lineFor(row)}`"
        >L{{ lineFor(row) }}</span>
        <input
          type="number"
          min="0"
          class="cell-input cell-input--number"
          :aria-label="`${row.parameterKind === 'limit' ? 'LIMIT' : 'OFFSET'} 000${row.parameterId}`"
          :value="row.numericValue"
          :placeholder="row.parameterKind === 'limit' ? '100' : '0'"
          :disabled="disabled"
          @input="updateValue(row, ($event.target as HTMLInputElement).value)"
        />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ArgumentScalarBinding } from '@/types/argument-sets';
import { scalarKey } from '@/lib/argumentSignature';
import InlineNote from '../shared/InlineNote.vue';

/**
 * The query's LIMIT / OFFSET parameters and the numbers filling them.
 *
 * One group for both, rather than a card each: they are the query's scalars,
 * they are always at most a handful, and a card apiece pushed the VALUES
 * clauses — the part anyone actually edits — below the fold.
 *
 * The stored shape is kept as `{kind, name, value}` so the panel edits the
 * record rather than a flattened version of it (design §6).
 *
 * Each row reads as the clause is written in the query, `LIMIT 0001`, with
 * the line it is on where the caller knows it. The name is the query's, so it
 * is shown and not edited: a renamed binding matched no parameter.
 */
const props = defineProps<{
  /** Parameter ids as detection reports them, in query order. */
  limitParameters: string[];
  offsetParameters: string[];
  modelValue: ArgumentScalarBinding[];
  disabled?: boolean;
  /** 1-based line of each clause, keyed by `scalarKey`; see `buildQuerySignature`. */
  lines?: Record<string, number>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: ArgumentScalarBinding[]];
}>();

interface ScalarRow extends ArgumentScalarBinding {
  parameterId: string;
}

/**
 * Rows are driven by the query, not by what is stored.
 *
 * A set carrying a value for a parameter the query no longer declares must not
 * grow a row for it — that is a value with nowhere to go, and showing it invites
 * someone to edit it. It stays in the record until the set is saved again.
 */
const rows = computed<ScalarRow[]>(() => {
  const build = (parameterKind: 'limit' | 'offset', ids: string[]) =>
    ids.map((parameterId) => {
      const stored = props.modelValue.find(
        (binding) => binding.parameterKind === parameterKind && binding.parameterName === parameterId,
      );
      return {
        parameterId,
        parameterKind,
        parameterName: stored?.parameterName ?? parameterId,
        numericValue: stored?.numericValue ?? (parameterKind === 'limit' ? 100 : 0),
      } satisfies ScalarRow;
    });

  return [...build('limit', props.limitParameters), ...build('offset', props.offsetParameters)];
});

function write(row: ScalarRow, patch: Partial<ArgumentScalarBinding>) {
  const next = props.modelValue.filter(
    (binding) =>
      !(binding.parameterKind === row.parameterKind && binding.parameterName === row.parameterName),
  );
  next.push({
    parameterKind: row.parameterKind,
    parameterName: row.parameterName,
    numericValue: row.numericValue,
    ...patch,
  });
  emit('update:modelValue', next);
}

function lineFor(row: ScalarRow): number | undefined {
  return props.lines?.[scalarKey(row.parameterKind, row.parameterId)];
}

function updateValue(row: ScalarRow, value: string) {
  const parsed = Number(value);
  write(row, { numericValue: Number.isFinite(parsed) ? parsed : 0 });
}
</script>

<style scoped>
.scalars {
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}

.scalars-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: var(--space-3) var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.scalars-title {
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
}

.scalars-count {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

/* The signature is machine text and reads as such, inline in the sentence. */
.hint-code {
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
}

.scalars-empty {
  padding: var(--space-4) var(--space-5);
}

.scalars-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.scalar-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.scalar-row:last-child {
  border-bottom: none;
}

.scalar-clause {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-secondary);
}

.scalar-zeros {
  color: var(--ink-muted);
}

.scalar-id {
  color: var(--ink);
  font-weight: var(--weight-semibold);
}

.clause-line {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-muted);
  background: var(--surface-raised);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-2);
}


.cell-input {
  width: 110px;
  margin-left: auto;
  height: 24px;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
}

.cell-input--number {
  text-align: right;
  font-family: var(--font-mono);
  font-size: var(--text-micro);
}

.cell-input:focus {
  outline: none;
  border-color: var(--action);
}

.cell-input:disabled {
  background: var(--surface-subtle);
  cursor: not-allowed;
}
</style>
