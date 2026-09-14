<template>
  <div class="replay" tabindex="0" data-testid="execution-replay" @keydown="onKeydown">
    <!--
      Transport. The trace is complete before this component ever renders, so
      these move a cursor over it — nothing re-runs, and stepping backwards is
      as cheap as stepping forwards.
    -->
    <div class="transport">
      <button
        class="transport-button"
        data-testid="replay-first"
        title="Back to the start"
        :disabled="atStart"
        @click="goTo(0)"
      >
        <SkipBack :size="13" />
      </button>
      <button
        class="transport-button"
        data-testid="replay-prev"
        title="Previous step (←)"
        :disabled="atStart"
        @click="step(-1)"
      >
        <ChevronLeft :size="13" />
      </button>
      <button
        class="transport-button transport-play"
        data-testid="replay-play"
        :title="playing ? 'Pause (space)' : 'Play through the run (space)'"
        :disabled="steps.length === 0 || (atEnd && !playing)"
        @click="togglePlay"
      >
        <component :is="playing ? Pause : Play" :size="13" />
      </button>
      <button
        class="transport-button"
        data-testid="replay-next"
        title="Next step (→)"
        :disabled="atEnd"
        @click="step(1)"
      >
        <ChevronRight :size="13" />
      </button>
      <button
        class="transport-button"
        data-testid="replay-last"
        title="Jump to the end"
        :disabled="atEnd"
        @click="goTo(steps.length)"
      >
        <SkipForward :size="13" />
      </button>

      <span class="position" data-testid="replay-position">
        {{ cursor === 0 ? 'Start' : `Step ${cursor} of ${steps.length}` }}
      </span>
    </div>

    <InlineNote v-if="steps.length === 0" as="div" class="replay-empty">
      This run has no steps to replay — no DATA blocks ran and no rule fired.
    </InlineNote>

    <template v-else>
      <!--
        The run as a strip: one column per iteration, each the same width
        whatever it holds, so the shape of the evaluation — three busy passes
        then two that fire once each — is legible at a glance rather than
        implied by a slider position. Ticks inside a column are that
        iteration's rule firings, in order, and each one is a seek.

        Under them the stratum band, painted from the same `--stratum-*` ramp
        the editor gutter uses: the colour beside a rule in the document is the
        colour of the steps where it fired.
      -->
      <div class="timeline" data-testid="replay-timeline">
        <div class="timeline-track">
          <div
            v-for="group in groups"
            :key="group.key"
            class="timeline-group"
            :class="{ 'timeline-group--current': group.contains(cursor) }"
            :style="{ minWidth: group.minWidth }"
          >
            <div class="group-steps">
              <button
                v-for="cell in group.cells"
                :key="cell.index"
                type="button"
                class="step-cell"
                :class="{
                  'step-cell--done': cursor >= cell.index + 1,
                  'step-cell--current': cursor === cell.index + 1,
                  'step-cell--error': cell.failed,
                  'step-cell--quiet': cell.netDelta === 0 && !cell.failed,
                }"
                :data-testid="`replay-step-${cell.index + 1}`"
                :title="cell.title"
                :aria-label="cell.title"
                :aria-current="cursor === cell.index + 1 ? 'step' : undefined"
                @click="goTo(cell.index + 1)"
              />
              <!--
                A pass that fired nothing — the executor takes one to open the
                next stratum. It has no step to seek to, and leaving the column
                out would make the strip claim the run was shorter than it was.
              -->
              <div v-if="group.cells.length === 0" class="step-cell step-cell--none" />
            </div>

            <div class="group-strata">
              <div
                v-for="(band, bandIndex) in group.bands"
                :key="bandIndex"
                class="stratum-cell"
                :style="{ background: band.color, flexGrow: band.span }"
                :title="band.title"
                data-testid="replay-stratum-band"
              >
                <span class="stratum-cell-label">{{ band.label }}</span>
              </div>
            </div>

            <div class="group-label" :title="group.title">{{ group.label }}</div>
          </div>
        </div>
      </div>

      <!--
        Where the cursor is, in the run's own vocabulary: which iteration, and
        which rule inside it.
      -->
      <div class="now" data-testid="replay-current">
        <template v-if="cursor === 0">
          <div class="now-heading">
            <Flag :size="13" />
            <span>Before the run</span>
          </div>
          <InlineNote class="now-note">
            The base graph as given. Nothing has been inferred yet.
          </InlineNote>
        </template>
        <template v-else-if="current">
          <div class="now-heading">
            <component :is="current.kind === 'data-block' ? Database : Zap" :size="13" />
            <span
              class="now-stratum"
              :style="{ background: current.kind === 'data-block' ? STRATUM_NONE : stratumColor(current.stratum) }"
              :title="current.kind === 'data-block' ? 'DATA block — no stratum' : `Stratum ${stratumLabel(current.stratum)}`"
              data-testid="replay-current-stratum"
            >{{ current.kind === 'data-block' ? 'D' : stratumLabel(current.stratum) }}</span>
            <span class="now-label">{{ current.label }}</span>
            <span class="now-scope">{{ current.scope }}</span>
            <span
              class="now-delta"
              :class="{
                positive: current.netDelta > 0,
                negative: current.netDelta < 0,
                zero: current.netDelta === 0,
              }"
            >
              {{ current.netDelta > 0 ? '+' : '' }}{{ current.netDelta }}
            </span>
          </div>

          <p v-if="current.error" class="now-error">{{ current.error }}</p>
          <p v-else-if="current.timedOut" class="now-error">
            This rule exceeded the execution timeout.
          </p>

          <div v-if="current.inserted.length || current.deleted.length" class="now-triples">
            <div
              v-for="(quad, index) in current.deleted"
              :key="`del-${index}`"
              class="triple-row triple-row--removed"
            >
              <code>{{ abbreviate(quad) }}</code>
            </div>
            <div
              v-for="(quad, index) in current.inserted"
              :key="`ins-${index}`"
              class="triple-row triple-row--added"
            >
              <code>{{ abbreviate(quad) }}</code>
            </div>
          </div>
          <InlineNote v-else-if="current.opaqueCount > 0" class="now-note">
            Seeded {{ current.opaqueCount }} {{ current.opaqueCount === 1 ? 'triple' : 'triples' }}.
          </InlineNote>
          <InlineNote v-else class="now-note">
            {{ current.kind === 'data-block' ? 'Added nothing new.' : 'Matched nothing new — the rule fired and changed nothing.' }}
          </InlineNote>
        </template>
      </div>

      <!--
        The inference graph as it stood after the current step, rebuilt by
        applying every step up to the cursor. It reconciles with the Final
        Graph pane at the last step, because `seededQuads` accounts for the
        DATA blocks that the per-rule deltas do not.
      -->
      <div class="so-far">
        <div class="so-far-header">
          <h4 class="so-far-title">
            Inferred so far
            <span class="so-far-count" data-testid="replay-so-far-count">{{ soFar.length }}</span>
          </h4>
          <label class="only-new">
            <input v-model="onlyNew" type="checkbox" data-testid="replay-only-new" />
            <span>Only this step</span>
          </label>
        </div>

        <InlineNote v-if="visibleSoFar.length === 0" as="div" class="so-far-empty">
          {{ onlyNew ? 'This step added nothing.' : 'Nothing inferred yet.' }}
        </InlineNote>
        <div v-else class="so-far-list" data-testid="replay-so-far">
          <div
            v-for="entry in visibleSoFar"
            :key="entry.quad"
            class="triple-row"
            :class="{ 'triple-row--added': entry.fresh }"
          >
            <code>{{ abbreviate(entry.quad) }}</code>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Step through an execution that has already finished.
 *
 * Not a debugger: the run is over before this renders, and there is nothing to
 * intervene in. What it is instead is a scrubber over a complete trace, which
 * for reading an evaluation is the better instrument — it steps backwards, it
 * costs nothing to move (no re-execution, no held store), and it works at the
 * granularity of a single rule firing rather than a whole iteration.
 *
 * It reads like a debugger's transport for the same reason a debugger's does:
 * the useful gestures are "next" and "run it", so there is one play speed —
 * about a step a second, walking pace — and no menu of them. Someone who wants
 * a particular step clicks it on the timeline or steps to it, which is faster
 * than picking 8× and watching for it to go past.
 *
 * Everything here is derived from the response the editor already receives:
 * `insertedQuads` / `deletedQuads` are full lists rather than the capped
 * `quadSamples`, and `seededQuads` carries what the DATA blocks contributed.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Flag,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Zap,
} from '@lucide/vue';
import InlineNote from '../shared/InlineNote.vue';
import { STRATUM_NONE, stratumColor, stratumLabel } from '@/composables/useStratumPalette';

interface RuleExecution {
  ruleVersionId: string;
  /** The rule's own IRI where its SRL declares one. */
  ruleIri?: string;
  /** 0-based stratum the executor evaluated this firing in, when it reported one. */
  stratum?: number | null;
  durationMs: number;
  triplesInserted: number;
  triplesDeleted: number;
  quadSamples?: string[];
  insertedQuads?: string[];
  deletedQuads?: string[];
  timedOut: boolean;
  error?: { message: string };
}

interface Iteration {
  index: number;
  delta: number;
  rules?: RuleExecution[];
}

interface DataBlock {
  dataBlockVersionId: string;
  tripleDelta: number;
  error?: { message: string };
}

interface ExecutionResults {
  iterations: Iteration[];
  dataBlocks?: DataBlock[];
  seededQuads?: string[] | null;
}

/** One thing that happened, in the order it happened. */
interface ReplayStep {
  kind: 'data-block' | 'rule';
  label: string;
  /** Where in the run this sits, in words: "Data blocks", "Iteration 2". */
  scope: string;
  /** The stratum the firing belongs to; null for a DATA block or an un-stratified run. */
  stratum: number | null;
  inserted: string[];
  deleted: string[];
  /**
   * Triples known to have been added but not itemised — the DATA blocks report
   * a count each, while their triples are only available as one union. Shown as
   * a number rather than silently as nothing.
   */
  opaqueCount: number;
  netDelta: number;
  timedOut: boolean;
  error?: string;
}

/** One tick on the timeline: a step, and how it should be drawn. */
interface TimelineCell {
  /** 0-based index into `steps`; the cursor for it is `index + 1`. */
  index: number;
  stratum: number | null;
  kind: ReplayStep['kind'];
  netDelta: number;
  failed: boolean;
  title: string;
}

/** A run of consecutive cells sharing a stratum, drawn as one block of colour. */
interface StratumRun {
  color: string;
  label: string;
  title: string;
  span: number;
}

/** One column of the timeline: the DATA blocks, or one iteration. */
interface TimelineGroup {
  key: string;
  label: string;
  title: string;
  cells: TimelineCell[];
  bands: StratumRun[];
  /**
   * Columns share the width equally, but a pass with twenty firings still needs
   * a tick each; below this the track scrolls rather than shaving them to
   * nothing.
   */
  minWidth: string;
  /** Whether the cursor is inside this column — used to mark it as the live one. */
  contains: (cursor: number) => boolean;
}

const props = withDefaults(defineProps<{
  results: ExecutionResults | null;
  /**
   * How a result is attributed, from the parent — the rule's own IRI where the
   * SRL declares one, shortened the same way the summary shortens it. Taken as
   * a function rather than a map so both readings of one trace name a rule
   * identically, and so nothing here invents a label of its own.
   */
  ruleLabel?: (rule: { ruleIri?: string; ruleVersionId: string }) => string;
  /** The parent decides how terms are written, so it owns the abbreviation. */
  abbreviate?: (quad: string) => string;
}>(), {
  ruleLabel: (rule: { ruleIri?: string; ruleVersionId: string }) => rule.ruleIri || rule.ruleVersionId,
  abbreviate: (quad: string) => quad,
});

/** Walking pace — fast enough to watch, slow enough to read. The only pace. */
const STEP_INTERVAL_MS = 700;

const cursor = ref(0);
const playing = ref(false);
const onlyNew = ref(false);

const insertedFor = (rule: RuleExecution): string[] =>
  rule.insertedQuads?.length ? rule.insertedQuads : (rule.quadSamples ?? []);

const stratumOf = (rule: RuleExecution): number | null =>
  typeof rule.stratum === 'number' && Number.isFinite(rule.stratum) ? rule.stratum : null;

/**
 * Flatten the trace into one ordered list, and the columns that display it.
 *
 * Both at once because they have to agree: a column is a slice of the same
 * array the cursor indexes, and an iteration that fired nothing is a column
 * with no slice — which is only visible from here, since the flattened list
 * has no record of a pass in which nothing happened.
 *
 * DATA blocks come first (they run once, before the fixpoint), then every rule
 * firing of every iteration in order. A rule that fired and changed nothing is
 * still a step: "this rule ran and matched nothing new" is usually the answer
 * someone is looking for.
 */
const trace = computed<{ steps: ReplayStep[]; groups: TimelineGroup[] }>(() => {
  const results = props.results;
  if (!results) return { steps: [], groups: [] };

  const steps: ReplayStep[] = [];
  const groups: TimelineGroup[] = [];
  const blocks = results.dataBlocks ?? [];

  /*
   * The DATA blocks' triples are reported as a single union rather than per
   * block, so a run with several of them attributes the whole seed to the
   * first and shows the rest as counts. Splitting the union would mean a
   * dataset capture either side of every block, which is a real cost on every
   * execution for a replay-only nicety.
   */
  const seeded = results.seededQuads ?? [];
  const dataStart = steps.length;
  blocks.forEach((block, index) => {
    const inserted = index === 0 ? seeded : [];
    steps.push({
      kind: 'data-block',
      label: blocks.length === 1 ? 'DATA block' : `DATA block ${index + 1}`,
      scope: 'Before the fixpoint',
      stratum: null,
      inserted,
      deleted: [],
      opaqueCount: inserted.length === 0 ? Math.max(block.tripleDelta, 0) : 0,
      netDelta: block.tripleDelta,
      timedOut: false,
      error: block.error?.message,
    });
  });
  if (blocks.length > 0) {
    groups.push(buildGroup('data', 'DATA', 'DATA blocks — run once, before the fixpoint', steps, dataStart));
  }

  for (const iteration of results.iterations ?? []) {
    const start = steps.length;
    for (const rule of iteration.rules ?? []) {
      const inserted = insertedFor(rule);
      const deleted = rule.deletedQuads ?? [];
      steps.push({
        kind: 'rule',
        label: props.ruleLabel(rule),
        scope: `Iteration ${iteration.index}`,
        stratum: stratumOf(rule),
        inserted,
        deleted,
        opaqueCount: 0,
        netDelta: rule.triplesInserted - rule.triplesDeleted,
        timedOut: rule.timedOut,
        error: rule.error?.message,
      });
    }
    groups.push(buildGroup(
      `iteration-${iteration.index}`,
      String(iteration.index),
      `Iteration ${iteration.index} — ${describeCount(steps.length - start)}, net ${iteration.delta > 0 ? '+' : ''}${iteration.delta}`,
      steps,
      start,
    ));
  }

  return { steps, groups };
});

const steps = computed(() => trace.value.steps);
const groups = computed(() => trace.value.groups);

function describeCount(count: number): string {
  if (count === 0) return 'no rule fired';
  return `${count} ${count === 1 ? 'firing' : 'firings'}`;
}

/** Build one column from the steps appended since `start`. */
function buildGroup(
  key: string,
  label: string,
  title: string,
  all: ReplayStep[],
  start: number,
): TimelineGroup {
  // Fixed now, not read back later: `all` keeps growing as later columns are
  // built, and a column's extent is what it held when it was closed.
  const end = all.length;
  const cells: TimelineCell[] = [];
  for (let index = start; index < end; index += 1) {
    const step = all[index]!;
    cells.push({
      index,
      stratum: step.stratum,
      kind: step.kind,
      netDelta: step.netDelta,
      failed: Boolean(step.error) || step.timedOut,
      title: [
        `Step ${index + 1}`,
        step.label,
        step.kind === 'data-block' ? 'DATA block' : `stratum ${stratumLabel(step.stratum)}`,
        `${step.netDelta > 0 ? '+' : ''}${step.netDelta}`,
      ].join(' · '),
    });
  }
  return {
    key,
    label,
    title,
    cells,
    bands: buildBands(cells),
    minWidth: `${Math.max(cells.length, 1) * 9 + 8}px`,
    contains: (position) => position > start && position <= end,
  };
}

/**
 * Collapse a column's cells into runs of one colour.
 *
 * Same convention as the gutter: an unbroken block of colour carrying one
 * number, rather than the number repeated under every tick. Strata do not
 * interleave within an iteration — the executor runs them in order — so a run
 * is contiguous by construction.
 */
function buildBands(cells: TimelineCell[]): StratumRun[] {
  if (cells.length === 0) {
    return [{ color: STRATUM_NONE, label: '', title: 'No rule fired in this pass', span: 1 }];
  }
  const bands: StratumRun[] = [];
  for (const cell of cells) {
    const isData = cell.kind === 'data-block';
    const color = isData ? STRATUM_NONE : stratumColor(cell.stratum);
    const label = isData ? 'D' : stratumLabel(cell.stratum);
    const last = bands[bands.length - 1];
    if (last && last.color === color && last.label === label) {
      last.span += 1;
      continue;
    }
    bands.push({
      color,
      label,
      title: isData ? 'DATA block — no stratum' : `Stratum ${stratumLabel(cell.stratum)}`,
      span: 1,
    });
  }
  return bands;
}

const atStart = computed(() => cursor.value <= 0);
const atEnd = computed(() => cursor.value >= steps.value.length);
const current = computed(() => (cursor.value > 0 ? steps.value[cursor.value - 1] : null));

/**
 * The inference graph after the current step.
 *
 * Rebuilt from the start each time the cursor moves. A trace big enough for
 * that to matter is one nobody is stepping through, and the alternative —
 * caching a set per step — costs memory proportional to steps × triples.
 */
const soFar = computed(() => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (let index = 0; index < cursor.value; index += 1) {
    const step = steps.value[index];
    if (!step) continue;
    for (const quad of step.deleted) {
      if (seen.delete(quad)) ordered.splice(ordered.indexOf(quad), 1);
    }
    for (const quad of step.inserted) {
      if (!seen.has(quad)) {
        seen.add(quad);
        ordered.push(quad);
      }
    }
  }
  return ordered;
});

/** The cumulative list, with the current step's additions marked. */
const visibleSoFar = computed(() => {
  const fresh = new Set(current.value?.inserted ?? []);
  const entries = soFar.value.map((quad) => ({ quad, fresh: fresh.has(quad) }));
  return onlyNew.value ? entries.filter((entry) => entry.fresh) : entries;
});

function step(delta: number) {
  cursor.value = Math.min(Math.max(cursor.value + delta, 0), steps.value.length);
}

/** Seeking by hand is a deliberate stop, the way clicking a line in a debugger is. */
function goTo(position: number) {
  stopPlaying();
  cursor.value = Math.min(Math.max(position, 0), steps.value.length);
}

let timer: ReturnType<typeof setInterval> | null = null;

function stopPlaying() {
  playing.value = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function togglePlay() {
  if (playing.value) {
    stopPlaying();
    return;
  }
  // Playing from the end restarts, rather than being a button that does nothing.
  if (atEnd.value) cursor.value = 0;
  playing.value = true;
  timer = setInterval(() => {
    if (atEnd.value) {
      stopPlaying();
      return;
    }
    step(1);
  }, STEP_INTERVAL_MS);
}

// A fresh run invalidates the cursor: leaving it where it was would point into
// a trace that no longer exists.
watch(() => props.results, () => {
  stopPlaying();
  cursor.value = 0;
});

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') {
    stopPlaying();
    step(1);
    event.preventDefault();
  } else if (event.key === 'ArrowLeft') {
    stopPlaying();
    step(-1);
    event.preventDefault();
  } else if (event.key === ' ') {
    togglePlay();
    event.preventDefault();
  }
}

onUnmounted(stopPlaying);
</script>

<style scoped>
.replay {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  outline: none;
}

.transport {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
}

.transport-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  cursor: pointer;
}
.transport-button:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--ink);
}
.transport-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.transport-play {
  border-color: var(--action);
  background: var(--action);
  color: var(--action-fg);
}
.transport-play:hover:not(:disabled) {
  background: var(--action-hover);
  border-color: var(--action-hover);
  color: var(--action-fg);
}

.position {
  margin-left: auto;
  color: var(--ink-secondary);
  font-size: var(--text-label);
  font-variant-numeric: tabular-nums;
}

/* The strip: iterations across, ticks and strata stacked within each. */
.timeline {
  padding: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  overflow-x: auto;
}

.timeline-track {
  display: flex;
  align-items: stretch;
  gap: 3px;
  min-width: 100%;
}

/* Equal width per iteration, whatever it holds — that is the point of it. */
.timeline-group {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-1);
  border-radius: var(--radius-sm);
}
.timeline-group--current {
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border-default);
}

.group-steps {
  display: flex;
  gap: 2px;
  height: 16px;
}

.step-cell {
  flex: 1 1 0;
  min-width: 4px;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  cursor: pointer;
}
.step-cell:hover {
  border-color: var(--action);
}
.step-cell--quiet {
  background: var(--surface-sunken);
}
.step-cell--done {
  border-color: var(--action);
  background: var(--action);
}
/* The playhead: the strongest action tone, ringed so it reads out of the run. */
.step-cell--current {
  border-color: var(--action-active);
  background: var(--action-active);
  box-shadow: 0 0 0 2px var(--focus-ring);
}
.step-cell--error {
  border-color: var(--danger-ink);
  background: var(--danger-surface);
}
.step-cell--none {
  border-style: dashed;
  background: transparent;
  cursor: default;
}

.group-strata {
  display: flex;
  gap: 2px;
  height: 14px;
}

.stratum-cell {
  display: flex;
  flex-basis: 0;
  align-items: center;
  justify-content: center;
  min-width: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.stratum-cell-label {
  color: var(--ink-secondary);
  font-size: var(--text-micro);
  font-weight: var(--weight-medium);
  line-height: 1;
}

.group-label {
  color: var(--ink-muted);
  font-size: var(--text-micro);
  font-variant-numeric: tabular-nums;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The inset each one stands in is the pane's fact, not the note's type. */
.replay-empty,
.so-far-empty,
.now-note {
  padding: var(--space-2);
}

.now {
  padding: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.now-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
}
/* The same colour the timeline band and the editor gutter give this stratum. */
.now-stratum {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--ink-secondary);
  font-size: var(--text-micro);
  font-weight: var(--weight-medium);
}
.now-label {
  color: var(--ink);
}
.now-scope {
  color: var(--ink-muted);
  font-weight: var(--weight-normal);
}
.now-delta {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.now-delta.positive {
  color: var(--success-ink);
}
.now-delta.negative {
  color: var(--danger-ink);
}
.now-delta.zero {
  color: var(--ink-muted);
}

.now-error {
  margin: var(--space-2) 0 0;
  color: var(--danger-ink);
  font-size: var(--text-label);
}

.now-triples {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--space-2);
  max-height: 180px;
  overflow-y: auto;
}

.so-far-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.so-far-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
}
.so-far-count {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--surface-subtle);
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}
.only-new {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ink-secondary);
  font-size: var(--text-label);
  cursor: pointer;
}

.so-far-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--space-2);
  max-height: 260px;
  overflow-y: auto;
}

.triple-row {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-code);
  overflow-wrap: anywhere;
}
.triple-row--added {
  background: var(--success-surface);
}
.triple-row--removed {
  background: var(--danger-surface);
  text-decoration: line-through;
}
</style>
