/**
 * A run as a documented, versioned JSON export.
 *
 * Distinct from the ordinary route response on purpose. That response is shaped
 * by what the SPA needs and is free to follow it; this is the shape a script is
 * invited to depend on, so it is nested-run-shaped no longer — one flat row per
 * case, the same rows the CSV emits — and it carries a `format`/`version` pair
 * so a consumer can tell what it is holding without guessing from the keys.
 *
 * The separate media type is what keeps both promises at once: `Accept:
 * application/json` still returns exactly what it always returned, and nothing
 * that reads the run response today can be broken by changes here.
 */

import { toRows, totalsFor, type TestReportInput, type TestReportRow, type TestReportTotals } from './rows.js';

/** Bumped only for a breaking change to the shape below. */
export const TEST_REPORT_JSON_VERSION = 1;

export interface TestReportJson {
  format: 'sqlib-test-report';
  version: number;
  /** The test IRI or tag list the run was asked for. */
  suite: string;
  /** When the run started, taken from its first result. */
  ranAt: string | null;
  totals: TestReportTotals;
  cases: TestReportRow[];
}

export function toJsonExport(input: TestReportInput): TestReportJson {
  const rows = toRows(input);
  return {
    format: 'sqlib-test-report',
    version: TEST_REPORT_JSON_VERSION,
    suite: input.suite,
    ranAt: input.entries[0]?.result.ranAt ?? null,
    totals: totalsFor(input, rows),
    cases: rows,
  };
}
