/**
 * The export formats a test run can answer in.
 *
 * The list mirrors `TEST_REPORT_FORMATS` on the server, which is the authority:
 * export is content negotiation on the run routes, so a format here is nothing
 * but an `Accept` header and a name for it. Kept as data rather than as markup
 * inside a menu so the single-test and by-tag exports cannot drift into
 * offering different formats.
 *
 * See `docs/guides/testing-and-conformance.md`.
 */

export interface TestReportFormat {
  id: string;
  /** What the menu row says. */
  label: string;
  /** The line under it — why you would pick this one. */
  hint: string;
  /** Sent as `Accept`; the server picks the format from it. */
  accept: string;
  /** Fallback when the response carries no `Content-Disposition`. */
  filename: string;
}

/**
 * Ordered as the menu reads them: the fullest first, then the two a machine
 * consumes, then the two a person pastes, and the submission format last —
 * it is the one nobody picks by accident. Each hint is two or three words: the
 * row has to separate six formats, not describe them.
 */
export const TEST_REPORT_FORMATS: TestReportFormat[] = [
  {
    id: 'json',
    label: 'Report JSON',
    hint: 'Full detail',
    accept: 'application/vnd.sqlib.test-report+json',
    filename: 'test-results.json',
  },
  {
    id: 'earl',
    label: 'EARL',
    hint: 'RDF assertions',
    accept: 'text/turtle',
    filename: 'test-results.ttl',
  },
  {
    id: 'earl-w3c',
    label: 'EARL (W3C)',
    hint: 'For a submission',
    // The profile parameter, not a second media type: both are Turtle, and the
    // server negotiates on the profile. Sent quoted, which is the correct
    // spelling and the one a proxy is least likely to mangle.
    accept: 'text/turtle;profile="earl"',
    filename: 'earl-report.ttl',
  },
  {
    id: 'junit',
    label: 'JUnit XML',
    hint: 'For CI',
    accept: 'application/xml',
    filename: 'test-results.xml',
  },
  {
    id: 'markdown',
    label: 'Job summary',
    hint: 'GitHub Actions',
    accept: 'text/markdown',
    filename: 'test-results.md',
  },
  {
    id: 'csv',
    label: 'Case table',
    hint: 'One row per case',
    accept: 'text/csv',
    filename: 'test-results.csv',
  },
];
