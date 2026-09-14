/**
 * A run as CSV — one row per case.
 *
 * The format for the question the other three answer badly: "is this getting
 * better or worse?" Two CSVs from two runs diff, sort and pivot with tools
 * nobody has to install, which is why the column list is fixed and ordered
 * rather than derived from whatever the run happened to contain — a column set
 * that shifts between runs is one that cannot be compared across them.
 *
 * `detail` is deliberately absent: a comparator diff is multi-line JSON, and a
 * cell holding one destroys the readability that is the entire point of the
 * format. It is in the JSON export (`./jsonExport.ts`) and in the JUnit
 * `<failure>` body for callers that want it.
 */

import { toRows, type TestReportInput, type TestReportRow } from './rows.js';

/** Fixed, ordered, and stable across runs — see the note above. */
export const CSV_COLUMNS = [
  'testId',
  'testVersionId',
  'caseId',
  'caseName',
  'position',
  'outcome',
  'durationMs',
  'subject',
  'subjectVersionId',
  'backend',
  'argumentSetVersion',
  'dataGraphVersion',
  'expectationKind',
  'hermetic',
  'ranAt',
  'message',
] as const satisfies ReadonlyArray<keyof TestReportRow>;

/**
 * RFC 4180 quoting: quote when the value contains a delimiter, a quote or a
 * newline, and double any quote inside. A failure message is free text that
 * routinely contains all three.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(input: TestReportInput): string {
  const rows = toRows(input);
  // CRLF, as RFC 4180 specifies: it is what spreadsheet software expects, and
  // the one part of the format tools are actually strict about.
  return [
    CSV_COLUMNS.join(','),
    ...rows.map(row => CSV_COLUMNS.map(column => csvCell(row[column])).join(',')),
  ].join('\r\n') + '\r\n';
}
