<template>
  <div class="case-detail" data-testid="test-case-detail">
    <header class="detail-head">
      <span class="detail-title">{{ testName }}</span>
      <button
        type="button"
        class="head-button"
        data-testid="test-case-detail-maximise"
        :title="maximised ? 'Return to the results pane' : 'Open as full pane'"
        @click="emit('toggle-maximise')"
      >
        <component :is="maximised ? Minimize2 : Maximize2" :size="12" />
      </button>
      <button
        type="button"
        class="head-button"
        data-testid="test-case-detail-close"
        title="Close"
        @click="emit('close')"
      >
        <X :size="12" />
      </button>
    </header>

    <div class="detail-body">
      <!--
        The outcome, then the coordinates that produced it, then the diff. The
        order is the question being asked: what happened, to which cell, and how
        far off was it.
      -->
      <div class="outcome" :class="passed ? 'outcome-pass' : 'outcome-fail'">
        <component :is="passed ? CircleCheck : CircleX" :size="14" />
        <span class="outcome-text">{{ outcomeText }}</span>
        <span class="outcome-duration">{{ formatRunDuration(durationMs) }}</span>
      </div>

      <div v-if="coordinates.length" class="coordinates">
        <span
          v-for="coordinate in coordinates"
          :key="`${coordinate.kind}:${coordinate.label}`"
          class="coordinate"
          :class="`coordinate-${coordinate.kind}`"
        >
          <span v-if="coordinate.color" class="coordinate-dot" :style="{ background: coordinate.color }" />
          <Braces v-else-if="coordinate.kind === 'case'" :size="10" />
          {{ coordinate.label }}
        </span>
      </div>

      <p v-if="message" class="detail-message">{{ message }}</p>

      <div v-if="diffLines.length" class="diff" data-testid="test-case-detail-diff">
        <div class="diff-head">
          <span class="diff-title">Diff</span>
          <span class="diff-counts">{{ diffCounts }}</span>
        </div>
        <ul class="diff-list">
          <li
            v-for="(line, index) in boundedLines"
            :key="`${line.mark}-${index}`"
            class="diff-line"
            :class="line.mark === '-' ? 'diff-missing' : 'diff-unexpected'"
          >
            <span class="diff-mark">{{ line.mark }}</span>
            <code class="diff-text">{{ line.text }}</code>
          </li>
        </ul>
        <!--
          The list is bounded: a thousand-line diff is a scroll, not a reading.
          Maximise gives it the room, and the full bindings are a download.
        -->
        <p v-if="diffLines.length > boundedLines.length" class="diff-more">
          {{ diffLines.length - boundedLines.length }} more — maximise for the rest
        </p>
        <div class="diff-footer">
          <span>{{ diffFooter }}</span>
        </div>
      </div>

      <p v-else-if="!passed" class="detail-message muted">
        No diff was recorded for this failure.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One cell's result: what it did, which cell it was, and how it differed.
 *
 * The same shape the run screen shows for one test, pointed at a
 * case picked from the run's failures list instead of at the case in the
 * editor. The diff itself is `lib/testCaseDiff`, so there is one implementation
 * of "what differed" across both screens rather than two that drift.
 *
 * Maximise promotes the panel to a full main-pane tab — the same component
 * instance moved, not a second one mounted, so the scroll position and the
 * selection survive the promotion.
 */
import { computed } from 'vue';
import { Braces, CircleCheck, CircleX, Maximize2, Minimize2, X } from '@lucide/vue';
import { testDiffFooter, testDiffLines, testDiffSummary } from '../../lib/testCaseDiff';
import { formatRunDuration, type TestRunCoordinate } from '../../lib/testRunSummary';
import type { TestCaseRunResult } from '../../composables/useApiClient';

const props = withDefaults(defineProps<{
  testName: string;
  /** The case's verdict. Null when the test never produced one. */
  caseResult: TestCaseRunResult | null;
  coordinates: TestRunCoordinate[];
  /** What the row said, when there is no case-level message. */
  fallbackMessage?: string;
  passed?: boolean;
  durationMs?: number;
  maximised?: boolean;
  /** Lines shown before the diff asks for the room it needs. */
  maxLines?: number;
}>(), {
  fallbackMessage: '',
  passed: false,
  durationMs: 0,
  maximised: false,
  maxLines: 12,
});

const emit = defineEmits<{ close: []; 'toggle-maximise': [] }>();

const diffLines = computed(() => testDiffLines(props.caseResult));
const diffFooter = computed(() => testDiffFooter(props.caseResult));
const diffCounts = computed(() => testDiffSummary(props.caseResult));

const boundedLines = computed(() =>
  props.maximised ? diffLines.value : diffLines.value.slice(0, props.maxLines),
);

const message = computed(() => props.caseResult?.message || props.fallbackMessage);

const outcomeText = computed(() => {
  if (props.passed) return 'Passed';
  const counts = diffCounts.value;
  return counts ? `Failed — ${counts}` : 'Failed';
});
</script>

<style scoped>
.case-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h);
  flex-shrink: 0;
  padding: 0 var(--space-2) 0 var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.detail-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
  color: var(--ink);
}

.head-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink-muted);
  cursor: pointer;
}

.head-button:hover {
  background: var(--surface-sunken);
  color: var(--ink);
}

.detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.outcome {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
}

.outcome-pass {
  border-color: var(--success-border);
  background: var(--success-surface);
  color: var(--success-ink);
}

.outcome-fail {
  border-color: var(--danger-border);
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.outcome-text {
  flex: 1;
}

.outcome-duration {
  font-variant-numeric: tabular-nums;
  font-weight: var(--weight-normal);
}

.coordinates {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.coordinate {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-sm);
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

.detail-message {
  margin: 0;
  font-size: var(--text-micro);
  color: var(--ink-secondary);
}

.muted {
  color: var(--ink-muted);
}

.diff {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-subtle);
  font-size: var(--text-micro);
  color: var(--ink-muted);
}

.diff-title {
  font-weight: var(--weight-medium);
  color: var(--ink-secondary);
}

.diff-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.diff-line {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
}

.diff-missing {
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.diff-unexpected {
  background: var(--success-surface);
  color: var(--success-ink);
}

.diff-mark {
  flex-shrink: 0;
  width: 8px;
}

.diff-text {
  overflow-wrap: anywhere;
}

.diff-more,
.diff-footer {
  margin: 0;
  padding: var(--space-2);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-micro);
  color: var(--ink-muted);
}
</style>
