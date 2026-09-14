/**
 * The one flattening every non-RDF format is written against.
 *
 * A run answers in a shape that is convenient to *produce* — a test, holding
 * cases, holding a diff — and every export format wants the shape that is
 * convenient to *read*: one row per case, carrying its test's context with it.
 * Doing that flattening once here rather than inside each serialiser is what
 * keeps CSV, the JSON export and the job summary agreeing about what a run
 * contained; the alternative is three loops that drift.
 *
 * EARL is deliberately *not* built on this: an assertion is a graph of linked
 * nodes, not a row, and squashing it into one would lose the very structure
 * that makes it queryable. See `./earl.ts`.
 */

import type { TestRunResult } from '../TestRunner.js';
import type { EarlOutcome } from './earl.js';

/**
 * One test's verdict plus the dimensions the run result does not carry.
 *
 * `subject` and `backend` live on the `Test` and its `TestVersion`, which the
 * route already has in hand; passing them in keeps the serialisers pure
 * functions of their input, exactly as `EarlAssertionInput` does.
 */
export interface TestReportEntry {
  result: TestRunResult;
  /** `Test.subject` — the callable under test. */
  subject?: string | null;
  /** `TestVersion.backend` — where the cases ran. */
  backend?: string | null;
  /**
   * `Test.criterion` — the external test this one implements, if any.
   *
   * Only the conformance EARL profile reads it, and only it can: a JUnit
   * `<testcase>` or a CSV row is identified by our own name. Carried on the
   * entry rather than looked up inside the serialiser for the reason every
   * other dimension here is — a format stays a pure function of its input.
   */
  criterion?: string | null;
}

export interface TestReportInput {
  /**
   * What was asked for, in the caller's terms: a test IRI for a single run, the
   * tag list for a suite. Used as the suite name in JUnit and the heading in the
   * job summary, where "which run is this" is otherwise unanswerable.
   */
  suite: string;
  entries: TestReportEntry[];
}

/** One case, denormalised. The unit of the CSV and of the JSON export. */
export interface TestReportRow {
  testId: string;
  testVersionId: string;
  subject: string | null;
  subjectVersionId: string | null;
  backend: string | null;
  expectationKind: string;
  hermetic: boolean;
  /** Empty for a test that never got as far as producing cases. */
  caseId: string;
  caseName: string;
  position: number;
  outcome: EarlOutcome;
  durationMs: number;
  argumentSetVersion: string | null;
  dataGraphVersion: string | null;
  ranAt: string;
  /** Why it failed, or why it could not run. Empty on a pass. */
  message: string;
  /**
   * The comparator diff, as JSON, when the case produced one.
   *
   * Carried on the row rather than fetched separately because the formats that
   * want it (a JUnit `<failure>` body, the JSON export) and the format that does
   * not (CSV, where an embedded diff would wreck the column) are otherwise
   * reading two different flattenings of the same run.
   */
  detail?: string;
}

/**
 * Whether a result describes a test that never ran.
 *
 * A run with no cases is not a run where everything passed — it is the
 * `notRunResult` shape the by-tag route emits when a test is broken rather than
 * failing. Keeping the two apart is the same distinction `earl:cantTell` exists
 * for, and the reason the JUnit mapping below reaches for `<error>` rather than
 * `<failure>`.
 */
export function didNotRun(result: TestRunResult): boolean {
  return result.cases.length === 0;
}

/** The synthetic case name a test that produced no cases is reported under. */
export const NOT_RUN_CASE_NAME = '(test did not run)';

export function toRows(input: TestReportInput): TestReportRow[] {
  const rows: TestReportRow[] = [];

  for (const { result, subject, backend } of input.entries) {
    const common = {
      testId: result.testId,
      testVersionId: result.testVersionId,
      subject: subject ?? null,
      subjectVersionId: result.subjectVersionId ?? null,
      backend: backend ?? null,
      expectationKind: result.expectationKind,
      hermetic: result.hermetic,
      ranAt: result.ranAt,
    };

    if (didNotRun(result)) {
      // One row rather than none: a suite that silently omits its broken members
      // reports a smaller, greener run than the one that happened.
      rows.push({
        ...common,
        caseId: '',
        caseName: NOT_RUN_CASE_NAME,
        position: 0,
        outcome: 'cantTell',
        durationMs: result.durationMs,
        argumentSetVersion: null,
        dataGraphVersion: null,
        message: result.message,
      });
      continue;
    }

    for (const testCase of result.cases) {
      rows.push({
        ...common,
        caseId: testCase.caseId,
        caseName: testCase.name,
        position: testCase.position,
        outcome: testCase.passed ? 'passed' : 'failed',
        durationMs: testCase.durationMs,
        argumentSetVersion: testCase.inputs?.argumentSetVersion ?? null,
        dataGraphVersion: testCase.inputs?.dataGraphVersion ?? null,
        message: testCase.message,
        ...(testCase.detail === undefined ? {} : { detail: JSON.stringify(testCase.detail) }),
      });
    }
  }

  return rows;
}

export interface TestReportTotals {
  tests: number;
  testsPassed: number;
  testsFailed: number;
  /** Tests that could not run at all — counted apart from failures on purpose. */
  testsNotRun: number;
  cases: number;
  casesPassed: number;
  casesFailed: number;
  casesCantTell: number;
  durationMs: number;
}

export function totalsFor(input: TestReportInput, rows: TestReportRow[]): TestReportTotals {
  const results = input.entries.map(entry => entry.result);
  const notRun = results.filter(didNotRun);
  return {
    tests: results.length,
    testsPassed: results.filter(result => result.passed).length,
    // A test that could not run is not a failing test; it is neither.
    testsFailed: results.filter(result => !result.passed && !didNotRun(result)).length,
    testsNotRun: notRun.length,
    cases: rows.length,
    casesPassed: rows.filter(row => row.outcome === 'passed').length,
    casesFailed: rows.filter(row => row.outcome === 'failed').length,
    casesCantTell: rows.filter(row => row.outcome === 'cantTell').length,
    durationMs: results.reduce((sum, result) => sum + (result.durationMs ?? 0), 0),
  };
}
