<script setup lang="ts">
/**
 * The argument set, in the inspector's Arguments tab on Plan (§4, mockup 2a).
 *
 * The piece with no precedent anywhere else in the app: where the values come
 * from, the seed that makes two runs comparable, and a preview of the actual
 * values so they can be seen before eleven minutes are spent on them.
 *
 * Stored sets are literal rows — a fixed list — and that is what this draws
 * from. The other four generators and the two reproducibility settings (seed,
 * resolve-once-per-run) are shown as the design specifies but disabled: there
 * is no server-side generator yet, and an enabled seed field that silently
 * changed nothing would be worse than an obviously absent one.
 */
import { computed } from 'vue';
import { Braces, Dices, FileCode2, List, MoveHorizontal, Table } from '@lucide/vue';
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

const GENERATORS = [
  { name: 'Fixed list', icon: List, available: true },
  { name: 'Range sweep', icon: MoveHorizontal, available: false },
  { name: 'Seeded random', icon: Dices, available: false },
  { name: 'From a query', icon: FileCode2, available: false },
  { name: 'CSV', icon: Table, available: false },
];
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
      <InlineNote v-if="isNoArguments">
        This axis entry runs each case once, unparameterised. It is a real axis
        member — a benchmark comparing "with arguments" against "without" is two
        entries, and the expansion count says so.
      </InlineNote>

      <template v-else-if="loading">
        <InlineNote>Loading the values…</InlineNote>
      </template>

      <template v-else-if="!argumentSet">
        <InlineNote>Select an argument set on the axis to see its values.</InlineNote>
      </template>

      <template v-else>
        <section class="block">
          <span class="block-label">Where the values come from</span>
          <div class="generator-row">
            <span
              v-for="generator in GENERATORS"
              :key="generator.name"
              class="generator"
              :class="{ 'generator-on': generator.available, 'generator-off': !generator.available }"
              :title="generator.available ? 'Stored values' : 'Not implemented server-side yet'"
            >
              <component :is="generator.icon" :size="12" />{{ generator.name }}
            </span>
          </div>
          <InlineNote>
            Drawing from a live query is the design's recommendation, because
            hand-written lists rot the moment the dataset moves and a benchmark
            quietly measuring 50 cache misses is worse than no benchmark. Only
            stored lists exist today.
          </InlineNote>
        </section>

        <section class="block">
          <div class="setting-row">
            <span class="setting" title="Not implemented server-side yet">
              <span class="setting-key">seed</span>
              <span class="setting-value">—</span>
            </span>
            <span class="setting" title="Stored values are the same for every store by construction">
              <span class="setting-key">resolve</span>
              <span class="setting-value">once per run</span>
            </span>
          </div>
          <InlineNote>
            Pinning a seed is what makes two runs comparable, and resolving once
            per run — not once per request — is what gives every store the
            identical values. A stored list satisfies both by construction; a
            generator would need them explicitly.
          </InlineNote>
        </section>

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
          <InlineNote>
            Argument sets are library objects, not properties of a case — that is
            what makes "same inputs, different case" possible.
          </InlineNote>
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

.generator-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.generator {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 27px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  font-size: var(--text-label);
  white-space: nowrap;
}

.generator-on {
  background: var(--action-surface);
  border-color: var(--action-border);
  color: var(--action-ink);
  font-weight: var(--weight-semibold);
}

.generator-off {
  background: var(--surface);
  color: var(--ink-muted);
}

.setting-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.setting {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: 27px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: var(--text-label);
}

.setting-key {
  color: var(--ink-muted);
}

.setting-value {
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-weight: var(--weight-medium);
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
