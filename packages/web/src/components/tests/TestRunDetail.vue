<template>
  <div class="run-detail" data-testid="test-run-detail">
    <!--
      The run's header, at the scope of one test: what was run, and the two
      things you do next — run it again, or go and change it.
    -->
    <header class="detail-head">
      <CircleCheck v-if="run?.passed" :size="14" class="ink-pass" />
      <CircleX v-else-if="run" :size="14" class="ink-fail" />
      <ListChecks v-else :size="14" class="head-icon" />
      <h2 class="detail-title">{{ testName || 'Test' }}</h2>
      <span v-if="run" class="head-meta">{{ ranAtLabel }}</span>
      <div class="head-actions">
        <button
          type="button"
          class="head-button"
          data-testid="test-run-detail-rerun"
          :disabled="running"
          title="Run this test again"
          @click="emit('rerun')"
        >
          <RefreshCw :size="13" :class="{ 'is-spinning': running }" />Run again
        </button>
        <button
          type="button"
          class="head-button"
          data-testid="test-run-detail-configure"
          title="Open this test's configuration"
          @click="emit('open-config')"
        >
          <Settings2 :size="13" />Configure
        </button>
      </div>
    </header>

    <div class="detail-body">
      <EmptyState
        v-if="!run"
        size="sm"
        title="Not run in this run"
        description="This test carries no verdict yet. Run it to see the outcome and, if it fails, what differed."
      />

      <template v-else>
        <div class="verdict" :class="run.passed ? 'verdict-pass' : 'verdict-fail'" data-testid="test-verdict">
          <component :is="run.passed ? CircleCheck : CircleX" :size="15" />
          <span class="verdict-text">{{ run.passed ? 'Passed' : 'Failed' }}</span>
          <span class="verdict-meta">{{ verdictMeta }}</span>
        </div>

        <p v-if="run.message" class="muted" data-testid="test-message">{{ run.message }}</p>

        <!--
          One row per case, shown only when there is more than one: a single
          case's verdict is the test's verdict, already stated above, and
          repeating it as a list of one is noise.
        -->
        <ul v-if="run.cases.length > 1" class="case-results" data-testid="test-case-results">
          <li v-for="(caseResult, index) in run.cases" :key="caseResult.caseId">
            <button
              type="button"
              class="case-result"
              :class="{ on: index === selectedCaseIndex }"
              :data-testid="`test-case-result-${index}`"
              @click="selectedCaseIndex = index"
            >
              <span class="case-dot" :class="caseResult.passed ? 'case-dot-pass' : 'case-dot-fail'"></span>
              <span class="case-result-name">{{ caseResult.name }}</span>
              <span class="case-result-message">{{ caseResult.passed ? '' : caseResult.message }}</span>
            </button>
          </li>
        </ul>

        <!-- Only when it says something the run's own message did not: with one
             case the two are usually the same sentence. -->
        <p
          v-else-if="runCase && !runCase.passed && !run.message.includes(runCase.message)"
          class="muted"
        >{{ runCase.message }}</p>

        <div v-if="diffLines.length" class="diff" data-testid="test-diff">
          <header class="block-head">
            <SectionLabel as="h4">Difference</SectionLabel>
            <InfoHint label="difference">
              Expected and actual as one list: − expected only, + actual only.
              Blank nodes are canonicalised before comparison, so a rule that
              mints them does not fail on labels.
            </InfoHint>
          </header>
          <ul class="diff-list">
            <li
              v-for="(line, index) in diffLines"
              :key="`${line.mark}-${index}`"
              class="diff-line"
              :class="line.mark === '-' ? 'diff-missing' : 'diff-unexpected'"
            >
              <span class="diff-mark">{{ line.mark }}</span>
              <code>{{ line.text }}</code>
            </li>
          </ul>
          <p class="muted" data-testid="test-diff-footer">{{ diffFooter }}</p>
        </div>

        <!--
          What the subject produced. Always shown, pass or fail: on a pass it is
          how you check the test is right for the right reason, and on a long
          failure it is more readable than the diff of it — so it opens
          expanded, unlike every other peek on the screen: it is the answer to
          the question the run was asked.
        -->
        <div v-if="runResult !== null" class="result-block" data-testid="test-result">
          <CodePeek
            label="Result"
            :content="runResult || '(empty)'"
            :content-type="expectedContentType"
            :meta="resultMeta"
            :collapsed-lines="8"
            default-expanded
            test-id="test-result-code"
          />
        </div>

        <!--
          The expectation, read from the version that actually ran rather than
          from whatever the editor holds now: this screen is about a run, and a
          draft edited since is a different test.
        -->
        <CodePeek
          v-if="expectedText"
          label="Expected"
          :content="expectedText"
          :content-type="expectedContentType"
          :meta="expectedMeta"
          test-id="test-expected-recap"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One test's run, as the main pane.
 *
 * This is the right-hand column the single-test screen used to carry, moved to where a
 * run is now read: the Runs tab in the sidebar decides *which* screen the pane
 * shows, so a test row on that tab is its verdict, and the same row on the
 * Tests tab is its configuration. Two panes over one selection, rather than one
 * pane that had to hold both and gave each half the width.
 *
 * The verdict is the store's — one per test, written by whichever of the four
 * ways of starting a run produced it — so this component reads rather than
 * runs; `rerun` goes back to the page, which owns the run scope.
 */
import { computed, ref, watch } from 'vue';
import { CircleCheck, CircleX, ListChecks, RefreshCw, Settings2 } from '@lucide/vue';
import CodePeek from '../shared/CodePeek.vue';
import EmptyState from '../shared/EmptyState.vue';
import InfoHint from '../shared/InfoHint.vue';
import SectionLabel from '../shared/SectionLabel.vue';
import { testDiffFooter, testDiffLines } from '../../lib/testCaseDiff';
import { formatRelativeTime } from '../../lib/time';
import { useTestsStore } from '../../composables/useTestsStore';
import type { TestRunResult, TestVersion } from '../../composables/useApiClient';

const props = defineProps<{
  testId: string;
  /** The verdict this test carries, or null when the run did not reach it. */
  run: TestRunResult | null;
  running?: boolean;
}>();

const emit = defineEmits<{
  (e: 'rerun'): void;
  /** Take me to this test's configuration — the Tests tab's screen. */
  (e: 'open-config'): void;
}>();

const testsStore = useTestsStore();

const testName = computed(
  () => testsStore.tests.value.find((test) => test.id === props.testId)?.name ?? '',
);

const selectedCaseIndex = ref(0);

// A different test, or a different run of it, is a different question; the
// case that was selected in the last one says nothing about this one.
watch(() => [props.testId, props.run?.ranAt], () => { selectedCaseIndex.value = 0; });

const runCase = computed(() => props.run?.cases[selectedCaseIndex.value] ?? null);

const verdictMeta = computed(() => {
  const run = props.run;
  if (!run) return '';
  const parts = [run.hermetic ? 'hermetic' : 'integration'];
  // Only when there is more than one: "1 of 1 passed" is noise on the shape
  // most tests have.
  if (run.cases.length > 1) parts.push(`${run.passedCount}/${run.cases.length} passed`);
  parts.push(`${Math.round(run.durationMs)}ms`);
  return parts.join(' · ');
});

const ranAtLabel = computed(() => {
  const ranAt = props.run?.ranAt;
  return ranAt ? `ran ${formatRelativeTime(ranAt)}` : '';
});

/* The diff itself is `lib/testCaseDiff`, shared with the Runs tab's drill-in. */
const diffLines = computed(() => testDiffLines(runCase.value));

const diffFooter = computed(() => testDiffFooter(runCase.value));

/** What the selected case produced, or null when the run carried nothing. */
const runResult = computed(() => runCase.value?.result ?? null);

const resultMeta = computed(() => {
  const lines = (runResult.value ?? '').split('\n').filter(Boolean).length;
  const truncated = runCase.value?.resultTruncated ? ' · truncated' : '';
  return `${lines} line${lines === 1 ? '' : 's'}${truncated}`;
});

/**
 * The version that ran, for its expectations.
 *
 * A run names the version it judged, so the expectation shown beside the result
 * is that version's — not the current one, and not the draft on the editing
 * screen. Loaded lazily: the store caches versions per test, so opening the
 * same run twice costs one request.
 */
const ranVersion = ref<TestVersion | null>(null);

watch(
  () => [props.testId, props.run?.testVersionId] as const,
  async ([testId, versionId]) => {
    ranVersion.value = null;
    if (!testId || !versionId) return;
    try {
      const versions = await testsStore.loadVersions(testId);
      ranVersion.value = versions.find((version) => version.id === versionId) ?? null;
    } catch {
      // The expectation is a recap; failing to fetch it costs a panel, not the
      // verdict the screen is here for.
      ranVersion.value = null;
    }
  },
  { immediate: true },
);

const expectationKind = computed(() => ranVersion.value?.expectationKind ?? props.run?.expectationKind ?? '');

/**
 * What the expectation is written in, so the panes colour it as the language it
 * is. The same mapping the editing screen makes.
 */
const expectedContentType = computed(() => {
  switch (expectationKind.value) {
    case 'graph':
      return 'text/turtle';
    case 'bindings':
    case 'analysis':
      return 'application/json';
    default:
      return null;
  }
});

const expectedCase = computed(() => ranVersion.value?.cases[selectedCaseIndex.value] ?? null);

const expectedText = computed(() => {
  if (expectationKind.value === 'smoke') return '';
  return expectedCase.value?.expected?.trim() ?? '';
});

const expectedMeta = computed(() => {
  const format = expectedCase.value?.expectedFormat?.trim();
  const lines = expectedText.value.split('\n').filter(Boolean).length;
  return format ? `${format} · ${lines} lines` : `${lines} lines`;
});
</script>

<style scoped>
.run-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-default);
  background: var(--surface-subtle);
}

.detail-title {
  margin: 0;
  color: var(--ink);
  font-size: var(--text-title);
  font-weight: var(--weight-semibold);
}

.head-icon {
  color: var(--ink-muted);
}

.ink-pass {
  color: var(--success-ink);
}

.ink-fail {
  color: var(--danger-ink);
}

.head-meta {
  color: var(--ink-muted);
  font-size: var(--text-label);
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
  gap: var(--space-2);
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.head-button:disabled {
  color: var(--ink-disabled);
  cursor: not-allowed;
}

.is-spinning {
  animation: run-detail-spin 1s linear infinite;
}

@keyframes run-detail-spin {
  to {
    transform: rotate(360deg);
  }
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex: 1;
  min-height: 0;
  padding: var(--space-5);
  overflow-y: auto;
}

.block-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.muted {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.verdict {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--text-label);
}

.verdict-pass {
  border-color: var(--success-border);
  background: var(--success-surface);
  color: var(--success-ink);
}

.verdict-fail {
  border-color: var(--danger-border);
  background: var(--danger-surface);
  color: var(--danger-ink);
}

.verdict-text {
  font-weight: var(--weight-semibold);
}

.verdict-meta {
  margin-left: auto;
  opacity: 0.8;
}

.case-results {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.case-result {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
  text-align: left;
  cursor: pointer;
}

.case-result.on {
  border-color: var(--border-default);
  background: var(--surface-subtle);
}

.case-result-name {
  flex-shrink: 0;
}

.case-result-message {
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.case-dot-pass {
  /* The state role, not the ink one — this is a fill, not text. */
  background: var(--state-valid);
}

.case-dot-fail {
  background: var(--state-invalid);
}

.diff {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.diff-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 320px;
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  list-style: none;
  overflow: auto;
}

.diff-line {
  display: flex;
  gap: var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-mark {
  flex-shrink: 0;
  font-weight: var(--weight-semibold);
}

.diff-missing {
  color: var(--danger-ink);
}

.diff-unexpected {
  color: var(--success-ink);
}

.result-block {
  min-width: 0;
}
</style>
