<template>
  <div ref="paneRef" class="run-results" data-testid="test-run-results">
    <!--
      The run's own header. Not a tab strip: there is one screen here, and the
      pane shows it because no test row is picked in the sidebar.
    -->
    <header class="run-head">
      <ListChecks :size="14" class="run-head-icon" />
      <h2 class="run-title">{{ summary.scope.label }}</h2>
      <StatusBadge
        v-if="summary.tallies.failed"
        status="invalid"
        :dot="false"
        data-testid="test-run-failed-pill"
      >
        {{ summary.tallies.failed }} failed
      </StatusBadge>
      <span v-if="summary.tallies.pending" class="pending-note">
        {{ summary.tallies.pending }} still to run
      </span>
      <div class="run-head-actions">
        <button
          type="button"
          class="head-button"
          data-testid="test-run-rerun-failed"
          :disabled="busy || summary.tallies.failed === 0"
          title="Run only the tests that failed in this run"
          @click="emit('rerun-failed')"
        >
          <RefreshCw :size="13" :class="{ 'is-spinning': running }" />Re-run failed
        </button>
        <button
          type="button"
          class="head-button"
          data-testid="test-run-compare"
          disabled
          title="Comparing runs needs a run to compare against — runs are not persisted yet"
        >
          <GitCompare :size="13" />Compare
        </button>
      </div>
    </header>

    <div class="split">
      <div
        class="results-body"
        :class="{ hidden: maximised }"
        :style="{ width: selectedFailure && !maximised ? `${bodyWidthPercent}%` : '100%' }"
      >
        <!--
          Five tiles, equal columns. Deltas render only when there is a previous
          run of the same scope to diff against; with nothing to compare, the row
          is omitted rather than drawn as a dash.
        -->
        <div class="tiles" data-testid="test-run-tiles">
          <div
            v-for="tile in tiles"
            :key="tile.label"
            class="tile"
            :class="{ 'tile-danger': tile.danger }"
            :data-testid="`test-run-tile-${tile.key}`"
          >
            <SectionLabel size="sm">{{ tile.label }}</SectionLabel>
            <span class="tile-value-row">
              <span class="tile-value">{{ tile.value }}</span>
              <span v-if="tile.delta" class="tile-delta">{{ tile.delta }}</span>
            </span>
            <span v-if="tile.note" class="tile-note">{{ tile.note }}</span>
          </div>
        </div>

        <div class="breakdowns">
          <TestRunBreakdown
            title="By group"
            :icon="Tags"
            :rows="summary.byGroup"
            :selected-key="groupFilter"
            test-id="test-run-by-group"
            @select="setFilter('group', $event)"
          />
          <TestRunBreakdown
            title="By backend"
            :icon="Database"
            :rows="summary.byBackend"
            :selected-key="backendFilter"
            test-id="test-run-by-backend"
            @select="setFilter('backend', $event)"
          />
        </div>

        <section class="failures" data-testid="test-run-failures">
          <header class="failures-head">
            <CircleX v-if="summary.tallies.failed" :size="13" class="ink-fail" />
            <CircleCheck v-else :size="13" class="ink-pass" />
            <SectionLabel as="h3" size="sm">Failures</SectionLabel>
            <span class="failures-count">{{ failuresCaption }}</span>
            <SegmentedToggle
              v-model="failureView"
              :options="FAILURE_VIEWS"
              group-label="Which rows to list"
              class="failures-toggle"
            />
          </header>

          <!--
            Everything passed: one line rather than an empty table with a header
            over it. The breakdowns stay — they are how you see that every group
            and every store took part.
          -->
          <p v-if="visibleFailures.length === 0 && summary.tallies.failed === 0" class="all-passed">
            All {{ summary.tallies.cases }} cases passed.
          </p>
          <p v-else-if="visibleFailures.length === 0" class="all-passed">
            Nothing matches this filter.
          </p>

          <button
            v-for="failure in visibleFailures"
            :key="failure.key"
            type="button"
            class="failure-row"
            :class="{ selected: failure.key === selectedKey }"
            data-testid="test-run-failure-row"
            @click="select(failure)"
          >
            <component
              :is="failure.status === 'excluded' ? MinusCircle : CircleX"
              :size="13"
              :class="failure.status === 'excluded' ? 'ink-muted' : 'ink-fail'"
            />
            <span class="failure-test">{{ failure.testName }}</span>
            <span class="failure-coords">
              <span
                v-for="coordinate in failure.coordinates"
                :key="`${coordinate.kind}:${coordinate.label}`"
                class="coordinate"
              >
                <span v-if="coordinate.color" class="coordinate-dot" :style="{ background: coordinate.color }" />
                {{ coordinate.label }}
              </span>
            </span>
            <span class="failure-reason">{{ failure.reason }}</span>
            <span class="failure-ms">{{ formatRunDuration(failure.durationMs) }}</span>
          </button>

          <p v-if="summary.excludedCount" class="failures-footer">
            <MinusCircle :size="12" />{{ summary.excludedCount }} excluded
          </p>
        </section>
      </div>

      <!--
        The same handle, arithmetic and remembered width as every other trailing
        panel in the app — Query's results, Rules' Inputs, a record page's
        Details. Two panels that look alike and drag differently is the
        divergence users notice first (sidebar sizing doc §2).
      -->
      <div
        v-if="selectedFailure && !maximised"
        class="vertical-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the case panel"
        title="Drag to resize · double-click to reset"
        @mousedown="startResize"
        @dblclick="resetWidth"
      >
        <div class="resizer-handle"></div>
      </div>

      <!--
        The drill-in. Rendered in one place whether it sits in the right column
        or fills the pane, so maximising moves the panel rather than mounting a
        second one: the scroll position and the selection survive.
      -->
      <div v-show="selectedFailure" class="drill-in" :class="{ 'drill-in-max': maximised }">
        <TestCaseDetailPanel
          v-if="selectedFailure"
          :test-name="selectedFailure.testName"
          :case-result="selectedCase"
          :coordinates="selectedFailure.coordinates"
          :fallback-message="selectedFailure.reason"
          :passed="false"
          :duration-ms="selectedFailure.durationMs"
          :maximised="maximised"
          @close="clearSelection"
          @toggle-maximise="maximised = !maximised"
        />
      </div>
    </div>

    <div class="run-footer" data-testid="test-run-footer">
      <span v-for="fact in footerFacts" :key="fact.key" class="footer-fact">
        <span class="footer-key">{{ fact.key }}</span>
        <span class="footer-value">{{ fact.value }}</span>
      </span>
      <!-- A debug affordance: today the cache is the only place a run lives. -->
      <span v-if="storageNote" class="footer-storage">{{ storageNote }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The Results tab: the whole run, in one screen.
 *
 * Tiles say how much of it there was, the two breakdowns say where it went
 * wrong — one area, or one store — and the failures list says which cells. The
 * right column is one of those cells in full, which is the same panel the
 * single-test screen shows.
 *
 * Everything here is scoped to the run in the sidebar. There is no history on
 * this screen because there is no run entity yet; when one lands, the Runs tab
 * grows a list above its rows and nothing here changes.
 */
import { computed, ref, watch } from 'vue';
import { usePanelResize } from '../../composables/usePanelResize';
import { CircleCheck, CircleX, Database, GitCompare, ListChecks, MinusCircle, RefreshCw, Tags } from '@lucide/vue';
import SectionLabel from '../shared/SectionLabel.vue';
import SegmentedToggle, { type SegmentedOption } from '../shared/SegmentedToggle.vue';
import StatusBadge from '../shared/StatusBadge.vue';
import TestRunBreakdown from './TestRunBreakdown.vue';
import TestCaseDetailPanel from './TestCaseDetailPanel.vue';
import {
  formatRunDuration,
  type TestRunFailureRow,
  type TestRunSummary,
  type TestRunTallies,
} from '../../lib/testRunSummary';
import type { TestRunResult } from '../../composables/useApiClient';

const emit = defineEmits<{ 'rerun-failed': [] }>();

const props = withDefaults(defineProps<{
  summary: TestRunSummary;
  /** The verdicts behind the summary, for the drill-in's case detail. */
  results: Record<string, TestRunResult>;
  /**
   * The same scope's previous run, when there is one to diff against. Null
   * today — nothing persists a second run — and the deltas are omitted rather
   * than drawn as dashes.
   */
  previous?: TestRunTallies | null;
  /** A run is still going: the header says so and Re-run failed spins. */
  running?: boolean;
  busy?: boolean;
  /** `sqlib.testRuns.v1 · 218 KB of 2 MB`, while runs live in the browser. */
  storageNote?: string | null;
  libraryName?: string | null;
}>(), {
  running: false,
  busy: false,
  previous: null,
  storageNote: null,
  libraryName: null,
});

const FAILURE_VIEWS: readonly SegmentedOption[] = [
  { value: 'failed', label: 'Failed', testId: 'test-run-view-failed' },
  { value: 'excluded', label: 'Excluded', testId: 'test-run-view-excluded' },
  { value: 'all', label: 'All', testId: 'test-run-view-all' },
];

const failureView = ref('failed');
const groupFilter = ref<string | null>(null);
const backendFilter = ref<string | null>(null);
const selectedKey = ref<string | null>(null);
const maximised = ref(false);

/*
 * The drill-in drags on the shared composable, under its own storage key, so
 * it obeys the same floors, the same 50% ceiling and the same double-click
 * reset as every other trailing panel — and remembers its width the same way.
 */
const paneRef = ref<HTMLElement | null>(null);
const {
  panelWidthPercent: bodyWidthPercent,
  startResize,
  resetWidth,
} = usePanelResize({
  containerRef: paneRef,
  storageKey: 'testRunCase',
  initialWidthPercent: 62,
});

/** One filter at a time: two axes at once answers a question nobody asked. */
function setFilter(axis: 'group' | 'backend', key: string | null) {
  if (axis === 'group') {
    groupFilter.value = key;
    backendFilter.value = null;
  } else {
    backendFilter.value = key;
    groupFilter.value = null;
  }
}

const rowsById = computed(() => new Map(props.summary.rows.map((row) => [row.id, row])));

const visibleFailures = computed(() => props.summary.failures.filter((failure) => {
  if (failureView.value === 'failed' && failure.status !== 'fail') return false;
  if (failureView.value === 'excluded' && failure.status !== 'excluded') return false;
  const row = rowsById.value.get(failure.testId);
  if (groupFilter.value && row?.groupKey !== groupFilter.value) return false;
  if (backendFilter.value && (row?.backendId ?? '__unknown__') !== backendFilter.value) return false;
  return true;
}));

const failuresCaption = computed(() => {
  const rows = visibleFailures.value;
  const tests = new Set(rows.map((row) => row.testId)).size;
  return `${rows.length} case${rows.length === 1 ? '' : 's'} across ${tests} test${tests === 1 ? '' : 's'}`;
});

const selectedFailure = computed(() =>
  props.summary.failures.find((failure) => failure.key === selectedKey.value) ?? null,
);

const selectedCase = computed(() => {
  const failure = selectedFailure.value;
  if (!failure) return null;
  return props.results[failure.testId]?.cases[failure.caseIndex] ?? null;
});

function select(failure: TestRunFailureRow) {
  selectedKey.value = selectedKey.value === failure.key ? null : failure.key;
}

function clearSelection() {
  selectedKey.value = null;
  maximised.value = false;
}

// A new run answers for different cells; keeping a selection from the last one
// would leave a diff on screen that nothing on this page produced.
watch(() => props.summary.scope.startedAt, clearSelection);

function delta(now: number, before: number | undefined): string {
  if (before === undefined) return '';
  const difference = now - before;
  if (difference === 0) return '';
  return difference > 0 ? `+${difference}` : `${difference}`;
}

const tiles = computed(() => {
  const { tallies } = props.summary;
  const before = props.previous;
  return [
    { key: 'cases', label: 'Cases', value: String(tallies.cases), delta: delta(tallies.cases, before?.cases), note: `${tallies.tests} tests`, danger: false },
    { key: 'passed', label: 'Passed', value: String(tallies.passed), delta: delta(tallies.passed, before?.passed), note: '', danger: false },
    { key: 'failed', label: 'Failed', value: String(tallies.failed), delta: delta(tallies.failed, before?.failed), note: '', danger: tallies.failed > 0 },
    { key: 'excluded', label: 'Excluded', value: String(tallies.excluded), delta: delta(tallies.excluded, before?.excluded), note: '', danger: false },
    { key: 'duration', label: 'Duration', value: formatRunDuration(props.summary.scope.wallMs || tallies.durationMs), delta: '', note: 'wall clock', danger: false },
  ];
});

const footerFacts = computed(() => {
  const { scope, tallies } = props.summary;
  const facts = [
    { key: 'scope', value: scope.label },
    { key: 'tests', value: String(tallies.tests) },
    { key: 'cases', value: String(tallies.cases) },
    { key: 'started', value: new Date(scope.startedAt).toLocaleTimeString() },
    { key: 'wall', value: formatRunDuration(scope.wallMs) },
  ];
  if (props.libraryName) facts.push({ key: 'library', value: props.libraryName });
  return facts;
});
</script>

<style scoped>
.run-results {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface-sunken);
}

.run-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 44px;
  flex-shrink: 0;
  padding: 0 var(--space-3);
  background: var(--surface);
  border-bottom: 1px solid var(--border-subtle);
}

.run-head-icon {
  color: var(--ink-muted);
}

.run-title {
  margin: 0;
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending-note {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.run-head-actions {
  margin-left: auto;
  display: flex;
  gap: var(--space-2);
}

.head-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-size: var(--text-micro);
  cursor: pointer;
}

.head-button:hover:not(:disabled) {
  color: var(--ink);
  border-color: var(--border-strong);
}

.head-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.split {
  display: flex;
  flex: 1;
  min-height: 0;
}

.results-body {
  min-width: 0;
  overflow-y: auto;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Maximised, the drill-in takes the pane. The body keeps its scroll. */
.results-body.hidden {
  display: none;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3);
  border-left: 1px solid var(--border-subtle);
}

.tile:first-child {
  border-left: 0;
}

.tile-danger {
  background: var(--danger-surface);
}

.tile-value-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.tile-value {
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.tile-delta {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.tile-note {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.breakdowns {
  display: flex;
  gap: var(--space-3);
}

.failures {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--surface);
}

.failures-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h);
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.failures-count {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.failures-toggle {
  margin-left: auto;
}

.failure-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 26px;
  padding: 0 var(--space-3);
  border: 0;
  border-left: 2px solid transparent;
  border-top: 1px solid var(--border-subtle);
  background: none;
  text-align: left;
  cursor: pointer;
}

.failure-row:hover {
  background: var(--surface-sunken);
}

.failure-row.selected {
  border-left-color: var(--danger);
  background: var(--surface-subtle);
}

.failure-test {
  width: var(--grid-8);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-label);
  color: var(--ink);
}

.failure-coords {
  display: inline-flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

.coordinate {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  color: var(--ink-secondary);
  font-size: var(--text-micro);
}

.coordinate-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
}

.failure-reason {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.failure-ms {
  font-size: var(--text-micro);
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.all-passed,
.failures-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.failures-footer {
  border-top: 1px solid var(--border-subtle);
}

.vertical-resizer {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 8px;
  background: var(--surface-raised);
  cursor: col-resize;
}

.vertical-resizer:hover {
  background: var(--action);
}

.vertical-resizer .resizer-handle {
  width: 2px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--gray-600);
  pointer-events: none;
}

.vertical-resizer:hover .resizer-handle {
  background: var(--surface);
}

.drill-in {
  display: flex;
  flex: 1;
  min-width: 0;
  border-left: 1px solid var(--border-subtle);
  background: var(--surface);
  overflow: hidden;
}

/* Maximised, the panel is the pane: the body and the handle stand down. */
.drill-in-max {
  border-left: 0;
}

.run-footer {
  display: flex;
  height: 30px;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface);
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.footer-fact {
  display: inline-flex;
  gap: var(--space-2);
}

.footer-key {
  color: var(--ink-muted);
}

.footer-value {
  color: var(--ink-secondary);
}

.footer-storage {
  margin-left: auto;
  color: var(--ink-muted);
}

.ink-pass {
  color: var(--success);
}

.ink-fail {
  color: var(--danger);
}

.ink-muted {
  color: var(--ink-muted);
}

</style>
