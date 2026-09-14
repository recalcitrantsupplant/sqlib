/**
 * The last verdict each test produced, kept in the browser across reloads.
 *
 * A verdict is not part of a test — the same test version run twice against a
 * live backend can legitimately pass and then fail, so storing one on the
 * entity would make a run look like an edit. But losing every verdict on a
 * reload is its own lie: run 205 tests, glance away, come back to a rail with
 * no colour in it and nothing to say which of them you had already answered.
 *
 * So verdicts live here: browser-local, this-machine-only, and stamped with
 * the test version they were produced against. A verdict whose version no
 * longer matches the test's current one is dropped on load rather than shown,
 * because a green dot beside a test you have since edited is worse than no dot
 * at all. Durable, shared run history is a server-side `TestRun` entity and is
 * a different thing from this — see issue #179.
 */
import type { TestRunResult } from '../composables/useApiClient.js';

const STORAGE_KEY = 'sqlib.testRuns.v1';

/**
 * Roughly 2 MB of the ~5 MB browsers allow, leaving room for everything else
 * that wants localStorage. A run carries its result text, so a few hundred
 * graph tests do add up; the oldest go first when they do.
 */
const MAX_BYTES = 2_000_000;

type RunMap = Record<string, TestRunResult>;

function storage(): Storage | null {
  // Nuxt prerenders this app, and a private-mode browser can throw on access
  // rather than on write. Neither is worth failing a page load over.
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A run is only shaped like one if it can be keyed and dated. */
function isRun(value: unknown): value is TestRunResult {
  if (!value || typeof value !== 'object') return false;
  const run = value as Partial<TestRunResult>;
  return (
    typeof run.testId === 'string'
    && typeof run.passed === 'boolean'
    && typeof run.ranAt === 'string'
  );
}

/** Oldest first, so eviction can take from the front. */
function byAge(runs: TestRunResult[]): TestRunResult[] {
  return [...runs].sort((a, b) => a.ranAt.localeCompare(b.ranAt));
}

export function loadRuns(): RunMap {
  const store = storage();
  if (!store) return {};
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const runs: RunMap = {};
    for (const [testId, run] of Object.entries(parsed as Record<string, unknown>)) {
      if (isRun(run) && run.testId === testId) {
        runs[testId] = run;
      }
    }
    return runs;
  } catch {
    // A half-written or stale-shaped payload is not worth recovering; the next
    // run rewrites it.
    return {};
  }
}

export function saveRuns(runs: RunMap): void {
  const store = storage();
  if (!store) return;
  let remaining = Object.values(runs);
  for (;;) {
    const payload = JSON.stringify(
      Object.fromEntries(remaining.map((run) => [run.testId, run])),
    );
    if (payload.length <= MAX_BYTES) {
      try {
        store.setItem(STORAGE_KEY, payload);
      } catch {
        // Quota is shared, so another tab or feature can take it out from under
        // us. A missing cache degrades to the old session-only behaviour.
      }
      return;
    }
    if (remaining.length <= 1) {
      // One run alone is over budget — a very large graph result. Drop the lot
      // rather than store a single verdict at the cost of every other.
      try {
        store.removeItem(STORAGE_KEY);
      } catch {
        /* nothing to do */
      }
      return;
    }
    remaining = byAge(remaining).slice(1);
  }
}

/**
 * Drop verdicts that no longer describe anything: a test that is gone, or one
 * whose current version is not the version the verdict was produced against.
 */
export function pruneStaleRuns(
  runs: RunMap,
  tests: Array<{ id: string; currentVersion?: string | null }>,
): RunMap {
  const currentVersionByTest = new Map(tests.map((test) => [test.id, test.currentVersion ?? null]));
  const kept: RunMap = {};
  for (const [testId, run] of Object.entries(runs)) {
    if (!currentVersionByTest.has(testId)) continue;
    const currentVersion = currentVersionByTest.get(testId) ?? null;
    // A test with no current version has nothing to disagree with; a run with
    // no version recorded (the "could not run" placeholder) is kept for the
    // message it carries.
    if (currentVersion && run.testVersionId && run.testVersionId !== currentVersion) continue;
    kept[testId] = run;
  }
  return kept;
}

/**
 * What the cache is costing, for the Runs tab's footer.
 *
 * A debug affordance rather than a feature: the cache is the only place a run
 * lives today, so how close it is to eviction is worth being able to see. It
 * goes when runs are server-side.
 */
export function runCacheUsage(): { key: string; bytes: number; maxBytes: number } {
  const store = storage();
  let bytes = 0;
  try {
    bytes = store?.getItem(STORAGE_KEY)?.length ?? 0;
  } catch {
    bytes = 0;
  }
  return { key: STORAGE_KEY, bytes, maxBytes: MAX_BYTES };
}

export function clearRuns(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}
