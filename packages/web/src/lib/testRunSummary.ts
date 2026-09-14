/**
 * One run of the test suite, as the Runs tab reads it.
 *
 * A run is a *scope*, not a page of history: everything the tab shows — the
 * tallies, the two breakdowns, the failures list, the re-run — means "of this
 * run". So the summary is built from the tests the run asked for and the
 * verdicts they produced, and a test the scope named but that produced no
 * verdict is `excluded` rather than quietly absent.
 *
 * The library holds no run entity today, so the verdicts come from the
 * browser-local cache behind `useTestRunScope`. That is deliberately one
 * function away from everything here: when a server-side run lands, the same
 * summary is built from the response and no component on the screen changes.
 * Nothing below reads `localStorage`.
 */
import type { TestRunResult } from '../composables/useApiClient.js';

/** What was asked to run. The chip at the top of the Runs tab says this. */
export type TestRunScopeKind = 'all' | 'tag' | 'group' | 'test';

export interface TestRunScope {
  kind: TestRunScopeKind;
  /** What the chip reads: `tag: conformance`, `all tests`, or a test's name. */
  label: string;
  /** The tags a tag run named, so Re-run can ask the server the same question. */
  tagIds: string[];
  match: 'any' | 'all';
  /** Every test the scope covered, whether or not it produced a verdict. */
  testIds: string[];
  /**
   * The tests that have answered *this* run.
   *
   * Verdicts outlive the run that produced them — that is the whole point of
   * the cache — so "has a verdict" cannot mean "answered here". Without this,
   * pressing Run all repaints the previous run's bars instantly and then
   * changes a duration, which reads as a run that finished before it started.
   *
   * Recorded rather than inferred from timestamps: `ranAt` comes from the
   * server and the scope's clock is the browser's, so a comparison between
   * them is a clock-skew bug waiting to happen.
   */
  answeredIds: string[];
  startedAt: string;
  /** Null while the run is still going. */
  finishedAt: string | null;
  /** Wall clock across the whole run, in ms. */
  wallMs: number;
  /** A run stopped part-way answers for fewer tests than it named. */
  cancelled: boolean;
}

/**
 * Pass, fail, still to answer, or named by the scope and never run.
 *
 * `pending` and `excluded` are the same fact at two times: a test that has not
 * answered is pending while the run is going and excluded once it has stopped.
 */
export type TestRunStatus = 'pass' | 'fail' | 'pending' | 'excluded';

/** The registry facts a summary needs. Deliberately not the whole `Test`. */
export interface TestRunSummaryTest {
  id: string;
  name: string;
  tags?: string[] | null;
  currentVersion?: string | null;
}

/** A tag, as a group heading. */
export interface TestRunGroupTag {
  name: string;
  color: string | null;
}

/** Which store a test ran against — the second breakdown's axis. */
export interface TestRunBackend {
  id: string;
  name: string;
  color?: string | null;
}

export interface TestRunSummaryInput {
  scope: TestRunScope;
  tests: TestRunSummaryTest[];
  /** One verdict per test that produced one, keyed by test id. */
  results: Record<string, TestRunResult>;
  /** The run is still going: what has not answered yet is pending, not absent. */
  running?: boolean;
  /** Tag id → heading, in the library's own order. */
  tags: Record<string, TestRunGroupTag>;
  /** The library's tag ids, in list order, so a test's group is stable. */
  tagOrder?: string[];
  /** Test id → the store it ran against, where that is known. */
  backends?: Record<string, TestRunBackend>;
}

/** One row of the Runs tab's test list. */
export interface TestRunTestRow {
  id: string;
  name: string;
  status: TestRunStatus;
  /** How many cases the test expanded to. `> 1` is a parametrised test. */
  caseCount: number;
  passedCases: number;
  failedCases: number;
  durationMs: number;
  groupKey: string;
  groupLabel: string;
  groupColor: string | null;
  backendId: string | null;
  backendLabel: string | null;
  /** The verdict was produced against a version the test has since left. */
  superseded: boolean;
  message: string;
}

export interface TestRunGroup {
  key: string;
  label: string;
  color: string | null;
  rows: TestRunTestRow[];
  /** Cases, not tests: the heading tally is `8 / 10` of cases. */
  passedCases: number;
  /**
   * Everything this heading holds, counting a test still to answer as one case
   * — the run's denominator is known when it opens, not when it finishes.
   */
  totalCases: number;
  failed: boolean;
}

/** One row of a breakdown: a label and the split behind it. */
export interface TestRunBreakdownRow {
  key: string;
  label: string;
  color: string | null;
  pass: number;
  fail: number;
  excluded: number;
  /**
   * Named by the run, still to answer. Only non-zero while a run is going.
   *
   * Counted in `total` so the bar fills in as the run walks the list. Without
   * it a run's totals are only ever what has already answered, `pass` equals
   * `total` for as long as nothing has failed, and a suite of two hundred
   * tests draws a full green bar from the first verdict to the last.
   */
  pending: number;
  /** Everything the run named here, answered or not. */
  total: number;
}

/** A chip naming one coordinate of the cell that failed. */
export interface TestRunCoordinate {
  label: string;
  kind: 'case' | 'backend' | 'inputs';
  color: string | null;
}

export interface TestRunFailureRow {
  key: string;
  testId: string;
  testName: string;
  caseIndex: number;
  status: 'fail' | 'excluded';
  coordinates: TestRunCoordinate[];
  reason: string;
  durationMs: number;
}

export interface TestRunTallies {
  tests: number;
  cases: number;
  passed: number;
  failed: number;
  excluded: number;
  /** Named by the scope, still to answer. Only non-zero while a run is going. */
  pending: number;
  durationMs: number;
}

export interface TestRunSummary {
  scope: TestRunScope;
  groups: TestRunGroup[];
  rows: TestRunTestRow[];
  tallies: TestRunTallies;
  byGroup: TestRunBreakdownRow[];
  byBackend: TestRunBreakdownRow[];
  failures: TestRunFailureRow[];
  /** Tests the scope named that never ran. */
  excludedCount: number;
}

const UNGROUPED_KEY = '__untagged__';

/**
 * A test belongs to one group here, not to every tag it carries.
 *
 * The Tests tab lists a row under each of its tags, which is right for finding
 * a test. A tally cannot do that: a test under two headings would be counted
 * twice, and `18 cases across 12 tests` would stop being true. So the group is
 * the first tag the library lists, and the arithmetic stays honest.
 */
function groupOf(
  test: TestRunSummaryTest,
  tags: Record<string, TestRunGroupTag>,
  order: string[],
): { key: string; label: string; color: string | null } {
  const carried = test.tags ?? [];
  const ranked = order.length
    ? order.filter((tagId) => carried.includes(tagId))
    : carried.filter((tagId) => tagId in tags);
  const first = ranked[0] ?? carried.find((tagId) => tagId in tags);
  if (first && tags[first]) {
    return { key: first, label: tags[first].name, color: tags[first].color };
  }
  return { key: UNGROUPED_KEY, label: 'Untagged', color: null };
}

/** A run with no cases still answered for itself; a run that never happened did not. */
function caseCountOf(result: TestRunResult | undefined): number {
  if (!result) return 0;
  return result.cases.length > 0 ? result.cases.length : 1;
}

function statusOf(result: TestRunResult | undefined, running: boolean): TestRunStatus {
  if (!result) return running ? 'pending' : 'excluded';
  return result.passed ? 'pass' : 'fail';
}

function addToBreakdown(
  rows: Map<string, TestRunBreakdownRow>,
  key: string,
  label: string,
  color: string | null,
  row: TestRunTestRow,
): void {
  const existing = rows.get(key)
    ?? { key, label, color, pass: 0, fail: 0, excluded: 0, pending: 0, total: 0 };
  if (row.status === 'excluded') {
    existing.excluded += Math.max(row.caseCount, 1);
  } else if (row.status === 'pending') {
    // One, not `caseCount`: how many cases a test expands to is something only
    // running it can say, so a test still to answer counts as itself. The
    // denominator grows when it answers, which is the honest reading — a
    // parametrised test really did turn out to be more work than it looked.
    existing.pending += 1;
  } else {
    existing.pass += row.passedCases;
    existing.fail += row.failedCases;
  }
  existing.total = existing.pass + existing.fail + existing.excluded + existing.pending;
  rows.set(key, existing);
}

/**
 * The whole tab, from the run's scope and whatever verdicts it produced.
 *
 * Pure, and keyed off the scope's `testIds` rather than off the verdict map:
 * "12 of 47" is a fact about what was asked for, and a run that answered for
 * nine of twelve has to be able to say so.
 */
export function buildTestRunSummary(input: TestRunSummaryInput): TestRunSummary {
  const { scope, results, tags } = input;
  const running = Boolean(input.running);
  const answered = new Set(scope.answeredIds);
  const order = input.tagOrder ?? Object.keys(tags);
  const backends = input.backends ?? {};
  const byId = new Map(input.tests.map((test) => [test.id, test]));

  const rows: TestRunTestRow[] = [];
  for (const testId of scope.testIds) {
    const test = byId.get(testId);
    if (!test) continue;
    // A verdict from an earlier run is not this run's answer.
    const result = answered.has(testId) ? results[testId] : undefined;
    const group = groupOf(test, tags, order);
    const backend = backends[testId] ?? null;
    const caseCount = caseCountOf(result);
    const failedCases = result
      ? (result.cases.length > 0 ? result.cases.filter((one) => !one.passed).length : (result.passed ? 0 : 1))
      : 0;
    rows.push({
      id: test.id,
      name: test.name,
      status: statusOf(result, running),
      caseCount,
      passedCases: caseCount - failedCases,
      failedCases,
      durationMs: result?.durationMs ?? 0,
      groupKey: group.key,
      groupLabel: group.label,
      groupColor: group.color,
      backendId: backend?.id ?? null,
      backendLabel: backend?.name ?? null,
      superseded: Boolean(
        result && test.currentVersion && result.testVersionId
        && result.testVersionId !== test.currentVersion,
      ),
      message: result?.message ?? '',
    });
  }

  const groups: TestRunGroup[] = [];
  const groupIndex = new Map<string, TestRunGroup>();
  const byGroup = new Map<string, TestRunBreakdownRow>();
  const byBackend = new Map<string, TestRunBreakdownRow>();

  for (const row of rows) {
    let group = groupIndex.get(row.groupKey);
    if (!group) {
      group = {
        key: row.groupKey,
        label: row.groupLabel,
        color: row.groupColor,
        rows: [],
        passedCases: 0,
        totalCases: 0,
        failed: false,
      };
      groupIndex.set(row.groupKey, group);
      groups.push(group);
    }
    group.rows.push(row);
    group.passedCases += row.status === 'pass' || row.status === 'fail' ? row.passedCases : 0;
    // A test still to answer counts as one: the heading reads `3 / 12` from the
    // moment the run opens and climbs, rather than `3 / 3` all the way through.
    group.totalCases += Math.max(row.caseCount, 1);
    group.failed ||= row.failedCases > 0;

    addToBreakdown(byGroup, row.groupKey, row.groupLabel, row.groupColor, row);
    // A test whose store cannot be named still has to appear in the breakdown,
    // or the two columns stop adding up to the same run.
    addToBreakdown(
      byBackend,
      row.backendId ?? '__unknown__',
      row.backendLabel ?? 'Backend not recorded',
      backends[row.id]?.color ?? null,
      row,
    );
  }

  const failures: TestRunFailureRow[] = [];
  for (const row of rows) {
    const result = answered.has(row.id) ? results[row.id] : undefined;
    if (row.status === 'pending') continue;
    if (!result) {
      failures.push({
        key: `${row.id}:excluded`,
        testId: row.id,
        testName: row.name,
        caseIndex: 0,
        status: 'excluded',
        coordinates: coordinatesFor(row, null),
        reason: 'Named by the run, never ran',
        durationMs: 0,
      });
      continue;
    }
    if (result.cases.length === 0) {
      if (!result.passed) {
        failures.push({
          key: `${row.id}:0`,
          testId: row.id,
          testName: row.name,
          caseIndex: 0,
          status: 'fail',
          coordinates: coordinatesFor(row, null),
          reason: result.message || 'Failed',
          durationMs: result.durationMs,
        });
      }
      continue;
    }
    result.cases.forEach((caseResult, index) => {
      if (caseResult.passed) return;
      failures.push({
        key: `${row.id}:${caseResult.caseId || index}`,
        testId: row.id,
        testName: row.name,
        caseIndex: index,
        status: 'fail',
        coordinates: coordinatesFor(row, caseResult.name || `Case ${index + 1}`),
        reason: caseResult.message || result.message || 'Failed',
        durationMs: caseResult.durationMs,
      });
    });
  }

  const tallies = rows.reduce<TestRunTallies>((total, row) => ({
    tests: total.tests + 1,
    // A pending test has no cases yet: how many it expands to is something only
    // running it can say.
    cases: total.cases + (row.status === 'pending' ? 0 : Math.max(row.caseCount, 1)),
    passed: total.passed + (row.status === 'pass' || row.status === 'fail' ? row.passedCases : 0),
    failed: total.failed + row.failedCases,
    excluded: total.excluded + (row.status === 'excluded' ? 1 : 0),
    pending: total.pending + (row.status === 'pending' ? 1 : 0),
    durationMs: total.durationMs + row.durationMs,
  }), { tests: 0, cases: 0, passed: 0, failed: 0, excluded: 0, pending: 0, durationMs: 0 });

  return {
    scope,
    groups,
    rows,
    tallies,
    byGroup: [...byGroup.values()],
    byBackend: [...byBackend.values()],
    failures,
    excludedCount: tallies.excluded,
  };
}

/** The cell's identity: which case, and which store answered for it. */
function coordinatesFor(row: TestRunTestRow, caseName: string | null): TestRunCoordinate[] {
  const chips: TestRunCoordinate[] = [];
  if (caseName) chips.push({ label: caseName, kind: 'case', color: null });
  if (row.backendLabel) {
    chips.push({ label: row.backendLabel, kind: 'backend', color: null });
  }
  return chips;
}

/**
 * `48s`, `312ms` — the one duration format the tab uses.
 *
 * Deliberately not `benchmarkPlan.formatDuration`, which rounds to whole
 * seconds: a benchmark's unit is a run, and a test case's is a millisecond —
 * every failing case on this screen would read `0s`.
 */
export function formatRunDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
