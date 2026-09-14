/**
 * The last run, assembled from the pieces the app already holds.
 *
 * This is the one adapter the handover asks for: the Runs tab and the results
 * pane read a `TestRunSummary` and nothing else, and everything about *where a
 * run comes from* is here. Today that is the scope in `useTestRunScope` over
 * the verdicts in `useTestsStore`; when a server-side run entity lands, this
 * file fetches it and the screens do not change.
 *
 * Two lookups the verdicts do not carry are resolved here as well:
 *
 *  - the group a test belongs to, which is a library tag, so the Runs tab
 *    groups exactly as the Tests tab does;
 *  - the backend it ran against, which lives on the test *version* rather than
 *    on the verdict. Versions are fetched once per test in the run and cached
 *    in the tests store, so the breakdown can ask "is one store broken?" of
 *    real stores rather than of a placeholder.
 */
import { computed, ref, watch } from 'vue';
import { useTestsStore } from './useTestsStore.js';
import { useTagsStore } from './useTagsStore.js';
import { useBackendsStore } from './useBackendsStore.js';
import { useTestRunScope } from './useTestRunScope.js';
import { runCacheUsage } from '../lib/testRunCache.js';
import {
  buildTestRunSummary,
  type TestRunBackend,
  type TestRunSummary,
} from '../lib/testRunSummary.js';

/** A run against no named backend is a run in the ephemeral store, not a gap. */
const HERMETIC: TestRunBackend = { id: '__hermetic__', name: 'In-memory (hermetic)', color: null };

/** The same six the rest of the app draws series in, so a store keeps its colour. */
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];

export function useTestRunSummary() {
  const testsStore = useTestsStore();
  const tagsStore = useTagsStore();
  const backendsStore = useBackendsStore();
  const { scope, running, endRun, beginRun, noteAnswered, clearRun } = useTestRunScope();

  /** Test id → the store its run version named. Filled as versions arrive. */
  const backendByTest = ref<Record<string, TestRunBackend>>({});

  const backendColor = (backendId: string) => {
    const index = backendsStore.backends.value.findIndex((backend) => backend.id === backendId);
    return index >= 0 ? SERIES[index % SERIES.length] : null;
  };

  /**
   * Fetch the versions the run's verdicts name, once each.
   *
   * Only the tests in the run, and only the ones whose version is not already
   * in the store: the point of the breakdown is the run in front of you, not a
   * crawl of the library.
   */
  async function resolveBackends(): Promise<void> {
    const current = scope.value;
    if (!current) return;
    for (const testId of current.testIds) {
      const verdict = testsStore.lastRunByTest.value[testId];
      if (!verdict) continue;
      if (verdict.hermetic) {
        backendByTest.value = { ...backendByTest.value, [testId]: HERMETIC };
        continue;
      }
      let versions = testsStore.versionsFor(testId).value;
      if (versions.length === 0) {
        try {
          versions = await testsStore.loadVersions(testId);
        } catch {
          // A version that cannot be read leaves the row in the breakdown's
          // "not recorded" bucket, which is honest — better than dropping the
          // row and having the two columns disagree about the same run.
          continue;
        }
      }
      const version = versions.find((one) => one.id === verdict.testVersionId);
      const backendId = version?.backend ?? null;
      if (!backendId) continue;
      const backend = backendsStore.backends.value.find((one) => one.id === backendId);
      backendByTest.value = {
        ...backendByTest.value,
        [testId]: {
          id: backendId,
          name: backend?.name ?? 'Backend',
          color: backendColor(backendId),
        },
      };
    }
  }

  // A new run answers for a different set of tests; the old attribution is not
  // wrong so much as about something else.
  watch(() => scope.value?.startedAt, () => { backendByTest.value = {}; });

  // Re-resolve as verdicts land, so a run that is still going fills its
  // breakdown in rather than snapping into place at the end.
  watch(
    () => (scope.value ? scope.value.testIds.map((id) => testsStore.lastRunByTest.value[id]?.testVersionId ?? '').join('|') : ''),
    () => { void resolveBackends(); },
    { immediate: true },
  );

  const summary = computed<TestRunSummary | null>(() => {
    const current = scope.value;
    if (!current || current.testIds.length === 0) return null;
    const tags = Object.fromEntries(
      tagsStore.tags.value.map((tag) => [tag.id, { name: tag.name, color: tag.color ?? null }]),
    );
    const inScope = new Set(current.testIds);
    return buildTestRunSummary({
      scope: current,
      running: running.value,
      tests: testsStore.tests.value.filter((test) => inScope.has(test.id)),
      results: Object.fromEntries(
        current.testIds
          .map((id) => [id, testsStore.lastRunByTest.value[id]] as const)
          .filter(([, verdict]) => Boolean(verdict)),
      ),
      tags,
      tagOrder: tagsStore.tags.value.map((tag) => tag.id),
      backends: backendByTest.value,
    });
  });

  /** `sqlib.testRuns.v1 · 218 KB of 2 MB` — a debug line, not a feature. */
  const storageNote = computed(() => {
    const usage = runCacheUsage();
    const kb = Math.round(usage.bytes / 1024);
    const mb = Math.round(usage.maxBytes / 1_000_000);
    return `${usage.key} · ${kb} KB of ${mb} MB`;
  });

  return {
    summary,
    scope,
    running,
    storageNote,
    beginRun,
    noteAnswered,
    endRun,
    clearRun,
  };
}
