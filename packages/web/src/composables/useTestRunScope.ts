/**
 * What last ran, and how long it took.
 *
 * The verdicts themselves live in `useTestsStore` (and, across reloads, in
 * `lib/testRunCache`). What is missing from them is the *scope*: which tests
 * were asked for, under what name, when, and for how long. Without that a
 * verdict map is a rail's worth of colour and nothing more — it cannot say "12
 * of 47, by tag, 48 seconds", which is the whole content of the Runs tab.
 *
 * Kept module-level so the sidebar, the results pane and the run actions in
 * the page all read one run. Persisted alongside the verdict cache so a reload
 * lands on the same run rather than an empty tab; that persistence is this
 * file's business alone — see `lib/testRunSummary` for the shape everything
 * else reads.
 */
import { computed, reactive } from 'vue';
import type { TestRunScope, TestRunScopeKind } from '../lib/testRunSummary.js';

const STORAGE_KEY = 'sqlib.testRunScope.v1';

type ScopeState = {
  scope: TestRunScope | null;
  /** True between `beginRun` and `endRun`, so the tab can stream. */
  running: boolean;
};

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function loadScope(): TestRunScope | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const scope = parsed as Partial<TestRunScope>;
    if (!Array.isArray(scope.testIds) || typeof scope.label !== 'string') return null;
    return {
      kind: (scope.kind as TestRunScopeKind) ?? 'all',
      label: scope.label,
      tagIds: Array.isArray(scope.tagIds) ? scope.tagIds : [],
      match: scope.match === 'all' ? 'all' : 'any',
      testIds: scope.testIds.filter((id): id is string => typeof id === 'string'),
      answeredIds: Array.isArray(scope.answeredIds)
        ? scope.answeredIds.filter((id): id is string => typeof id === 'string')
        : // A scope stored before answers were recorded described a finished
          // run, so everything it named had answered.
          (scope.testIds as string[]).filter((id) => typeof id === 'string'),
      startedAt: typeof scope.startedAt === 'string' ? scope.startedAt : new Date().toISOString(),
      finishedAt: typeof scope.finishedAt === 'string' ? scope.finishedAt : null,
      wallMs: typeof scope.wallMs === 'number' ? scope.wallMs : 0,
      cancelled: Boolean(scope.cancelled),
    };
  } catch {
    return null;
  }
}

function persist(scope: TestRunScope | null): void {
  const store = storage();
  if (!store) return;
  try {
    if (scope) store.setItem(STORAGE_KEY, JSON.stringify(scope));
    else store.removeItem(STORAGE_KEY);
  } catch {
    // Quota is shared. A run that cannot be remembered is a Runs tab that is
    // empty after a reload, which is the behaviour this file improves on
    // rather than one it has to guarantee.
  }
}

const state = reactive<ScopeState>({
  // A run outlives the tab it was started in, so the tab has something to show
  // on the first paint after a reload.
  scope: loadScope(),
  running: false,
});

let startedAtMs = 0;

export function useTestRunScope() {
  const scope = computed(() => state.scope);
  const running = computed(() => state.running);
  const answered = computed(() => state.scope?.answeredIds.length ?? 0);
  const hasRun = computed(() => state.scope !== null && state.scope.testIds.length > 0);

  /**
   * Open a run. Everything the tab shows is "of this run" from here on.
   *
   * The scope is written before the first verdict lands so the rows can stream
   * in against a list that is already the right length — a run that is going
   * has to look different from one that answered for nine of twelve.
   */
  function beginRun(input: {
    kind: TestRunScopeKind;
    label: string;
    testIds: string[];
    tagIds?: string[];
    match?: 'any' | 'all';
  }): void {
    startedAtMs = Date.now();
    state.running = true;
    state.scope = {
      kind: input.kind,
      label: input.label,
      tagIds: input.tagIds ?? [],
      match: input.match ?? 'any',
      testIds: [...input.testIds],
      // Nothing has answered yet, so nothing of the last run's verdicts counts
      // towards this one. This is what stops Run all repainting the previous
      // run's tallies before a single test has been asked.
      answeredIds: [],
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: null,
      wallMs: 0,
      cancelled: false,
    };
    persist(state.scope);
  }

  /**
   * These tests have answered this run.
   *
   * Called as each verdict lands, so the tab fills in rather than snapping into
   * place at the end — and so nothing on it describes the run before this one.
   */
  function noteAnswered(testIds: string[]): void {
    if (!state.scope || testIds.length === 0) return;
    const known = new Set(state.scope.answeredIds);
    const added = testIds.filter((id) => !known.has(id));
    if (added.length === 0) return;
    state.scope = { ...state.scope, answeredIds: [...state.scope.answeredIds, ...added] };
    persist(state.scope);
  }

  /**
   * Close the run.
   *
   * `testIds` may be narrowed here: a tag run only learns which tests the tag
   * held when the server answers, and the scope has to name what actually ran
   * rather than this client's guess at it.
   */
  function endRun(input?: { testIds?: string[]; answeredIds?: string[]; cancelled?: boolean }): void {
    state.running = false;
    if (!state.scope) return;
    const answeredIds = input?.answeredIds
      ? [...new Set([...state.scope.answeredIds, ...input.answeredIds])]
      : state.scope.answeredIds;
    state.scope = {
      ...state.scope,
      testIds: input?.testIds ? [...input.testIds] : state.scope.testIds,
      answeredIds,
      finishedAt: new Date().toISOString(),
      wallMs: Math.max(0, Date.now() - startedAtMs),
      cancelled: Boolean(input?.cancelled),
    };
    persist(state.scope);
  }

  function clearRun(): void {
    state.scope = null;
    state.running = false;
    persist(null);
  }

  return { scope, running, answered, hasRun, beginRun, noteAnswered, endRun, clearRun };
}
