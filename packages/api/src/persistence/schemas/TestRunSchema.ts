/**
 * Schema for TestRun — one execution of one test, kept.
 *
 * The verdict used to exist only in the response to `POST /tests/:id/run` and,
 * after that, only in whichever browser had asked for it. That answered "is it
 * green now" and nothing else: not "since when", not "is it flaky", not "what
 * did CI see". Issue #179 is the missing history; this is the row it needs.
 *
 * **Not registered in `ENTITY_TYPE_NAMES`, on purpose.** Everything in that
 * list is preloaded into the cache at boot, so the registry has to stay bounded
 * by what a person authored — and runs are unbounded by construction. The four
 * `Benchmark*` run types already sit outside it for exactly this reason and are
 * persisted all the same (see `EntityStore.ts`), which is the precedent this
 * follows rather than a new mechanism.
 *
 * That also settles the question the issue raises about whether a run is
 * library content: it is not. A run has no `sdo:isPartOf`, so it never appears
 * in the change feed, an export bundle or a library listing — the test it
 * judged is reached through `refTest`, which points *at* the test the way a
 * benchmark observation points at its subject.
 *
 * **What identifies a run** is every dimension the verdict depended on: the
 * test version that was run, the subject version it resolved to, the backend
 * (or none, for a hermetic run), and — per case, on `TestRunCase` — the
 * argument set version and data graph versions that case supplied. A verdict
 * without those is not reproducible and not comparable against another run.
 */

import type { Schema } from '../schema.js';
import { ldkit, xsd, sqlib, sdo } from '../namespaces.js';

export const TestRunSchema = {
  '@type': sqlib.TestRun,
  /** The `Test` this run judged. Points at it; does not belong to it. */
  test: {
    '@id': sqlib.refTest,
    '@type': ldkit.IRI,
  },
  /**
   * The `TestVersion` that ran.
   *
   * Optional because a test with no version at all still produces a verdict —
   * `cantTell`, with the reason as the message — and that is a fact worth
   * keeping: "this has been unrunnable for a week" is history too.
   */
  testVersion: {
    '@id': sqlib.testVersion,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /** `Test.subject` — the callable under test, as the report formats want it. */
  subject: {
    '@id': sqlib.refSubject,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /** The subject version actually invoked, pinned or resolved at run time. */
  subjectVersion: {
    '@id': sqlib.subjectVersion,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /** Where it ran, or absent for a hermetic run. */
  backend: {
    '@id': sqlib.refBackend,
    '@type': ldkit.IRI,
    '@optional': true,
  },
  /** The suite label the run was asked for under. */
  suite: {
    '@id': sqlib.suite,
    '@optional': true,
  },
  /** `passed` | `failed` | `cantTell`, the EARL outcomes the reports use. */
  outcome: {
    '@id': sqlib.outcome,
  },
  expectationKind: {
    '@id': sqlib.expectationKind,
  },
  hermetic: {
    '@id': sqlib.hermetic,
    '@type': xsd.boolean,
    // Optional in the RDF sense only: `false` is a value, and a required
    // property whose value is falsy trips the create-time check in
    // `EntityUtils`. The store writes it on every run.
    '@optional': true,
  },
  /** The one-line summary. Empty on a pass, so absent on most rows. */
  message: {
    '@id': sqlib.errorMessage,
    '@optional': true,
  },
  durationMs: {
    '@id': sqlib.durationMs,
    '@type': xsd.decimal,
    '@optional': true,
  },
  passedCount: {
    '@id': sqlib.passedCount,
    '@type': xsd.integer,
    '@optional': true,
  },
  failedCount: {
    '@id': sqlib.failedCount,
    '@type': xsd.integer,
    '@optional': true,
  },
  /**
   * When the run happened, as the *server* stamped it.
   *
   * The history is ordered by this and nothing else. A browser's clock is not
   * comparable with the server's, which is the same reason the Runs tab records
   * which tests answered a scope rather than inferring it from timestamps.
   */
  ranAt: {
    '@id': sqlib.ranAt,
    '@type': xsd.dateTime,
  },
  dateCreated: {
    '@id': sdo.dateCreated,
    '@type': xsd.dateTime,
    '@optional': true,
  },
  dateModified: {
    '@id': sdo.dateModified,
    '@type': xsd.dateTime,
    '@optional': true,
  },
} as const satisfies Schema;

/** The outcomes a stored run or case row can carry — `earl:outcome`, narrowed. */
export type TestRunOutcome = 'passed' | 'failed' | 'cantTell';

export interface LdkitTestRun {
  $id: string;
  '@type'?: 'TestRun';
  test: string;
  testVersion?: string | null;
  subject?: string | null;
  subjectVersion?: string | null;
  backend?: string | null;
  suite?: string | null;
  outcome: TestRunOutcome;
  expectationKind: string;
  hermetic?: boolean | null;
  message?: string | null;
  durationMs?: number | null;
  passedCount?: number | null;
  failedCount?: number | null;
  ranAt: string;
  dateCreated?: string | null;
  dateModified?: string | null;
}
