/**
 * A run as a GitHub Actions job summary.
 *
 * Complements JUnit rather than competing with it: JUnit is what annotates the
 * failing lines on a pull request, this is what a human reads at the top of the
 * job without downloading an artifact. Written to `$GITHUB_STEP_SUMMARY`, which
 * renders GFM — so tables and `<details>` are available, and nothing else is.
 *
 * Failures come first and in full; passes are folded away. A summary that lists
 * two hundred green rows above the one red one is a summary that has to be
 * scrolled past to be useful, which is the same as not being read.
 */

import { toRows, totalsFor, NOT_RUN_CASE_NAME, type TestReportInput, type TestReportRow } from './rows.js';

/**
 * GitHub rejects a step summary over 1 MiB outright — the whole file, not the
 * excess, so overshooting loses the summary entirely rather than the tail of it.
 * Under that, with room for the truncation notice.
 */
export const MAX_SUMMARY_BYTES = 900 * 1024;

/** Per-message cap, so one enormous diff cannot crowd out every other failure. */
const MAX_MESSAGE_CHARS = 400;

const OUTCOME_ICON: Record<string, string> = {
  passed: '✅',
  failed: '❌',
  // Distinct from a failure on sight, not just in the column: "we never found
  // out" is the state a reader most needs to notice and most easily misses.
  cantTell: '⚠️',
  inapplicable: '➖',
  untested: '➖',
};

/**
 * A pipe inside a cell ends the cell, and a newline ends the row. Both occur
 * routinely in a comparator message, and either one silently mangles the table
 * rather than failing loudly.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function shortMessage(message: string): string {
  const flat = message.replace(/\r?\n/g, ' ').trim();
  if (!flat) return '';
  return flat.length > MAX_MESSAGE_CHARS ? `${flat.slice(0, MAX_MESSAGE_CHARS)}…` : flat;
}

/** The last path segment of an IRI — the part that distinguishes it on screen. */
function shortIri(value: string | null): string {
  if (!value) return '—';
  const tail = value.split(/[#/:]/).filter(Boolean).at(-1);
  return tail ?? value;
}

function row(reportRow: TestReportRow): string {
  const name = reportRow.caseName === NOT_RUN_CASE_NAME
    ? `_${reportRow.caseName}_`
    : cell(reportRow.caseName);
  return `| ${OUTCOME_ICON[reportRow.outcome] ?? ''} ${reportRow.outcome} `
    + `| \`${shortIri(reportRow.testId)}\` | ${name} | ${cell(shortIri(reportRow.backend))} `
    + `| ${reportRow.durationMs} | ${cell(shortMessage(reportRow.message))} |`;
}

const TABLE_HEAD = [
  '| Outcome | Test | Case | Backend | ms | Detail |',
  '| --- | --- | --- | --- | --- | --- |',
];

export function toJobSummaryMarkdown(input: TestReportInput): string {
  const rows = toRows(input);
  const totals = totalsFor(input, rows);
  const failures = rows.filter(reportRow => reportRow.outcome !== 'passed');
  const passes = rows.filter(reportRow => reportRow.outcome === 'passed');

  const verdict = totals.casesFailed === 0 && totals.casesCantTell === 0 ? '✅' : '❌';
  const parts: string[] = [
    `## ${verdict} sqlib test results`,
    '',
    `**${totals.casesPassed}/${totals.cases}** cases passed across **${totals.tests}** `
      + `test${totals.tests === 1 ? '' : 's'} in ${(totals.durationMs / 1000).toFixed(2)}s.`,
    '',
    `| Passed | Failed | Could not run | Tests | Suite |`,
    `| --- | --- | --- | --- | --- |`,
    `| ${totals.casesPassed} | ${totals.casesFailed} | ${totals.casesCantTell} `
      + `| ${totals.tests} | ${cell(input.suite)} |`,
    '',
  ];

  if (failures.length > 0) {
    parts.push('### Failures', '', ...TABLE_HEAD, ...failures.map(row), '');
  }

  if (passes.length > 0) {
    parts.push(
      '<details>',
      `<summary>${passes.length} passing case${passes.length === 1 ? '' : 's'}</summary>`,
      '',
      ...TABLE_HEAD,
      ...passes.map(row),
      '',
      '</details>',
      '',
    );
  }

  const markdown = parts.join('\n');
  if (Buffer.byteLength(markdown, 'utf8') <= MAX_SUMMARY_BYTES) return markdown;

  // Truncating loses rows; overshooting loses the summary. Losing rows, with the
  // count that says so, is the recoverable failure of the two.
  const head = Buffer.from(markdown, 'utf8')
    .subarray(0, MAX_SUMMARY_BYTES)
    .toString('utf8')
    .replace(/�$/, '');
  return `${head}\n\n_Summary truncated at ${MAX_SUMMARY_BYTES} bytes; `
    + `${rows.length} cases ran. Use the JUnit XML or CSV export for the full run._\n`;
}
