<script setup lang="ts">
/**
 * The middle column of the Plan tab for everything that is not a case.
 *
 * Selecting an axis or a setting in the plan opens its form here. The axes edit
 * membership — which backends, which argument sets, what load — and the
 * settings edit policy, which never multiplies and so has no membership to
 * edit.
 *
 * Statistic and Equivalence are drawn but not writable. p50/p95/p99 is computed
 * from the captured requests on the way out, so it is a real reading of real
 * data with nothing to store; equivalence has no result hash behind it yet, so
 * a reference picker here would be a control that changes nothing.
 */
import { computed, ref } from 'vue';
import type { AxisKey, PickerOption, SettingKey } from '../../lib/benchmarkViews';
import type { PlanSettings } from '../../lib/benchmarkPlan';
import { NO_ARGUMENTS_IRI } from '../../lib/benchmarkPlan';
import { fuzzyFilter } from '../../lib/fuzzy';
import FilterBox from '../shared/FilterBox.vue';
import InlineNote from '../shared/InlineNote.vue';

const props = defineProps<{
  kind: AxisKey | 'setting';
  settingKey: SettingKey | null;
  editable: boolean;
  backendOptions: PickerOption[];
  selectedBackendIds: string[];
  argumentOptions: PickerOption[];
  selectedArgumentIds: string[];
  /** The rule-set tabular axis: tuple sets, offered library-wide. */
  tupleSetOptions: PickerOption[];
  selectedTupleSetIds: string[];
  /** The rule-set graph axis: the base graphs a rule set runs over. */
  dataGraphOptions: PickerOption[];
  selectedDataGraphIds: string[];
  settings: PlanSettings;
}>();

const emit = defineEmits<{
  (e: 'toggle-backend', id: string): void;
  (e: 'toggle-argument', id: string): void;
  (e: 'toggle-tuple-set', id: string): void;
  (e: 'toggle-data-graph', id: string): void;
  (e: 'update-setting', patch: Partial<PlanSettings>): void;
}>();

const title = computed(() => {
  if (props.kind === 'backends') return 'Backends';
  if (props.kind === 'argumentSets') return 'Argument sets';
  if (props.kind === 'tupleSets') return 'Tuple sets';
  if (props.kind === 'dataGraphs') return 'Data graphs';
  if (props.kind === 'loadProfiles') return 'Load profile';
  switch (props.settingKey) {
    case 'statistic': return 'Statistic';
    case 'equivalence': return 'Equivalence';
    case 'failure': return 'Failure policy';
    case 'order': return 'Execution order';
    default: return 'Settings';
  }
});

/*
 * Every axis is a list of hand-named library entities, and a library with
 * thirty data graphs made picking three of them a scroll. Same fuzzy rule as
 * the choosers (`lib/fuzzy`); the box only appears once the list is long enough
 * that reading it is the slow part.
 */
const FILTER_FROM = 5;
const backendFilter = ref('');
const argumentFilter = ref('');
const tupleSetFilter = ref('');
const dataGraphFilter = ref('');

const ranked = (query: string, options: PickerOption[]) =>
  fuzzyFilter(query, options, (option) => option.name).map(({ item }) => item);

const visibleBackends = computed(() => ranked(backendFilter.value, props.backendOptions));
const visibleArguments = computed(() => ranked(argumentFilter.value, props.argumentOptions));
const visibleTupleSets = computed(() => ranked(tupleSetFilter.value, props.tupleSetOptions));
const visibleDataGraphs = computed(() => ranked(dataGraphFilter.value, props.dataGraphOptions));

function number(event: Event): number | null {
  const raw = (event.target as HTMLInputElement).value;
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
</script>

<template>
  <div class="plan-detail" data-testid="benchmark-plan-detail">
    <h2 class="detail-title">{{ title }}</h2>

    <!-- Backends -------------------------------------------------- -->
    <section v-if="kind === 'backends'" class="block">
      <InlineNote>Backends attached to this library. Manage them on the Backends screen.</InlineNote>
      <FilterBox
        v-if="backendOptions.length > FILTER_FROM"
        v-model="backendFilter"
        class="axis-filter"
        placeholder="Filter backends…"
        test-id="benchmark-backend-filter"
      />
      <div class="option-list">
        <label v-for="option in visibleBackends" :key="option.id" class="option">
          <input
            type="checkbox"
            :checked="selectedBackendIds.includes(option.id)"
            :disabled="!editable"
            @change="emit('toggle-backend', option.id)"
          />
          <span class="option-dot" :style="{ background: option.dot ?? 'var(--border-strong)' }" />
          <span class="option-name">{{ option.name }}</span>
          <span v-if="option.meta" class="option-meta">{{ option.meta }}</span>
        </label>
        <InlineNote v-if="backendOptions.length === 0">No backends yet.</InlineNote>
      </div>
      <InlineNote>With none selected, each case runs on its query's default backend.</InlineNote>
    </section>

    <!-- Argument sets --------------------------------------------- -->
    <section v-else-if="kind === 'argumentSets'" class="block">
      <InlineNote>Each set applies only to the cases whose query declares its variables.</InlineNote>
      <FilterBox
        v-if="argumentOptions.length > FILTER_FROM"
        v-model="argumentFilter"
        class="axis-filter"
        placeholder="Filter argument sets…"
        test-id="benchmark-argument-filter"
      />
      <div class="option-list">
        <label class="option">
          <input
            type="checkbox"
            :checked="selectedArgumentIds.includes(NO_ARGUMENTS_IRI)"
            :disabled="!editable"
            @change="emit('toggle-argument', NO_ARGUMENTS_IRI)"
          />
          <span class="option-dot option-dot-empty" />
          <span class="option-name">No arguments</span>
          <span class="option-meta">run each case once</span>
        </label>
        <label v-for="option in visibleArguments" :key="option.id" class="option">
          <input
            type="checkbox"
            :checked="selectedArgumentIds.includes(option.id)"
            :disabled="!editable"
            @change="emit('toggle-argument', option.id)"
          />
          <span class="option-dot" :style="{ background: option.dot ?? 'var(--border-strong)' }" />
          <span class="option-name">{{ option.name }}</span>
          <span v-if="option.meta" class="option-meta">{{ option.meta }}</span>
        </label>
        <InlineNote v-if="argumentOptions.length === 0">
          None of this benchmark's cases has an argument set yet.
        </InlineNote>
      </div>
    </section>

    <!-- Tuple sets ------------------------------------------------- -->
    <section v-else-if="kind === 'tupleSets'" class="block">
      <InlineNote>A tuple set replaces the seeds stored in the rule-set version, for this run only.</InlineNote>
      <FilterBox
        v-if="tupleSetOptions.length > FILTER_FROM"
        v-model="tupleSetFilter"
        class="axis-filter"
        placeholder="Filter tuple sets…"
        test-id="benchmark-tuple-set-filter"
      />
      <div class="option-list">
        <label class="option">
          <input
            type="checkbox"
            :checked="selectedTupleSetIds.includes(NO_ARGUMENTS_IRI)"
            :disabled="!editable"
            @change="emit('toggle-tuple-set', NO_ARGUMENTS_IRI)"
          />
          <span class="option-dot option-dot-empty" />
          <span class="option-name">Stored seeds</span>
          <span class="option-meta">use the version's own seeds</span>
        </label>
        <label v-for="option in visibleTupleSets" :key="option.id" class="option">
          <input
            type="checkbox"
            :checked="selectedTupleSetIds.includes(option.id)"
            :disabled="!editable"
            @change="emit('toggle-tuple-set', option.id)"
          />
          <span class="option-dot" :style="{ background: option.dot ?? 'var(--border-strong)' }" />
          <span class="option-name">{{ option.name }}</span>
          <span v-if="option.meta" class="option-meta">{{ option.meta }}</span>
        </label>
        <InlineNote v-if="tupleSetOptions.length === 0">
          No tuple sets in the library yet.
        </InlineNote>
      </div>
      <InlineNote>The run records which tuple-set version it used.</InlineNote>
    </section>

    <!-- Data graphs ------------------------------------------------ -->
    <section v-else-if="kind === 'dataGraphs'" class="block">
      <InlineNote>The base graph each rule set runs over.</InlineNote>
      <FilterBox
        v-if="dataGraphOptions.length > FILTER_FROM"
        v-model="dataGraphFilter"
        class="axis-filter"
        placeholder="Filter data graphs…"
        test-id="benchmark-data-graph-filter"
      />
      <div class="option-list">
        <label v-for="option in visibleDataGraphs" :key="option.id" class="option">
          <input
            type="checkbox"
            :checked="selectedDataGraphIds.includes(option.id)"
            :disabled="!editable"
            @change="emit('toggle-data-graph', option.id)"
          />
          <span class="option-dot" :style="{ background: option.dot ?? 'var(--border-strong)' }" />
          <span class="option-name">{{ option.name }}</span>
          <span v-if="option.meta" class="option-meta">{{ option.meta }}</span>
        </label>
        <InlineNote v-if="dataGraphOptions.length === 0">
          No data graphs in the library yet.
        </InlineNote>
      </div>
      <InlineNote>
        With none selected, each rule set runs on an empty graph. Graphs multiply
        with tuple sets: three graphs and two tuple sets give six runs.
      </InlineNote>
    </section>

    <!-- Load profile ---------------------------------------------- -->
    <section v-else-if="kind === 'loadProfiles'" class="block">
      <div class="field-grid">
        <label class="field">
          <span class="field-label">Warmup runs</span>
          <input
            class="field-input"
            type="number"
            min="0"
            :value="settings.warmupRuns ?? ''"
            :disabled="!editable"
            @change="emit('update-setting', { warmupRuns: number($event) })"
          />
          <span class="field-hint">discarded</span>
        </label>
        <label class="field">
          <span class="field-label">Measured runs</span>
          <input
            class="field-input"
            type="number"
            min="1"
            :value="settings.repeats ?? ''"
            :disabled="!editable"
            @change="emit('update-setting', { repeats: number($event) })"
          />
          <span class="field-hint">per request</span>
        </label>
        <label class="field">
          <span class="field-label">Clients</span>
          <input
            class="field-input"
            type="number"
            min="1"
            :value="settings.maxConcurrency ?? ''"
            :disabled="!editable"
            @change="emit('update-setting', { maxConcurrency: number($event) })"
          />
          <span class="field-hint">concurrent</span>
        </label>
        <label class="field">
          <span class="field-label">Cooldown</span>
          <input
            class="field-input"
            type="number"
            min="0"
            :value="settings.cooldownMs ?? ''"
            :disabled="!editable"
            @change="emit('update-setting', { cooldownMs: number($event) })"
          />
          <span class="field-hint">ms between runs</span>
        </label>
      </div>
      <InlineNote>Cache state is not controlled or recorded.</InlineNote>
    </section>

    <!-- Statistic -------------------------------------------------- -->
    <section v-else-if="settingKey === 'statistic'" class="block">
      <div class="readout">p50 · p95 · p99</div>
      <InlineNote>Computed from each run's recorded requests. Nothing to save.</InlineNote>
    </section>

    <!-- Equivalence ------------------------------------------------ -->
    <section v-else-if="settingKey === 'equivalence'" class="block">
      <div class="readout readout-absent">not checked</div>
      <InlineNote>
        The runner does not compare result rows between stores. A faster store
        may have returned different rows.
      </InlineNote>
    </section>

    <!-- Failure policy --------------------------------------------- -->
    <section v-else-if="settingKey === 'failure'" class="block">
      <div class="field-grid">
        <label class="field">
          <span class="field-label">Timeout</span>
          <input
            class="field-input"
            type="number"
            min="0"
            :value="settings.timeoutMs ?? ''"
            :disabled="!editable"
            @change="emit('update-setting', { timeoutMs: number($event) })"
          />
          <span class="field-hint">ms</span>
        </label>
        <label class="field">
          <span class="field-label">Retries</span>
          <input
            class="field-input"
            type="number"
            min="0"
            :value="settings.retryCount ?? ''"
            :disabled="!editable"
            @change="emit('update-setting', { retryCount: number($event) })"
          />
          <span class="field-hint">per request</span>
        </label>
        <label class="field">
          <span class="field-label">Retry delay</span>
          <input
            class="field-input"
            type="number"
            min="0"
            :value="settings.retryDelayMs ?? ''"
            :disabled="!editable"
            @change="emit('update-setting', { retryDelayMs: number($event) })"
          />
          <span class="field-hint">ms</span>
        </label>
        <label class="field field-check">
          <input
            type="checkbox"
            :checked="settings.abortOnError"
            :disabled="!editable"
            @change="emit('update-setting', { abortOnError: ($event.target as HTMLInputElement).checked })"
          />
          <span class="field-label">Abort the run on the first error</span>
        </label>
      </div>
      <InlineNote>Failed requests are counted but are not in the timings.</InlineNote>
    </section>

    <!-- Execution order -------------------------------------------- -->
    <section v-else-if="settingKey === 'order'" class="block">
      <div class="field-grid">
        <label class="field">
          <span class="field-label">Strategy</span>
          <input
            class="field-input"
            :value="settings.executionStrategy"
            :disabled="!editable"
            placeholder="Sequential"
            @change="emit('update-setting', { executionStrategy: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="field">
          <span class="field-label">Time window</span>
          <input
            class="field-input"
            :value="settings.timeWindow ?? ''"
            :disabled="!editable"
            placeholder="PT10S"
            @change="emit('update-setting', { timeWindow: ($event.target as HTMLInputElement).value || null })"
          />
          <span class="field-hint">ISO 8601 duration</span>
        </label>
        <label class="field field-check">
          <input
            type="checkbox"
            :checked="settings.randomizeOrder"
            :disabled="!editable"
            @change="emit('update-setting', { randomizeOrder: ($event.target as HTMLInputElement).checked })"
          />
          <span class="field-label">Randomise the order</span>
        </label>
      </div>
      <InlineNote>Randomised order spreads time-of-day effects across stores.</InlineNote>
    </section>
  </div>
</template>

<style scoped>
.plan-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

.detail-title {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  max-width: 640px;
}

.axis-filter {
  margin-bottom: var(--space-3);
}

.option-list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.option {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--surface);
  border-bottom: 1px solid var(--surface-sunken);
  cursor: pointer;
}

.option:last-child {
  border-bottom: none;
}

.option-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-sm);
}

.option-dot-empty {
  border: 1px solid var(--border-strong);
}

.option-name {
  color: var(--ink);
  font-size: var(--text-body);
}

.option-meta {
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-5);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field-check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-3);
  grid-column: 1 / -1;
}

.field-label {
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
}

.field-input {
  box-sizing: border-box;
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-body);
}

.field-input:disabled {
  background: var(--surface-subtle);
  color: var(--ink-disabled);
}

.field-hint {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.readout {
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
}

.readout-absent {
  color: var(--ink-muted);
  font-style: italic;
}
</style>
