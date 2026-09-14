/**
 * The library's tests, and the verdict each one last produced.
 *
 * Verdicts live here rather than on the entity because they are not part of a
 * test: the same test version run twice against a live backend can legitimately
 * pass and then fail, and persisting that as a property of the test would make
 * a run look like an edit. They are keyed by test id and cached in the browser
 * so a reload does not throw away a run of the whole suite — see
 * `lib/testRunCache.ts` for what that cache will and will not keep.
 */
import { computed, type MaybeRefOrGetter, reactive, toValue } from 'vue';
import type { Test } from '@sparql-query-lib/contracts';
import { loadRuns, pruneStaleRuns, saveRuns } from '../lib/testRunCache.js';
import {
  useApiClient,
  type TaggedTestRun,
  type TagMatchMode,
  type TestRunResult,
  type TestVersion,
} from './useApiClient.js';

type TestsState = {
  tests: Test[];
  versionsByTest: Record<string, TestVersion[]>;
  lastRunByTest: Record<string, TestRunResult>;
  runningTestIds: string[];
  loading: boolean;
  error: string | null;
};

const state = reactive<TestsState>({
  tests: [],
  versionsByTest: {},
  // Rehydrated before any test is loaded, so the rail has its colour on the
  // first paint rather than after a round trip. Verdicts for tests that have
  // since changed are dropped once the listing arrives.
  lastRunByTest: loadRuns(),
  runningTestIds: [],
  loading: false,
  error: null,
});

/**
 * A bulk run writes one verdict per test, and each write serialises the whole
 * map — quadratic over a suite of a few hundred. Held while running many, so
 * the cache is written once at the end instead.
 */
let persistDeferred = false;

function persistRuns() {
  if (persistDeferred) return;
  saveRuns(state.lastRunByTest);
}

/**
 * The same selection the server makes, for the spinner only.
 *
 * Duplicated rather than shared because it answers a different question here:
 * the server decides what *runs*, this decides what *looks like it is running*
 * while the request is in flight. A drift between the two shows as a row that
 * spins without a verdict, never as a test that did or did not run.
 */
function matchesTags(carried: string[], wanted: string[], match: TagMatchMode): boolean {
  return match === 'all'
    ? wanted.every((tag) => carried.includes(tag))
    : wanted.some((tag) => carried.includes(tag));
}

export function useTestsStore() {
  const apiClient = useApiClient();

  const tests = computed(() => state.tests);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);
  const lastRunByTest = computed(() => state.lastRunByTest);
  const runningTestIds = computed(() => state.runningTestIds);

  const loadTests = async () => {
    state.loading = true;
    state.error = null;
    try {
      state.tests = await apiClient.listTests();
      const kept = pruneStaleRuns(state.lastRunByTest, state.tests);
      if (Object.keys(kept).length !== Object.keys(state.lastRunByTest).length) {
        state.lastRunByTest = kept;
        persistRuns();
      }
    } catch (err: unknown) {
      state.error = err instanceof Error ? err.message : 'Failed to load tests';
      state.tests = [];
    } finally {
      state.loading = false;
    }
  };

  /**
   * The tests pointing at one subject — the Tests tab on a record page.
   *
   * Takes a `MaybeRefOrGetter` rather than a plain string, which is what makes
   * that sentence true: the tab is mounted once per screen and its subject
   * changes underneath it, so a helper closed over the id it was called with
   * would go on listing the tests of the entity that happened to be open when
   * the tab was created. Reading the subject inside the computed means one
   * subscription for the life of the tab rather than a new `computed` per
   * evaluation, which is the cost of the `store.thing(id).value` shape used
   * elsewhere in these stores.
   */
  const testsForSubject = (subject: MaybeRefOrGetter<string>) =>
    computed(() => state.tests.filter((test) => test.subject === toValue(subject)));

  const loadVersions = async (testId: string) => {
    const versions = await apiClient.listTestVersions(testId);
    state.versionsByTest[testId] = versions;
    return versions;
  };

  const versionsFor = (testId: string) => computed(() => state.versionsByTest[testId] ?? []);

  const createTest = async (input: Parameters<typeof apiClient.createTest>[0]) => {
    const { data } = await apiClient.createTest(input);
    state.tests = [...state.tests, data];
    return data;
  };

  /** Write (or clear) a version's note; everything else about it is frozen. */
  const annotateVersion = async (testId: string, version: number, comment: string | null) => {
    const { data } = await apiClient.annotateTestVersion(testId, version, comment);
    state.versionsByTest[testId] = (state.versionsByTest[testId] ?? []).map((entry) =>
      entry.id === data.id ? data : entry,
    );
    return data;
  };

  const createVersion = async (testId: string, input: Record<string, unknown>) => {
    const { data } = await apiClient.createTestVersion(testId, input);
    state.versionsByTest[testId] = [...(state.versionsByTest[testId] ?? []), data];
    // The server points the test at the new version; reflecting that here keeps
    // a listing's "v3" from lagging a save by one refresh.
    state.tests = state.tests.map((test) =>
      test.id === testId ? { ...test, currentVersion: data.id } : test,
    );
    // The verdict described the version that was just superseded. Keeping it
    // would show a green dot beside a test that has not been run.
    if (state.lastRunByTest[testId]) {
      delete state.lastRunByTest[testId];
      persistRuns();
    }
    return data;
  };

  const deleteTest = async (testId: string) => {
    await apiClient.deleteTest(testId);
    state.tests = state.tests.filter((test) => test.id !== testId);
    delete state.versionsByTest[testId];
    delete state.lastRunByTest[testId];
    persistRuns();
  };

  const runTest = async (testId: string, version?: number | null) => {
    state.runningTestIds = [...state.runningTestIds, testId];
    try {
      const result = await apiClient.runTest(testId, { version });
      state.lastRunByTest[testId] = result;
      persistRuns();
      return result;
    } finally {
      state.runningTestIds = state.runningTestIds.filter((id) => id !== testId);
    }
  };

  /** Run several, in order, keeping every verdict — one failure does not stop the rest. */
  const runTests = async (testIds: string[]) => {
    const results: TestRunResult[] = [];
    persistDeferred = true;
    try {
      for (const testId of testIds) {
        try {
          results.push(await runTest(testId));
        } catch (err: unknown) {
          // A test that cannot run is reported as one that did not pass, so the
          // summary counts every test asked for rather than silently fewer.
          results.push({
            testId,
            testVersionId: '',
            passed: false,
            message: err instanceof Error ? err.message : 'Test could not be run',
            expectationKind: 'smoke',
            hermetic: true,
            durationMs: 0,
            subjectVersionId: null,
            ranAt: new Date().toISOString(),
            // No case ran, so there is nothing to report per case — which is a
            // different thing from every case passing.
            cases: [],
            passedCount: 0,
            failedCount: 0,
          });
        }
      }
    } finally {
      persistDeferred = false;
      persistRuns();
    }
    return results;
  };

  /**
   * Run every test carrying one or more tags, in one request.
   *
   * The server selects and runs, so this is not `runTests` with a filter in
   * front of it: the SPA never has to know which tests a tag holds, and a tag
   * that gained a test since the list was loaded still runs it. Verdicts land
   * in the same map the row-by-row runs write, so the rail colours identically
   * either way.
   *
   * The rows do not tick over one at a time — there is one round trip, so they
   * all arrive together. That is the trade the single request makes, and it is
   * why the per-row and per-section runs still use `runTests`.
   */
  const runTaggedTests = async (tagIds: string[], match: TagMatchMode = 'any'): Promise<TaggedTestRun> => {
    if (tagIds.length === 0) {
      return { tags: [], match, requested: 0, passed: 0, failed: 0, results: [] };
    }
    const spinning = state.tests
      .filter((test) => matchesTags(test.tags ?? [], tagIds, match))
      .map((test) => test.id);
    state.runningTestIds = [...state.runningTestIds, ...spinning];
    persistDeferred = true;
    try {
      const run = await apiClient.runTestsByTags({ tags: tagIds, match });
      for (const result of run.results) state.lastRunByTest[result.testId] = result;
      return run;
    } finally {
      persistDeferred = false;
      persistRuns();
      // Only the ids this call added: a single row started by hand while the
      // tag run was in flight is still running, and clearing the list wholesale
      // would leave it spinning for ever.
      state.runningTestIds = state.runningTestIds.filter((id) => !spinning.includes(id));
    }
  };

  return {
    tests,
    loading,
    error,
    lastRunByTest,
    runningTestIds,
    loadTests,
    testsForSubject,
    loadVersions,
    versionsFor,
    createTest,
    createVersion,
    annotateVersion,
    deleteTest,
    runTest,
    runTests,
    runTaggedTests,
  };
}
