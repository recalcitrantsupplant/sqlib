<template>
  <div class="signature" :class="`signature-${side}`">
    <!--
      The rail. On the inputs side it is the literal label IN; on the returns
      side it is the result kind itself.

      The kind-as-rail-label replaced a pill badge, and the reason matters: a
      badge sat on its own line and made row heights irregular. The rail costs
      no height, lands in the same place on every row, and is faster to scan
      down a list. Do not reintroduce a kind badge (§5.3).
    -->
    <span class="rail" :style="side === 'returns' ? { color: kindColor } : undefined">
      {{ side === 'inputs' ? 'IN' : kind }}
    </span>

    <span v-if="!stacked" class="summary">{{ summary }}</span>

    <div v-else class="stacked" :class="{ columns: entries.length > 4 }">
      <div v-for="entry in shown" :key="entry.key" class="entry">
        <span class="entry-name">{{ entry.name }}</span>
        <span v-if="entry.datatype" class="entry-type">{{ entry.datatype }}</span>
        <span v-if="entry.qualifier" class="entry-qualifier">{{ entry.qualifier }}</span>
      </div>
      <button v-if="hidden > 0" type="button" class="show-all" @click="showAll = true">
        Show all {{ entries.length }} {{ side === 'inputs' ? 'inputs' : 'outputs' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { inputSummary, outputSummary, type Callable, type ResultKind } from '../../lib/callables';

const props = defineProps<{
  callable: Callable;
  side: 'inputs' | 'returns';
  stacked: boolean;
}>();

/** Past this many, a tower of one-per-line is worse than a truncated list. */
const CAP = 8;

const showAll = ref(false);

const KIND_COLOURS: Record<ResultKind, string> = {
  BINDINGS: 'var(--kind-bindings)',
  BOOLEAN: 'var(--kind-boolean)',
  GRAPH: 'var(--kind-graph)',
  UPDATE: 'var(--kind-update)',
};

const kind = computed(() => props.callable.resultKind);
const kindColor = computed(() => KIND_COLOURS[props.callable.resultKind]);

const summary = computed(() =>
  props.side === 'inputs' ? inputSummary(props.callable) : outputSummary(props.callable)
);

interface Entry {
  key: string;
  name: string;
  datatype: string | null;
  qualifier: string | null;
}

const entries = computed<Entry[]>(() => {
  if (props.side === 'inputs') {
    const tupleEntries = props.callable.inputTuples.flatMap((tuple, tupleIndex) =>
      tuple.members.map((member, memberIndex) => ({
        key: `${tuple.id}:${memberIndex}`,
        name: member.variableName,
        datatype: member.datatype,
        /*
         * A tuple member is only worth labelling as one when it has company:
         * on a single-member tuple "tuple 1" is noise, but on a two-member
         * tuple it is the thing that says both values go in the same row.
         */
        qualifier: tuple.members.length > 1 ? `tuple ${tupleIndex + 1}` : null,
      }))
    );

    const parameters = [
      ...props.callable.limitParameters.map((parameter) => ({ parameter, kind: 'LIMIT' })),
      ...props.callable.offsetParameters.map((parameter) => ({ parameter, kind: 'OFFSET' })),
    ].map(({ parameter, kind: parameterKind }) => ({
      key: `${parameterKind}:${parameter.name}`,
      name: parameter.name,
      datatype: 'xsd:integer',
      qualifier:
        parameter.defaultValue != null ? `default ${parameter.defaultValue}` : parameterKind,
    }));

    return [...tupleEntries, ...parameters];
  }

  if (props.callable.resultKind === 'BOOLEAN') {
    return [{ key: 'boolean', name: 'true / false', datatype: 'xsd:boolean', qualifier: null }];
  }
  if (props.callable.resultKind === 'GRAPH') {
    return [{ key: 'graph', name: '?s ?p ?o', datatype: 'triples', qualifier: null }];
  }

  return props.callable.outputs.map((output) => ({
    key: output.variableName,
    name: output.variableName,
    datatype: null,
    qualifier: output.description,
  }));
});

const shown = computed(() => (showAll.value ? entries.value : entries.value.slice(0, CAP)));
const hidden = computed(() => entries.value.length - shown.value.length);
</script>

<style scoped>
/*
 * Each signature cell is a two-track grid: a fixed rail, then the content.
 * The rail widths differ because the labels do — IN is two characters and
 * BINDINGS is eight — and both must land in the same place on every row.
 */
.signature {
  display: grid;
  gap: 0 10px;
  align-items: start;
  min-width: 0;
  padding: var(--space-4) var(--space-5);
  border-left: 1px solid var(--border-subtle);
}

.signature-inputs {
  grid-template-columns: 26px minmax(0, 1fr);
}

.signature-returns {
  grid-template-columns: 60px minmax(0, 1fr);
}

.rail {
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.07em;
  line-height: 17px;
  color: var(--ink-muted);
}

.summary {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-label);
  line-height: 17px;
  color: var(--ink-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stacked {
  display: grid;
  gap: var(--space-1) var(--space-5);
  min-width: 0;
}

/*
 * Two columns past four entries, driven by ENTRY COUNT rather than by
 * auto-fit. auto-fit is width-driven and happily gives two columns to two
 * entries, which reads as a bug; this way a ten-input signature is about four
 * lines instead of a ten-line tower (§5.3).
 */
.stacked.columns {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.entry {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  min-width: 0;
  line-height: 17px;
}

.entry-name {
  font-family: var(--font-mono);
  font-size: var(--text-label);
  color: var(--ink);
  white-space: nowrap;
}

.entry-type {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-muted);
  white-space: nowrap;
}

.entry-qualifier {
  min-width: 0;
  font-size: var(--text-micro);
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.show-all {
  justify-self: start;
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  font-size: var(--text-micro);
  color: var(--action);
  cursor: pointer;
}

.show-all:hover {
  text-decoration: underline;
}
</style>
