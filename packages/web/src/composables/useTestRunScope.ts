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
 * the page all read one run. Each library keeps its own last run: a run starts
 * from one library's tests, so the Runs tab of another library shows that
 * library's run, or none. Persisted alongside the verdict cache so a reload
 * lands on the same run rather than an empty tab; that persistence is this
 * file's business alone — see `lib/testRunSummary` for the shape everything
 * else reads.
 */
import { computed, reactive } from 'vue';
import type { TestRunScope, TestRunScopeKind } from '../lib/testRunSummary.js';
import { useActiveLibrary } from './useActiveLibrary.js';

/** Library id → that library's last run. */
const STORAGE_KEY = 'sqlib.testRunScope.v2';
/** One run for all libraries. Its library is not recorded, so it is dropped. */
const LEGACY_STORAGE_KEY = 'sqlib.testRunScope.v1';
/** The key for runs started with no library selected. */
const NO_LIBRARY = '';

type ScopeState = {
  scopes: Record<string, TestRunScope>;
  /** The library of the run between `beginRun` and `endRun`, or null. */
  runningLibrary: string | null;
  /**
   * Counts `beginRun` calls. A screen that reacts to a new run watches this:
   * the current scope also changes when the library changes.
   */
  begun: number;
};

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parseScope(parsed: unknown): TestRunScope | null {
  try {
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

function loadScopes(): Record<string, TestRunScope> {
  const store = storage();
  if (!store) return {};
  try {
    store.removeItem(LEGACY_STORAGE_KEY);
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const scopes: Record<string, TestRunScope> = {};
    for (const [libraryId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const scope = parseScope(value);
      if (scope) scopes[libraryId] = scope;
    }
    return scopes;
  } catch {
    return {};
  }
}

function persist(scopes: Record<string, TestRunScope>): void {
  const store = storage();
  if (!store) return;
  try {
    if (Object.keys(scopes).length > 0) store.setItem(STORAGE_KEY, JSON.stringify(scopes));
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
  scopes: loadScopes(),
  runningLibrary: null,
  begun: 0,
});

let startedAtMs = 0;

export function useTestRunScope() {
  const { activeLibraryId } = useActiveLibrary();
  const currentLibrary = computed(() => activeLibraryId.value ?? NO_LIBRARY);

  const scope = computed(() => state.scopes[currentLibrary.value] ?? null);
  const running = computed(() => state.runningLibrary === currentLibrary.value);
  const begun = computed(() => state.begun);
  const answered = computed(() => scope.value?.answeredIds.length ?? 0);
  const hasRun = computed(() => scope.value !== null && scope.value.testIds.length > 0);

  /** The run that `noteAnswered` and `endRun` write to: the one in progress. */
  const runLibrary = () => state.runningLibrary ?? currentLibrary.value;

  function write(libraryId: string, next: TestRunScope | null): void {
    const scopes = { ...state.scopes };
    if (next) scopes[libraryId] = next;
    else delete scopes[libraryId];
    state.scopes = scopes;
    persist(scopes);
  }

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
    const libraryId = currentLibrary.value;
    state.runningLibrary = libraryId;
    state.begun += 1;
    write(libraryId, {
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
    });
  }

  /**
   * These tests have answered this run.
   *
   * Called as each verdict lands, so the tab fills in rather than snapping into
   * place at the end — and so nothing on it describes the run before this one.
   */
  function noteAnswered(testIds: string[]): void {
    const libraryId = runLibrary();
    const current = state.scopes[libraryId];
    if (!current || testIds.length === 0) return;
    const known = new Set(current.answeredIds);
    const added = testIds.filter((id) => !known.has(id));
    if (added.length === 0) return;
    write(libraryId, { ...current, answeredIds: [...current.answeredIds, ...added] });
  }

  /**
   * Close the run.
   *
   * `testIds` may be narrowed here: a tag run only learns which tests the tag
   * held when the server answers, and the scope has to name what actually ran
   * rather than this client's guess at it.
   */
  function endRun(input?: { testIds?: string[]; answeredIds?: string[]; cancelled?: boolean }): void {
    const libraryId = runLibrary();
    state.runningLibrary = null;
    const current = state.scopes[libraryId];
    if (!current) return;
    const answeredIds = input?.answeredIds
      ? [...new Set([...current.answeredIds, ...input.answeredIds])]
      : current.answeredIds;
    write(libraryId, {
      ...current,
      testIds: input?.testIds ? [...input.testIds] : current.testIds,
      answeredIds,
      finishedAt: new Date().toISOString(),
      wallMs: Math.max(0, Date.now() - startedAtMs),
      cancelled: Boolean(input?.cancelled),
    });
  }

  /** Forget the current library's last run. */
  function clearRun(): void {
    if (state.runningLibrary === currentLibrary.value) state.runningLibrary = null;
    write(currentLibrary.value, null);
  }

  return { scope, running, begun, answered, hasRun, beginRun, noteAnswered, endRun, clearRun };
}
