<template>
  <div class="runs-body" data-testid="test-runs-panel">
    <!--
      What ran, when, and how long it took. Three facts and a re-run — a run is
      a scope, and this strip is the scope said out loud.
    -->
    <div v-if="summary" class="scope-strip" :class="{ selected: resultsSelected }" data-testid="test-run-scope">
      <button
        type="button"
        class="scope-chip"
        data-testid="test-run-scope-results"
        :aria-pressed="resultsSelected"
        title="Show the run's summary"
        @click="emit('select-results')"
      >
        <TagDot v-if="scopeTagColor" :color="scopeTagColor" size="heading" />
        <span v-else class="scope-dot" aria-hidden="true" />
        <span class="scope-label">{{ summary.scope.label }}</span>
      </button>
      <span v-if="summary.scope.cancelled" class="scope-partial" title="The run was stopped part-way">partial</span>
      <span class="scope-meta">{{ scopeMeta }}</span>
      <button
        type="button"
        class="scope-rerun"
        data-testid="test-run-scope-rerun"
        :disabled="busy"
        :title="`Run ${summary.scope.label} again`"
        @click="emit('rerun')"
      >
        <RefreshCw :size="13" :class="{ 'is-spinning': running }" />
      </button>
    </div>

    <div v-if="summary" class="run-list">
      <template v-for="group in summary.groups" :key="group.key">
        <div class="group-header">
          <TagDot v-if="group.color" :color="group.color" size="heading" />
          <span class="group-name">{{ group.label }}</span>
          <span class="group-rule" />
          <!-- Cases, not tests: a parametrised test answers more than once. -->
          <span class="group-tally" :class="{ 'tally-fail': group.failed }">
            {{ group.passedCases }} / {{ group.totalCases }}
          </span>
        </div>
        <button
          v-for="row in group.rows"
          :key="row.id"
          type="button"
          class="test-row"
          :class="{ selected: row.id === selectedTestId, superseded: row.superseded }"
          data-testid="test-run-row"
          :data-test-id="row.id"
          :title="row.superseded ? 'Judged against a version this test has since left' : row.message || row.name"
          @click="emit('select-test', row.id)"
        >
          <!-- A row still in flight spins rather than showing last time's verdict. -->
          <LoaderCircle
            v-if="runningIds.includes(row.id) || row.status === 'pending'"
            :size="13"
            class="status-icon status-running is-spinning"
          />
          <component
            v-else
            :is="STATUS_ICON[row.status]"
            :size="13"
            :class="['status-icon', `status-${row.status}`]"
          />
          <span class="test-name">{{ row.name }}</span>
          <!--
            The grid glyph marks a parametrised test and says how many cases it
            expanded to. Only when it expands to more than one: a "1" beside
            every ordinary test would be a column of noise.
          -->
          <span v-if="row.caseCount > 1" class="case-badge" :title="`${row.caseCount} cases`">
            <Grid2x2 :size="10" />{{ row.caseCount }}
          </span>
          <!-- Duration, not age: every row in a run is the same age. -->
          <span class="test-duration">{{ formatRunDuration(row.durationMs) }}</span>
        </button>
      </template>
    </div>

    <!--
      Nothing has run this session. The way out is the Tests tab, so the button
      goes there rather than starting a run the user has not scoped.
    -->
    <EmptyState
      v-else
      title="No run yet"
      description="Run a test, a tag or the whole list and it lands here."
      data-testid="test-runs-empty"
    >
      <template #actions>
        <button type="button" class="empty-button" @click="emit('update:tab', 'tests')">
          <ListChecks :size="13" />Go to Tests
        </button>
      </template>
    </EmptyState>

    <div v-if="summary" class="run-footer">
      <span class="tally-line">
        <span class="tally-pass">{{ summary.tallies.passed }} pass</span>
        <span class="tally-sep">·</span>
        <span :class="summary.tallies.failed ? 'tally-fail' : 'tally-muted'">{{ summary.tallies.failed }} fail</span>
        <span class="tally-sep">·</span>
        <span class="tally-muted">{{ summary.tallies.excluded }} excluded</span>
      </span>
      <span v-if="summary.tallies.pending" class="tally-note">
        {{ summary.tallies.pending }} still to run
      </span>
      <span class="tally-note">
        {{ summary.tallies.cases }} cases across {{ summary.tallies.tests }} tests
      </span>
      <TestRunExportMenu
        :scope-label="summary.scope.label"
        :busy="busy"
        @rerun="emit('rerun')"
        @export="emit('export', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The Runs tab's sidebar: the tests the last run covered, and nothing else.
 *
 * The split with the Tests tab is one of *scope*, not of content: Tests holds
 * every authored test, always; Runs holds whatever last ran — 12 of 47 after a
 * tag run. Running anything switches to this tab, because the user asked for a
 * run and this is the run.
 *
 * There is no `+ New test` here. Authoring belongs to the list you author
 * against, and a run is not a place to add to.
 *
 * The panel reads a `TestRunSummary` and nothing else. Where that summary comes
 * from — the browser-local verdict cache today, a server-side run entity when
 * one lands — is one adapter away, and no component on this screen has to know.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { CircleCheck, CircleX, Grid2x2, ListChecks, LoaderCircle, MinusCircle, RefreshCw } from '@lucide/vue';
import EmptyState from '../shared/EmptyState.vue';
import TagDot from '../tags/TagDot.vue';
import TestRunExportMenu from './TestRunExportMenu.vue';
import { formatCompactAge } from '../../lib/time';
import {
  formatRunDuration,
  type TestRunStatus,
  type TestRunSummary,
} from '../../lib/testRunSummary';
import type { TestReportFormat } from '../../lib/testReportFormats';

const props = withDefaults(defineProps<{
  summary: TestRunSummary | null;
  /** The test open in the main pane, if any. */
  selectedTestId?: string | null;
  /** The pane is showing the run itself rather than one of its tests. */
  resultsSelected?: boolean;
  /** A run is in flight: rows stream in and the tallies move. */
  running?: boolean;
  /** The tests answering right now, so their rows spin instead of lying. */
  runningIds?: string[];
  busy?: boolean;
  /** The colour of the tag a tag run named, for the scope chip's dot. */
  scopeTagColor?: string | null;
}>(), { selectedTestId: null, resultsSelected: false, running: false, runningIds: () => [], busy: false, scopeTagColor: null });

const emit = defineEmits<{
  'update:tab': [tab: 'tests' | 'runs'];
  'select-test': [testId: string];
  'select-results': [];
  rerun: [];
  export: [format: TestReportFormat];
}>();

/* An age that never ticks reads "0s ago" for the rest of the session. */
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
onMounted(() => { ticker = setInterval(() => { now.value = Date.now(); }, 30_000); });
onUnmounted(() => { if (ticker) clearInterval(ticker); });

const STATUS_ICON: Record<TestRunStatus, typeof CircleCheck> = {
  pass: CircleCheck,
  fail: CircleX,
  // Drawn only when the run has stopped; while it is going the row spins.
  pending: MinusCircle,
  excluded: MinusCircle,
};

/**
 * `2m ago · 48s`, or what a running run can honestly say instead.
 *
 * A run still going has no wall time yet, and printing one that grows would be
 * a number the reader watches rather than reads.
 */
const scopeMeta = computed(() => {
  const scope = props.summary?.scope;
  if (!scope) return '';
  if (props.running) return 'running…';
  // The same compact age every sidebar row shows — `2m`, `3h` — so the strip
  // and the rows under it read in one vocabulary.
  const age = formatCompactAge(scope.finishedAt ?? scope.startedAt, now.value);
  return scope.wallMs ? `${age} ago · ${formatRunDuration(scope.wallMs)}` : `${age} ago`;
});
</script>

<style scoped>
.runs-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.scope-strip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 38px;
  flex-shrink: 0;
  padding: 0 var(--space-3);
  background: var(--surface);
  border-bottom: 1px solid var(--border-subtle);
}

.scope-strip.selected {
  background: var(--action-surface);
  box-shadow: inset 2px 0 0 var(--action);
}

.scope-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

.scope-chip:hover .scope-label {
  color: var(--action);
}

.scope-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--border-strong);
}

.scope-label {
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A stopped run is still a run; the marker says which kind. */
.scope-partial {
  padding: 0 var(--space-2);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-sm);
  background: var(--warning-surface);
  color: var(--warning-ink);
  font-size: var(--text-micro);
}

.scope-meta {
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-micro);
  white-space: nowrap;
}

.scope-rerun {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}

.scope-rerun:hover:not(:disabled) {
  background: var(--surface-sunken);
  color: var(--ink);
}

.scope-rerun:disabled {
  opacity: 0.5;
  cursor: default;
}

.run-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: var(--space-3);
}

.group-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 24px;
  padding: 0 var(--space-3);
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.group-name {
  font-weight: var(--weight-medium);
  color: var(--ink-secondary);
}

.group-rule {
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

.group-tally {
  color: var(--success-ink);
  font-variant-numeric: tabular-nums;
}

.tally-fail {
  color: var(--danger-ink);
}

.test-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 26px;
  padding: 0 var(--space-3) 0 var(--space-4);
  border: 0;
  border-left: 2px solid transparent;
  background: none;
  text-align: left;
  cursor: pointer;
}

.test-row:hover {
  background: var(--surface-sunken);
}

.test-row.selected {
  background: var(--action-surface);
  border-left-color: var(--action);
}

/* Edited since the run: the verdict describes a version this test has left. */
.test-row.superseded .test-name {
  /* Trailing room so the italic lean is not clipped by the name's overflow: hidden. */
  padding-right: 0.12em;
  color: var(--ink-muted);
  font-style: italic;
}

.status-pass {
  color: var(--success);
}

.status-fail {
  color: var(--danger);
}

.status-excluded {
  color: var(--ink-muted);
}

.status-running {
  color: var(--state-running);
}

.status-pending {
  color: var(--ink-muted);
}

.status-icon {
  flex-shrink: 0;
}

.test-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-label);
  color: var(--ink);
}

.case-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
}

.test-duration {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
}

.empty-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-size: var(--text-label);
  cursor: pointer;
}

.empty-button:hover {
  color: var(--ink);
  border-color: var(--border-strong);
}

.run-footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex-shrink: 0;
  padding: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
}

.tally-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-label);
}

.tally-pass {
  color: var(--success-ink);
}

.tally-muted {
  color: var(--ink-muted);
}

.tally-sep {
  color: var(--ink-disabled);
}

.tally-note {
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

</style>
