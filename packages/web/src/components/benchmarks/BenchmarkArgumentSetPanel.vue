<script setup lang="ts">
/**
 * The argument set, in the inspector's Arguments tab on Plan (§4, mockup 2a).
 *
 * A preview of the set's stored rows, so the values can be checked before a
 * long run is spent on them, and the cases that take them. The design's value
 * generators and seed settings have no server-side support, so they are not
 * drawn.
 */
import { computed } from 'vue';
import { Braces } from '@lucide/vue';
import InlineNote from '../shared/InlineNote.vue';
import type { ArgumentSetDetail } from '../../types/argument-sets';

const props = defineProps<{
  argumentSet: ArgumentSetDetail | null;
  loading: boolean;
  /** Cases in this benchmark that will receive these values. */
  usedBy: { id: string; name: string }[];
  /** Shown when the axis holds the no-arguments marker rather than a real set. */
  isNoArguments: boolean;
}>();

const PREVIEW_ROWS = 6;

const binding = computed(() => props.argumentSet?.currentVersion?.tupleBindings?.[0]
  ?? props.argumentSet?.tupleBindings?.[0]
  ?? null);

const variables = computed(() => binding.value?.variables ?? []);

const rows = computed(() => binding.value?.rows ?? []);

const preview = computed(() => rows.value.slice(0, PREVIEW_ROWS).map((row, index) => ({
  index: index + 1,
  cells: variables.value.map((variable) => row.values?.[variable]?.value ?? '—'),
})));

const remaining = computed(() => Math.max(0, rows.value.length - preview.value.length));

const scalars = computed(() => props.argumentSet?.currentVersion?.scalarBindings
  ?? props.argumentSet?.scalarBindings
  ?? []);
</script>

<template>
  <div class="argset-panel" data-testid="benchmark-argument-panel">
    <div class="panel-head">
      <Braces :size="13" class="head-icon" />
      <span class="head-title">
        {{ isNoArguments ? 'No arguments' : (argumentSet?.name ?? 'Argument set') }}
      </span>
      <span v-if="!isNoArguments && variables.length > 0" class="head-sub">
        bound to <span class="var-name">{{ variables.map((v) => `?${v}`).join(' ') }}</span>
      </span>
    </div>

    <div class="panel-body">
      <InlineNote v-if="isNoArguments">Each case runs once without arguments.</InlineNote>

      <template v-else-if="loading">
        <InlineNote>Loading the values…</InlineNote>
      </template>

      <template v-else-if="!argumentSet">
        <InlineNote>Select an argument set on the axis to see its values.</InlineNote>
      </template>

      <template v-else>


        <section class="block">
          <div class="block-head">
            <span class="block-label">Preview</span>
            <span class="block-sub">{{ rows.length }} {{ rows.length === 1 ? 'value' : 'values' }}</span>
          </div>
          <div v-if="preview.length > 0" class="preview">
            <div class="preview-head">
              <span class="preview-index">#</span>
              <span v-for="variable in variables" :key="variable" class="preview-cell preview-var">
                ?{{ variable }}
              </span>
            </div>
            <div v-for="row in preview" :key="row.index" class="preview-row">
              <span class="preview-index">{{ row.index }}</span>
              <span v-for="(cell, cellIndex) in row.cells" :key="cellIndex" class="preview-cell">
                {{ cell }}
              </span>
            </div>
            <div v-if="remaining > 0" class="preview-more">+ {{ remaining }} more</div>
          </div>
          <InlineNote v-else>This set holds no rows.</InlineNote>

          <div v-if="scalars.length > 0" class="scalars">
            <span v-for="scalar in scalars" :key="scalar.parameterName" class="scalar">
              {{ scalar.parameterKind }} {{ scalar.parameterName }} = {{ scalar.numericValue }}
            </span>
          </div>
        </section>

        <section class="block">
          <span class="block-label">Used by</span>
          <div v-if="usedBy.length > 0" class="used-list">
            <span v-for="item in usedBy" :key="item.id" class="used-row">{{ item.name }}</span>
          </div>
          <InlineNote v-else>No case in this benchmark takes these values.</InlineNote>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.argset-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 348px;
  min-height: 0;
  background: var(--surface);
  border-left: 1px solid var(--border-default);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  box-sizing: border-box;
  height: 40px;
  flex-shrink: 0;
  padding: 0 var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.head-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.head-title {
  overflow: hidden;
  color: var(--ink);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.head-sub {
  flex-shrink: 0;
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.var-name {
  color: var(--rdf-var);
  font-family: var(--font-mono);
}

.panel-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 15px;
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.block-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.block-label {
  color: var(--ink);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.block-sub {
  color: var(--ink-muted);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
}









.preview {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
}

.preview-head,
.preview-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--surface-sunken);
}

.preview-head {
  background: var(--surface-subtle);
  border-bottom-color: var(--border-subtle);
}

.preview-row:last-of-type {
  border-bottom: none;
}

.preview-index {
  flex-shrink: 0;
  width: 18px;
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-variant-numeric: tabular-nums;
}

.preview-cell {
  flex: 1;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.preview-var {
  color: var(--ink-muted);
  font-weight: var(--weight-semibold);
}

.preview-more {
  padding: var(--space-3) var(--space-4);
  background: var(--surface-subtle);
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.scalars {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.scalar {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-full);
  background: var(--surface-raised);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.used-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.used-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-panel);
  background: var(--surface-subtle);
  color: var(--ink);
  font-size: var(--text-label);
}
</style>
