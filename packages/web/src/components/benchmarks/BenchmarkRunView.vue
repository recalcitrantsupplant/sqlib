<script setup lang="ts">
/**
 * Run detail — the middle column of the Runs tab (§7.3, mockup 2b).
 *
 * Reached when a number looks wrong, so it answers three questions in order:
 * what actually ran (the timeline, which doubles as the proof the order really
 * was interleaved), what each request cost (the table, one row per request),
 * and — in the panel beside it — where the time went.
 *
 * The summary strip reports p50/p95/p99 rather than mean/fastest/slowest. One
 * GC pause moves a mean and nobody sizes hardware on a minimum; the old
 * dialog's headline was a regression to fix, not a feature to carry forward
 * (§6). Failures are counted next to it, never averaged into it.
 */
import { computed, ref, watch } from 'vue';
import { Filter, Repeat } from '@lucide/vue';
import InlineNote from '../shared/InlineNote.vue';
import SearchSelect from '../shared/SearchSelect.vue';
import {
  formatCount,
  formatDuration,
  formatMs,
  formatOffset,
  type PassIndex,
  type RequestRow,
  type RunStatistics,
  type TimelineLane,
} from '../../lib/benchmarkPlan';

const props = defineProps<{
  title: string;
  subtitle: string;
  statusLabel: string;
  requests: RequestRow[];
  stats: RunStatistics;
  lanes: TimelineLane[];
  /** Passes per request, empty on a run with no rule-set case in it. */
  passes: PassIndex;
  colourFor: (backendId: string | null | undefined) => string;
  selectedKey: string | null;
  loading: boolean;
  canRerun: boolean;
}>();

const emit = defineEmits<{
  (e: 'select-request', request: RequestRow): void;
  (e: 'rerun'): void;
}>();

const MAX_ROWS = 200;

const caseFilter = ref<string>('');
const graphFilter = ref<string>('');
const sortMode = ref<'time' | 'slowest'>('time');

const caseOptions = computed(() => {
  const seen = new Map<string, string>();
  for (const request of props.requests) {
    if (request.caseId && !seen.has(request.caseId)) seen.set(request.caseId, request.caseLabel);
  }
  return [...seen].map(([id, label]) => ({ id, label }));
});

/*
 * The graph axis is a rule set's, so a run of queries has none and the column,
 * the filter and the lane wording all stay off rather than drawing an empty
 * ninth column on the table that already overflows below 780px.
 */
const graphOptions = computed(() => {
  const seen = new Map<string, string>();
  for (const request of props.requests) {
    if (request.dataGraphId && !seen.has(request.dataGraphId)) {
      seen.set(request.dataGraphId, request.dataGraphLabel ?? request.dataGraphId);
    }
  }
  return [...seen].map(([id, label]) => ({ id, label }));
});

const hasGraphs = computed(() => graphOptions.value.length > 0);

const caseSelectOptions = computed(() =>
  caseOptions.value.map((option) => ({ value: option.id, label: option.label })),
);
const graphSelectOptions = computed(() =>
  graphOptions.value.map((option) => ({ value: option.id, label: option.label })),
);

/*
 * A run to fixpoint is one request, and its pass count is the thing that
 * separates a run that is slow once from one that is slow eleven times over.
 * Printing it on the row is what makes the eleven-pass request findable
 * without opening every row in turn. Off entirely where nothing recorded
 * passes, like the graph column beside it.
 */
const hasPasses = computed(() => props.passes.size > 0);

const passCount = (request: RequestRow) => props.passes.get(request.key)?.length ?? null;

const timelineNote = computed(() => (hasGraphs.value
  ? 'one tick per request, one lane per backend or data graph'
  : 'one tick per request, one lane per backend'));

/*
 * A filter set on one run and still set on the next would hide every row of a
 * run that never named that case or graph — an empty table with no visible
 * reason. Switching runs is exactly when this happens, and it is the filter
 * that is stale, not the run.
 */
watch(caseOptions, (options) => {
  if (caseFilter.value && !options.some((option) => option.id === caseFilter.value)) {
    caseFilter.value = '';
  }
});
watch(graphOptions, (options) => {
  if (graphFilter.value && !options.some((option) => option.id === graphFilter.value)) {
    graphFilter.value = '';
  }
});

const visible = computed(() => {
  const filtered = props.requests.filter((request) => {
    if (caseFilter.value && request.caseId !== caseFilter.value) return false;
    if (graphFilter.value && request.dataGraphId !== graphFilter.value) return false;
    return true;
  });
  const sorted = [...filtered];
  if (sortMode.value === 'slowest') {
    sorted.sort((a, b) => (b.totalMs ?? -1) - (a.totalMs ?? -1));
  } else {
    sorted.sort((a, b) => a.offsetMs - b.offsetMs);
  }
  return sorted;
});

const shown = computed(() => visible.value.slice(0, MAX_ROWS));
const hidden = computed(() => Math.max(0, visible.value.length - shown.value.length));

const summary = computed(() => [
  {
    label: 'Requests',
    value: formatCount(props.stats.requests),
    note: 'all captured',
    tone: 'plain' as const,
  },
  {
    label: 'Failed',
    value: formatCount(props.stats.failed),
    note: props.stats.failed > 0 ? 'excluded from the percentiles' : 'none',
    tone: props.stats.failed > 0 ? ('bad' as const) : ('plain' as const),
  },
  {
    label: 'p50 · p95 · p99',
    value: [props.stats.p50, props.stats.p95, props.stats.p99].map(formatMs).join(' · '),
    note: 'per request, client side',
    // Three numbers where the others have one: at the headline size the cell
    // wraps to three lines and stops reading as one statistic.
    tone: 'compact' as const,
  },
  {
    label: 'Wall clock',
    value: formatDuration(props.stats.wallClockMs),
    note: 'first request to last',
    tone: 'plain' as const,
  },
]);
</script>

<template>
  <div class="run-view" data-testid="benchmark-run-view">
    <div class="run-head">
      <span class="run-title">{{ title }}</span>
      <span class="run-subtitle">{{ subtitle }}</span>
      <span class="run-status">{{ statusLabel }}</span>
      <div class="head-actions">
        <button class="head-button" :disabled="!canRerun" title="Run this version again" @click="emit('rerun')">
          <Repeat :size="13" />Re-run identically
        </button>
      </div>
    </div>

    <div class="summary-strip" data-testid="benchmark-run-summary">
      <div v-for="cell in summary" :key="cell.label" class="summary-cell">
        <span class="summary-label">{{ cell.label }}</span>
        <span
          class="summary-value"
          :class="{ 'summary-bad': cell.tone === 'bad', 'summary-compact': cell.tone === 'compact' }"
        >{{ cell.value }}</span>
        <span class="summary-note">{{ cell.note }}</span>
      </div>
    </div>

    <div class="run-body">
      <InlineNote v-if="loading">Loading the requests…</InlineNote>
      <InlineNote v-else-if="requests.length === 0">
        This run captured no requests.
      </InlineNote>

      <template v-else>
        <section class="block">
          <div class="block-head">
            <span class="block-label">Execution</span>
            <span class="block-sub">{{ timelineNote }}</span>
          </div>
          <div class="timeline">
            <div v-for="lane in lanes" :key="lane.key" class="lane">
              <span class="lane-name">
                <span class="lane-dot" :style="{ background: colourFor(lane.backendId) }" />
                {{ lane.label }}
              </span>
              <span class="lane-track">
                <span
                  v-for="(segment, index) in lane.segments"
                  :key="index"
                  class="lane-tick"
                  :style="{
                    left: `${segment.left}%`,
                    width: `${segment.width}%`,
                    background: colourFor(lane.backendId),
                  }"
                />
              </span>
            </div>
            <p class="timeline-note">
              Lanes that fill one after another are a blocked run, whatever the
              order setting says.
            </p>
          </div>
        </section>

        <section class="block">
          <div class="block-head">
            <span class="block-label">Requests</span>
            <span class="block-sub">{{ formatCount(requests.length) }} captured</span>
            <span class="filters">
              <!--
                Both axes are named by hand — a case's label, a data graph's
                name — so both are typed at rather than scrolled. Sort, beside
                them, is two fixed choices and stays a native select.
              -->
              <span class="select-wrap">
                <Filter :size="12" class="filter-icon" />
                <SearchSelect
                  class="filter-chooser"
                  test-id="benchmark-case-filter"
                  aria-label="Filter by case"
                  placeholder="All cases"
                  empty-label="All cases"
                  :model-value="caseFilter"
                  :options="caseSelectOptions"
                  @update:model-value="(value) => (caseFilter = value)"
                />
              </span>
              <SearchSelect
                v-if="hasGraphs"
                class="filter-chooser"
                test-id="benchmark-graph-filter"
                aria-label="Filter by data graph"
                placeholder="All graphs"
                empty-label="All graphs"
                :model-value="graphFilter"
                :options="graphSelectOptions"
                @update:model-value="(value) => (graphFilter = value)"
              />
              <select v-model="sortMode" class="filter-select" aria-label="Sort requests">
                <option value="time">In order</option>
                <option value="slowest">Slowest first</option>
              </select>
            </span>
          </div>

          <div class="requests" :class="{ 'requests-graphed': hasGraphs, 'requests-looped': hasPasses }">
            <div class="request-head">
              <span class="col-at">At</span>
              <span class="col-case">Case</span>
              <span class="col-backend">Backend</span>
              <span v-if="hasGraphs" class="col-graph">Graph</span>
              <span class="col-arg">Argument</span>
              <span class="col-num">Server</span>
              <span class="col-num">Total</span>
              <span v-if="hasPasses" class="col-passes">Passes</span>
              <span class="col-rows">Rows</span>
              <span class="col-status" />
            </div>
            <button
              v-for="request in shown"
              :key="request.key"
              class="request-row"
              :class="{
                'request-on': request.key === selectedKey,
                'request-failed': !request.ok,
              }"
              data-testid="benchmark-request-row"
              @click="emit('select-request', request)"
            >
              <span class="col-at">{{ formatOffset(request.offsetMs) }}</span>
              <span class="col-case">{{ request.caseLabel }}</span>
              <span class="col-backend">
                <span class="lane-dot" :style="{ background: colourFor(request.backendId) }" />
                {{ request.backendLabel }}
              </span>
              <span v-if="hasGraphs" class="col-graph" :title="request.dataGraphId ?? undefined">
                {{ request.dataGraphLabel ?? '—' }}
              </span>
              <span class="col-arg">{{ request.argumentLabel }}</span>
              <span class="col-num">{{ formatMs(request.ttfbMs) }}</span>
              <span class="col-num col-total">{{ formatMs(request.totalMs) }}</span>
              <span v-if="hasPasses" class="col-passes" data-testid="benchmark-request-passes">
                {{ passCount(request) ?? '—' }}
              </span>
              <span class="col-rows">{{ request.rows ?? '—' }}</span>
              <span class="col-status">{{ request.ok ? 'ok' : request.status }}</span>
            </button>
            <div v-if="hidden > 0" class="request-more">
              + {{ formatCount(hidden) }} more — filter or sort to bring them into view
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.run-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: var(--surface);
}

.run-head {
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

.run-title {
  color: var(--ink);
  font-size: var(--text-body-lg);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
}

.run-subtitle {
  color: var(--ink-muted);
  font-size: var(--text-body);
  white-space: nowrap;
}

.run-status {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-full);
  background: var(--surface-raised);
  color: var(--ink-secondary);
  font-size: var(--text-label);
  white-space: nowrap;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}

.head-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-body);
  white-space: nowrap;
  cursor: pointer;
}

.head-button:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--ink);
}

.head-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.summary-strip {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: repeat(4, 1fr);
  border-bottom: 1px solid var(--border-default);
}

.summary-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-5);
  background: var(--surface-subtle);
  border-right: 1px solid var(--border-subtle);
}

.summary-cell:last-child {
  border-right: none;
}

.summary-label {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.summary-value {
  color: var(--ink);
  font-size: var(--text-heading);
  font-weight: var(--weight-semibold);
  letter-spacing: -0.02em;
}

.summary-bad {
  color: var(--danger-ink);
}

.summary-compact {
  font-size: var(--text-content);
  letter-spacing: 0;
}

.summary-note {
  color: var(--ink-muted);
  font-size: var(--text-micro);
}

.run-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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

.filters {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}

/*
 * The icon sits beside the chooser rather than inside it. It used to be an
 * absolutely-positioned overlay on the native select's own padding, and a
 * chooser paints its box from inside its own component — a scoped rule here
 * cannot reach that input to reserve room, so the icon would have sat on top
 * of what you typed.
 */
.select-wrap {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.filter-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

/* Sizing only: the chooser paints itself (see `SearchSelect`). */
.filter-chooser {
  width: var(--grid-6);
}

.filter-select {
  height: 26px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.timeline {
  /*
   * The lane label column and the gap after it. Named because three rules have
   * to agree on them: the label sets the width, the lane sets the gap, and the
   * note below the lanes indents past both to line up with the tracks.
   */
  --lane-name-w: 96px;
  --lane-gap: 9px;

  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-subtle);
}

.lane {
  display: flex;
  align-items: center;
  gap: var(--lane-gap);
}

.lane-name {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
  width: var(--lane-name-w);
  overflow: hidden;
  color: var(--ink-muted);
  font-size: var(--text-label);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.lane-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-sm);
}

.lane-track {
  position: relative;
  flex: 1;
  height: 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.lane-tick {
  position: absolute;
  top: 0;
  height: 14px;
  border-radius: var(--radius-sm);
  opacity: 0.7;
}

.timeline-note {
  /*
   * Not yet an <InlineNote size="xs">. The two questions that kept it off the
   * primitive — a dense step, and whether prose may sit at `--ink-disabled` —
   * were answered by the twelfth and thirteenth passes on separate branches,
   * so the conversion is recorded in the note guard's residue rather than made
   * as part of the merge. Both declarations it used to take from the shared
   * rule above were dead — its own rule overrode them — so it states the one
   * that was not, and nothing else.
   */
  /* Clears the label column so the note starts where the tracks do. */
  padding-left: calc(var(--lane-name-w) + var(--lane-gap));
  color: var(--ink-muted);
  font-size: var(--text-micro);
  line-height: var(--leading-normal);
}

/*
 * Eight columns of fixed data, up to ten on a rules run — a graph and a pass
 * count. Below about 780px they cannot all fit, and the clipped ones are the
 * status and the row count, which is what you came for. Scrolling the table is
 * the honest failure mode.
 *
 * The width is a variable rather than four selectors because the two extra
 * columns are independent: a rule set whose input is its own DATA blocks names
 * no graph and still runs to fixpoint, so "has passes" does not imply "has a
 * graph".
 */
.requests {
  --requests-min-w: 648px;

  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

/* The extra column and the gap before it, per axis a rules run adds. */
.requests-graphed {
  --requests-min-w: 764px;
}

.requests-looped {
  --requests-min-w: 700px;
}

.requests-graphed.requests-looped {
  --requests-min-w: 816px;
}

.request-head,
.request-row {
  min-width: var(--requests-min-w);
}

.request-head,
.request-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-3) var(--space-5);
  border: none;
  border-bottom: 1px solid var(--surface-sunken);
  background: var(--surface);
  font-family: inherit;
  text-align: left;
}

.request-head {
  background: var(--surface-subtle);
  border-bottom-color: var(--border-subtle);
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.request-row {
  color: var(--ink-secondary);
  font-size: var(--text-label);
  cursor: pointer;
}

.request-row:hover {
  background: var(--surface-subtle);
}

.request-on {
  background: var(--action-surface);
}

.request-failed {
  background: var(--danger-surface);
}

.col-at {
  flex-shrink: 0;
  width: 76px;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
}

.col-case {
  flex-shrink: 0;
  width: 148px;
  overflow: hidden;
  color: var(--ink);
  font-size: var(--text-body);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.col-backend {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
  width: 92px;
  overflow: hidden;
  white-space: nowrap;
}

.col-graph {
  flex-shrink: 0;
  width: 100px;
  overflow: hidden;
  color: var(--ink-secondary);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.col-arg {
  flex: 1;
  overflow: hidden;
  min-width: 0;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.col-num {
  flex-shrink: 0;
  width: 56px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.col-total {
  color: var(--ink);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
}

.col-passes {
  flex-shrink: 0;
  width: 44px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.col-rows {
  flex-shrink: 0;
  width: 44px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.col-status {
  flex-shrink: 0;
  width: 52px;
  overflow: hidden;
  color: var(--ink-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.request-failed .col-status {
  color: var(--danger-ink);
}

.request-more {
  padding: var(--space-3) var(--space-5);
  background: var(--surface-subtle);
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.request-head .col-case,
.request-head .col-at,
.request-head .col-graph,
.request-head .col-passes,
.request-head .col-arg {
  font-family: inherit;
  font-size: var(--text-micro);
}
</style>
