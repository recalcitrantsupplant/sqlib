/**
 * Durable test run history — writing runs, reading them back, and forgetting
 * the ones that stopped being worth keeping.
 *
 * `POST /tests/:id/run` computed a verdict and returned it, and that was the
 * whole of it: the only durable copy was `packages/web/src/lib/testRunCache.ts`,
 * one browser, one profile, one verdict per test, no history. So "since when is
 * this red", "is this flaky or did it change", "what did CI see" were all
 * unanswerable. Issue #179.
 *
 * Three decisions the issue asks for, made here:
 *
 * 1. **What identifies a run** — see `TestRunSchema`. Every dimension the
 *    verdict depended on, including the per-case inputs, because a verdict
 *    compared against another run's is only meaningful if both ran the same
 *    thing.
 * 2. **Whether runs are library content** — no. They live outside
 *    `ENTITY_TYPE_NAMES` (so outside the boot preload), carry no `isPartOf`,
 *    and so never reach the change feed or an export bundle. A run is not an
 *    edit.
 * 3. **Retention** — bounded per test, below.
 *
 * Recording is best-effort by construction: a run that executed is a fact the
 * caller is entitled to, and a storage backend that refuses the write must not
 * turn a green test into a 500. Failures are logged and swallowed, which is the
 * one place this module is deliberately not strict.
 */

import { mintId } from './id.js';
import { TestRuns, findAllTestRuns, findTestRunById } from '../persistence/utils/TestRunUtils.js';
import { TestRunCases, findAllTestRunCases } from '../persistence/utils/TestRunCaseUtils.js';
import type { LdkitTestRun, TestRunOutcome } from '../persistence/schemas/TestRunSchema.js';
import type { LdkitTestRunCase } from '../persistence/schemas/TestRunCaseSchema.js';
import type { TestCaseResult, TestRunResult } from './TestRunner.js';
import type { TestReportEntry } from './reportFormats/index.js';

/**
 * How many runs of one test are kept regardless of what they say.
 *
 * Twenty is "the last few days of a suite that runs on every push" — enough to
 * see a pattern, small enough that 205 tests cost at most a few thousand rows.
 */
export const RUN_HISTORY_LIMIT = 20;

/**
 * How many *transitions* are kept beyond that window.
 *
 * A transition is a run whose outcome differs from the run before it: the
 * moment a test went red, or came back. Those are the rows a history is for,
 * and they are the first thing a plain "keep the last N" policy throws away —
 * the run that broke it scrolls off while twenty identical greens survive.
 *
 * Capped rather than kept forever because a genuinely flaky test makes *every*
 * run a transition, and "keep every transition" would then mean "keep
 * everything" for exactly the tests that produce the most runs. With both
 * limits a test costs at most `RUN_HISTORY_LIMIT + TRANSITION_HISTORY_LIMIT`
 * rows, whatever it does.
 */
export const TRANSITION_HISTORY_LIMIT = 30;

/** One run to record: the verdict, plus the dimensions it does not carry. */
export interface TestRunRecord {
  result: TestRunResult;
  /** `Test.subject` — the callable under test. */
  subject?: string | null;
  /** `TestVersion.backend` — where the cases ran, or null when hermetic. */
  backend?: string | null;
  /** What the run was asked for as: a test IRI, or a suite label. */
  suite?: string | null;
}

/** A stored run with the case rows that belong to it, in position order. */
export interface StoredTestRun {
  run: LdkitTestRun;
  cases: LdkitTestRunCase[];
}

/**
 * The outcome of a whole run.
 *
 * A run with no cases is not a run in which everything passed — it is the
 * `notRunResult` shape, a test that could not run at all. `reportFormats/rows.ts`
 * draws the same line for the same reason, and reaches for `earl:cantTell`.
 */
export function runOutcome(result: TestRunResult): TestRunOutcome {
  if (result.cases.length === 0) return 'cantTell';
  return result.passed ? 'passed' : 'failed';
}

function caseRow(runId: string, testCase: TestCaseResult): LdkitTestRunCase {
  const graphs = testCase.inputs?.dataGraphVersions ?? [];
  return {
    $id: mintId('testRunCase'),
    '@type': 'TestRunCase',
    isPartOf: runId,
    testCase: testCase.caseId || null,
    name: testCase.name,
    position: testCase.position,
    outcome: testCase.passed ? 'passed' : 'failed',
    message: testCase.message || null,
    detail: testCase.detail === undefined ? null : JSON.stringify(testCase.detail),
    durationMs: testCase.durationMs,
    argumentSetVersion: testCase.inputs?.argumentSetVersion ?? null,
    dataGraphVersion: testCase.inputs?.dataGraphVersion ?? null,
    dataGraphVersions: graphs.length > 0 ? graphs : null,
  };
}

function runRow(record: TestRunRecord): LdkitTestRun {
  const { result } = record;
  const now = new Date().toISOString();
  return {
    $id: mintId('testRun'),
    '@type': 'TestRun',
    test: result.testId,
    testVersion: result.testVersionId || null,
    subject: record.subject ?? null,
    subjectVersion: result.subjectVersionId ?? null,
    backend: record.backend ?? null,
    suite: record.suite ?? null,
    outcome: runOutcome(result),
    expectationKind: result.expectationKind,
    hermetic: result.hermetic,
    message: result.message || null,
    durationMs: result.durationMs,
    passedCount: result.passedCount,
    failedCount: result.failedCount,
    ranAt: result.ranAt,
    dateCreated: now,
    dateModified: now,
  };
}

/** Oldest first, by the server's clock. The order every retention rule reads. */
function byRanAt(a: LdkitTestRun, b: LdkitTestRun): number {
  return (a.ranAt ?? '').localeCompare(b.ranAt ?? '');
}

/**
 * The runs of one test that retention keeps, given all of them.
 *
 * Pure, and exported for the tests: retention is a policy, and a policy that
 * can only be checked by writing to a store is a policy nobody checks.
 */
export function runsToForget(runs: LdkitTestRun[]): LdkitTestRun[] {
  const ordered = [...runs].sort(byRanAt);
  const keep = new Set<string>();

  for (const run of ordered.slice(-RUN_HISTORY_LIMIT)) keep.add(run.$id);

  const transitions: LdkitTestRun[] = [];
  let previous: TestRunOutcome | null = null;
  for (const run of ordered) {
    // The first run of a test is a transition in the sense that matters: it is
    // where the record of this test begins, and dropping it would make the
    // oldest kept run look like the moment something changed.
    if (previous === null || run.outcome !== previous) transitions.push(run);
    previous = run.outcome;
  }
  for (const run of transitions.slice(-TRANSITION_HISTORY_LIMIT)) keep.add(run.$id);

  return ordered.filter(run => !keep.has(run.$id));
}

async function insertRun(run: LdkitTestRun, cases: LdkitTestRunCase[]): Promise<void> {
  // Nulls need no stripping here — an absent value produces no triple, which is
  // `EntitySerialiser`'s job and the reason the repositories take entities whole.
  await TestRuns.insert(run);
  for (const row of cases) await TestRunCases.insert(row);
}

async function forget(runIds: string[]): Promise<void> {
  if (runIds.length === 0) return;
  const doomed = new Set(runIds);
  const cases = await findAllTestRunCases();
  for (const row of cases) {
    // Cases have no life outside their run — they are addressable only through
    // it — so leaving them behind would accumulate rows nothing can reach.
    if (doomed.has(row.isPartOf)) await TestRunCases.delete(row.$id);
  }
  for (const runId of doomed) await TestRuns.delete(runId);
}

/**
 * Record a batch of runs, then prune the tests they touched.
 *
 * A batch rather than one call per run because a suite run is two hundred
 * verdicts arriving together, and pruning after each would re-read the whole
 * run history two hundred times. One read, one pass.
 */
export async function recordTestRuns(records: TestRunRecord[]): Promise<LdkitTestRun[]> {
  if (records.length === 0) return [];
  const written: LdkitTestRun[] = [];
  try {
    for (const record of records) {
      const run = runRow(record);
      await insertRun(run, record.result.cases.map(testCase => caseRow(run.$id, testCase)));
      written.push(run);
    }

    const touched = new Set(records.map(record => record.result.testId));
    const all = await findAllTestRuns();
    const stale: string[] = [];
    for (const testId of touched) {
      stale.push(...runsToForget(all.filter(run => run.test === testId)).map(run => run.$id));
    }
    await forget(stale);
  } catch (error) {
    // A run that executed is the caller's answer whether or not it was filed.
    console.warn('[TestRunStore] Failed to record test run history:', error);
  }
  return written;
}

/** Record one run. The single-test route's spelling of the above. */
export async function recordTestRun(record: TestRunRecord): Promise<LdkitTestRun | null> {
  const [written] = await recordTestRuns([record]);
  return written ?? null;
}

/** One test's runs, newest first. `limit` caps the answer, not the read. */
export async function listTestRuns(testId: string, limit?: number): Promise<LdkitTestRun[]> {
  const runs = (await findAllTestRuns())
    .filter(run => run.test === testId)
    .sort((a, b) => byRanAt(b, a));
  return typeof limit === 'number' && limit >= 0 ? runs.slice(0, limit) : runs;
}

/** One stored run and its case rows, or null when the id names nothing. */
export async function getTestRun(runId: string): Promise<StoredTestRun | null> {
  const run = await findTestRunById(runId);
  if (!run) return null;
  const cases = (await findAllTestRunCases())
    .filter(row => row.isPartOf === runId)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return { run, cases };
}

/**
 * A stored run, back in the shape every report format is written against.
 *
 * This is what makes an export of a *past* run possible: the formats are pure
 * functions of `TestReportInput`, so a run read from storage renders exactly
 * as it did the day it ran — no re-execution, and no second implementation of
 * any format. Before this there was nothing to address, which is why
 * `reportFormats/index.ts` says export is a response format on the run routes.
 * It still is; this adds a stored run as a second thing that can be exported.
 *
 * The one field a re-render cannot restore is the produced result text, which
 * history deliberately does not keep — and no report format reads it.
 */
export function toReportEntry({ run, cases }: StoredTestRun): TestReportEntry {
  const result: TestRunResult = {
    testId: run.test,
    testVersionId: run.testVersion ?? '',
    passed: run.outcome === 'passed',
    message: run.message ?? '',
    expectationKind: run.expectationKind as TestRunResult['expectationKind'],
    hermetic: run.hermetic ?? false,
    durationMs: run.durationMs ?? 0,
    subjectVersionId: run.subjectVersion ?? null,
    ranAt: run.ranAt,
    cases: cases.map((row, index) => ({
      caseId: row.testCase ?? '',
      name: row.name ?? `Case ${index + 1}`,
      position: row.position ?? index,
      passed: row.outcome === 'passed',
      message: row.message ?? '',
      ...(row.detail ? { detail: parseDetail(row.detail) } : {}),
      inputs: {
        argumentSetVersion: row.argumentSetVersion ?? null,
        dataGraphVersion: row.dataGraphVersion ?? null,
        dataGraphVersions: row.dataGraphVersions ?? [],
      },
      durationMs: row.durationMs ?? 0,
    })),
    passedCount: run.passedCount ?? cases.filter(row => row.outcome === 'passed').length,
    failedCount: run.failedCount ?? cases.filter(row => row.outcome !== 'passed').length,
  };
  return { result, subject: run.subject ?? null, backend: run.backend ?? null };
}

/**
 * A stored diff, back as an object.
 *
 * Tolerant of a value that will not parse: a row written by an older or a
 * hand-edited store must not take down the report it appears in, and a missing
 * diff reads as "no diff recorded" everywhere downstream.
 */
function parseDetail(detail: string): TestCaseResult['detail'] {
  try {
    return JSON.parse(detail) as TestCaseResult['detail'];
  } catch {
    return undefined;
  }
}
