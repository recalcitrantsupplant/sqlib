<template>
  <div class="try-it">
    <div class="controls">
      <div v-if="tupleFields.length === 0 && parameterFields.length === 0" class="no-args">
        No arguments — this callable takes none.
      </div>

      <!--
        A VALUES tuple is a repeatable row, not a flat field list: a caller
        supplying two products supplies two rows of (product, qty), and a
        single set of inputs could not express that.
      -->
      <div v-for="tuple in tupleFields" :key="tuple.id" class="tuple">
        <div class="tuple-head">
          <span class="field-label">{{ tuple.label }}</span>
          <button type="button" class="link-button" @click="addRow(tuple.id)">
            <Plus :size="11" />Add row
          </button>
        </div>
        <div v-for="(row, rowIndex) in rowsFor(tuple.id)" :key="rowIndex" class="tuple-row">
          <label v-for="member in tuple.members" :key="member" class="field">
            <span class="field-label">{{ member }}</span>
            <input
              v-model="row[member]"
              type="text"
              class="field-input"
              :data-arg="`${tuple.id}:${member}`"
            />
          </label>
          <button
            v-if="rowsFor(tuple.id).length > 1"
            type="button"
            class="remove-row"
            title="Remove row"
            @click="removeRow(tuple.id, rowIndex)"
          >
            <X :size="11" />
          </button>
        </div>
      </div>

      <label v-for="field in parameterFields" :key="field.name" class="field">
        <span class="field-label">
          {{ field.name }}
          <span v-if="field.defaultValue != null" class="field-default">
            default {{ field.defaultValue }}
          </span>
        </span>
        <input
          v-model="parameterValues[field.name]"
          type="number"
          class="field-input"
          :data-arg="field.name"
        />
      </label>
    </div>

    <div class="run-row">
      <button type="button" class="run-button" :disabled="running || !backendId" @click="run">
        <Play :size="12" />
        {{ callable.state === 'draft' ? 'Run draft' : 'Run' }}
      </button>

      <span v-if="running" class="status">Running…</span>
      <span v-else-if="error" class="status error">
        <TriangleAlert :size="11" />{{ error }}
      </span>
      <span v-else-if="result" class="status ok">
        <Check :size="11" />{{ resultSummary }}
      </span>

      <span class="target">
        <Database :size="11" />
        {{ backendName ?? 'No backend' }}
      </span>
    </div>

    <div v-if="bindings.length > 0" class="results">
      <div class="results-head" :style="gridStyle">
        <span v-for="variable in variables" :key="variable" class="cell head-cell">
          ?{{ variable }}
        </span>
      </div>
      <div v-for="(binding, index) in bindings" :key="index" class="results-row" :style="gridStyle">
        <span v-for="variable in variables" :key="variable" class="cell">
          {{ binding?.[variable]?.value ?? '' }}
        </span>
      </div>
    </div>

    <!--
      §9.2: a CONSTRUCT's triples and an ASK's single boolean are not the
      bindings grid, and pretending otherwise would misreport the result. Until
      those views are designed, show the payload rather than a wrong table.
    -->
    <pre v-else-if="rawResult" class="raw-result">{{ rawResult }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Play, Plus, X, Check, Database, TriangleAlert } from '@lucide/vue';
import { useApiClient } from '../../composables/useApiClient';
import { useLastExecutionError } from '../../composables/useLastExecutionError';
import type { Callable } from '../../lib/callables';

const props = defineProps<{
  callable: Callable;
  backendId: string | null;
  backendName: string | null;
}>();

const apiClient = useApiClient();
// So the assistant can be told what just failed, instead of being asked to
// guess from "it doesn't work" (#128 item 2).
const executionErrors = useLastExecutionError();

const running = ref(false);
const error = ref<string | null>(null);
const result = ref<unknown>(null);
const rawResult = ref<string | null>(null);
const elapsedMs = ref<number | null>(null);

const tupleFields = computed(() =>
  props.callable.inputTuples.map((tuple, index) => ({
    id: tuple.id,
    label: tuple.name ?? `Tuple ${index + 1}`,
    members: tuple.members.map((member) => member.variableName),
  }))
);

const parameterFields = computed(() => [
  ...props.callable.limitParameters,
  ...props.callable.offsetParameters,
]);

const tupleRows = reactive<Record<string, Array<Record<string, string>>>>({});
const parameterValues = reactive<Record<string, string>>({});

function blankRow(tupleId: string): Record<string, string> {
  const tuple = tupleFields.value.find((candidate) => candidate.id === tupleId);
  return Object.fromEntries((tuple?.members ?? []).map((member) => [member, '']));
}

function rowsFor(tupleId: string) {
  if (!tupleRows[tupleId]) tupleRows[tupleId] = [blankRow(tupleId)];
  return tupleRows[tupleId]!;
}

function addRow(tupleId: string) {
  rowsFor(tupleId).push(blankRow(tupleId));
}

function removeRow(tupleId: string, index: number) {
  rowsFor(tupleId).splice(index, 1);
}

// Switching rows resets the form; leaving one callable's arguments in another
// callable's fields would be worse than an empty form.
watch(
  () => props.callable.id,
  () => {
    for (const key of Object.keys(tupleRows)) delete tupleRows[key];
    for (const key of Object.keys(parameterValues)) delete parameterValues[key];
    result.value = null;
    rawResult.value = null;
    error.value = null;
    elapsedMs.value = null;
  }
);

const variables = computed<string[]>(() => {
  const head = (result.value as { head?: { vars?: string[] } } | null)?.head;
  return head?.vars ?? [];
});

const bindings = computed<Array<Record<string, { value: string }> | null>>(() => {
  const results = (result.value as { results?: { bindings?: unknown[] } } | null)?.results;
  return (results?.bindings ?? []) as Array<Record<string, { value: string }> | null>;
});

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${Math.max(variables.value.length, 1)}, minmax(0, 1fr))`,
}));

const resultSummary = computed(() => {
  const count = bindings.value.length;
  const rows = `${count} ${count === 1 ? 'row' : 'rows'}`;
  return elapsedMs.value == null ? rows : `${rows} · ${Math.round(elapsedMs.value)} ms`;
});

function buildArguments() {
  return tupleFields.value
    .map((tuple) => {
      const rows = rowsFor(tuple.id).filter((row) =>
        tuple.members.some((member) => (row[member] ?? '').trim() !== '')
      );
      if (rows.length === 0) return null;
      return {
        head: { vars: tuple.members },
        arguments: {
          bindings: rows.map((row) =>
            Object.fromEntries(
              tuple.members.map((member) => [
                member,
                { type: 'literal' as const, value: row[member] ?? '' },
              ])
            )
          ),
        },
      };
    })
    .filter((argument): argument is NonNullable<typeof argument> => argument !== null);
}

function buildParameters(names: string[]) {
  return names
    .map((name) => ({ name, value: Number(parameterValues[name]) }))
    .filter((entry) => Number.isInteger(entry.value) && entry.value >= 0);
}

async function run() {
  if (!props.backendId) return;
  running.value = true;
  error.value = null;
  result.value = null;
  rawResult.value = null;
  executionErrors.report(props.callable.id, null);

  try {
    const response = await apiClient.executeTarget({
      targetId: props.callable.id,
      backendId: props.backendId,
      arguments: buildArguments(),
      limits: buildParameters(props.callable.limitParameters.map((p) => p.name)),
      offsets: buildParameters(props.callable.offsetParameters.map((p) => p.name)),
    });

    elapsedMs.value =
      response.timing?.breakdown?.serverTotalMs ?? response.timing?.breakdown?.clientTotalMs ?? null;

    if (response.contentType?.includes('json')) {
      const parsed: unknown = JSON.parse(response.body);
      const hasBindings =
        typeof parsed === 'object' && parsed !== null && 'results' in parsed && 'head' in parsed;
      if (hasBindings) result.value = parsed;
      else rawResult.value = JSON.stringify(parsed, null, 2);
    } else {
      rawResult.value = response.body;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Execution failed';
    executionErrors.report(props.callable.id, error.value);
  } finally {
    running.value = false;
  }
}
</script>

<style scoped>
.try-it {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-4) var(--space-5);
}

.no-args {
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.tuple {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.tuple-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.tuple-row {
  display: flex;
  align-items: flex-end;
  gap: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 200px;
}

.field-label {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
}

.field-default {
  font-weight: var(--weight-normal);
  text-transform: none;
  letter-spacing: 0;
  color: var(--ink-muted);
}

.field-input {
  box-sizing: border-box;
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: var(--text-body);
  color: var(--ink);
}

.link-button,
.remove-row {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  font-size: var(--text-micro);
  color: var(--action);
  cursor: pointer;
}

.remove-row {
  height: var(--control-h);
  color: var(--ink-muted);
}

.run-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.run-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-h);
  padding: 0 var(--space-5);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  color: var(--ink);
  cursor: pointer;
}

.run-button:disabled {
  color: var(--ink-disabled);
  cursor: not-allowed;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.status.ok {
  color: var(--success-ink);
}

.status.error {
  color: var(--danger-ink);
}

.target {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
  font-size: var(--text-label);
  color: var(--ink-muted);
}

.results {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
}

.results-head,
.results-row {
  display: grid;
}

.results-head {
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.cell {
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-cell {
  font-weight: var(--weight-semibold);
  color: var(--ink-muted);
}

.raw-result {
  max-height: 240px;
  margin: 0;
  overflow: auto;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface-sunken);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  color: var(--ink);
}
</style>
