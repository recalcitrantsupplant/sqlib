<template>
  <!--
    The Tests rail section, filtered to one subject. Deliberately the same
    entities and the same store rather than a parallel listing: two views that
    can disagree about what tests exist would be worse than no tab at all.
  -->
  <div class="subject-tests" data-testid="subject-tests">
    <!--
      The row is about the tests in the list, so it is drawn only when there
      are some: over the empty state it was a disabled control offering to run
      nothing. `.run-all` carries its own spec — inherited type made it the
      largest thing on the tab, above the heading it sat over.
    -->
    <Toolbar v-if="tests.length" variant="plain">
      <template #start>
        <button
          class="run-all"
          type="button"
          data-testid="subject-tests-run-all"
          :disabled="runningAll"
          @click="runAll"
        >
          <Play :size="12" />
          {{ runningAll ? 'Running…' : 'Run all' }}
        </button>
      </template>
      <span v-if="summary" class="summary" data-testid="subject-tests-summary">{{ summary }}</span>
    </Toolbar>

    <EmptyState
      v-if="tests.length === 0"
      size="sm"
      title="No tests yet"
      :description="`A test is this ${subjectNoun} plus its inputs and what it should produce. Write one in the Tests section.`"
      data-testid="subject-tests-empty"
    />

    <ul v-else class="test-list">
      <li v-for="test in tests" :key="test.id" class="test-row" data-testid="subject-test-row">
        <button class="test-open" type="button" :title="test.description ?? ''" @click="emit('open', test.id)">
          {{ test.name }}
        </button>

        <StatusBadge
          :status="statusOf(test.id)"
          :title="titleOf(test.id)"
          data-testid="subject-test-verdict"
        >
          {{ verdictLabel(test.id) }}
        </StatusBadge>

        <button
          class="test-run"
          type="button"
          data-testid="subject-test-run"
          :disabled="isRunning(test.id)"
          @click="run(test.id)"
        >
          Run
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * Every test that points at one subject.
 *
 * A "not run" badge is not a failure, and the difference matters: a test whose
 * verdict is unknown in this session is a different thing from one that ran and
 * disagreed, and colouring them alike would train people to ignore red. That
 * distinction is `StatusBadge`'s `idle` versus `invalid`, so this panel says it
 * in the same colours every other surface says it in.
 */
import { computed, onMounted, ref } from 'vue';
import { Play } from '@lucide/vue';
import EmptyState from '../shared/EmptyState.vue';
import StatusBadge from '../shared/StatusBadge.vue';
import Toolbar from '../shared/Toolbar.vue';
import { useTestsStore } from '@/composables/useTestsStore';

const props = defineProps<{
  subjectId: string;
  /** "rule set", "query", "group" — used in the empty state's sentence. */
  subjectNoun: string;
}>();

const emit = defineEmits<{ (e: 'open', testId: string): void }>();

const testsStore = useTestsStore();
const runningAll = ref(false);

// The store's own selector, handed the prop as a getter so the list follows a
// subject that changes under a mounted tab. Filtering here instead would be the
// same rule written twice, in the one place the store already answers.
const tests = testsStore.testsForSubject(() => props.subjectId);

function isRunning(testId: string) {
  return testsStore.runningTestIds.value.includes(testId);
}

/** The shared status vocabulary, so a verdict reads the same here as anywhere. */
function statusOf(testId: string): 'valid' | 'invalid' | 'running' | 'idle' {
  if (isRunning(testId)) return 'running';
  const result = testsStore.lastRunByTest.value[testId];
  if (!result) return 'idle';
  return result.passed ? 'valid' : 'invalid';
}

function verdictLabel(testId: string) {
  if (isRunning(testId)) return 'running';
  const result = testsStore.lastRunByTest.value[testId];
  if (!result) return 'not run';
  return result.passed ? 'passed' : 'failed';
}

/** The failure message, on hover — too long for the badge, too useful to drop. */
function titleOf(testId: string) {
  return testsStore.lastRunByTest.value[testId]?.message || '';
}

const summary = computed(() => {
  const results = tests.value
    .map((test) => testsStore.lastRunByTest.value[test.id])
    .filter(Boolean);
  if (results.length === 0) return '';
  const passed = results.filter((result) => result!.passed).length;
  return `${passed}/${results.length} passing`;
});

async function run(testId: string) {
  await testsStore.runTest(testId).catch(() => {
    // The store records nothing for a test that could not run, which leaves
    // the badge on "not run" — accurate, and not a claim that it failed.
  });
}

async function runAll() {
  runningAll.value = true;
  try {
    await testsStore.runTests(tests.value.map((test) => test.id));
  } finally {
    runningAll.value = false;
  }
}

onMounted(() => {
  if (testsStore.tests.value.length === 0) void testsStore.loadTests();
});
</script>

<style scoped>
.subject-tests {
  display: flex;
  flex-direction: column;
}

/* The same object as a row's Run button, with the icon inline beside its label. */
.run-all {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-h-sm);
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  line-height: 1;
  cursor: pointer;
}

.run-all:hover:not(:disabled) {
  background: var(--surface-raised);
  color: var(--ink);
}

.run-all:disabled {
  cursor: default;
  opacity: 0.6;
}

.summary {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.test-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3) var(--space-5);
  list-style: none;
}

.test-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.test-open {
  flex: 1;
  border: none;
  background: none;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-label);
  text-align: left;
  cursor: pointer;
}

.test-open:hover {
  text-decoration: underline;
}

.test-run {
  height: var(--control-h-sm);
  padding: 0 var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink-secondary);
  font-family: inherit;
  font-size: var(--text-label);
  cursor: pointer;
}

.test-run:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
