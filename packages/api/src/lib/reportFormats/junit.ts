/**
 * A run as JUnit XML — the format CI actually reads.
 *
 * Nothing about JUnit XML is a good fit for RDF-shaped verdicts, and it is
 * supported here for exactly one reason: GitHub Actions, GitLab, Jenkins and
 * Buildkite all ingest it natively to annotate a pull request. Without it a
 * sqlib run cannot fail a build, which is the difference between a test suite
 * and a report somebody has to remember to read.
 *
 * **`cantTell` becomes `<error>`, not `<failure>`.** JUnit happens to draw the
 * same line EARL does — `<failure>` is "the thing under test is wrong",
 * `<error>` is "we never found out" — so the distinction `earl:cantTell` exists
 * to protect (see `./earl.ts`, and plan §2) survives the crossing into CI
 * instead of being flattened at the boundary.
 */

import { MAX_DETAIL_BYTES } from './earl.js';
import { toRows, totalsFor, type TestReportInput, type TestReportRow } from './rows.js';

/**
 * XML 1.0 forbids most C0 control characters outright — no escape exists for
 * them. A SPARQL result can carry one in a literal, and a single stray 0x01
 * makes the whole document unparseable, so they are dropped rather than encoded.
 */
function stripInvalidXmlChars(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

function escapeXml(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Bounded like the EARL detail literal, and for the same reason: a diff over a
 * large multiset has no natural size, and an unbounded one here produces an XML
 * file the CI runner declines to upload.
 */
function truncate(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= MAX_DETAIL_BYTES) return value;
  const cut = Buffer.from(value, 'utf8')
    .subarray(0, MAX_DETAIL_BYTES)
    .toString('utf8')
    .replace(/�$/, '');
  return `${cut}… [truncated at ${MAX_DETAIL_BYTES} bytes]`;
}

/** JUnit reports durations in seconds; the runner measures milliseconds. */
function seconds(ms: number): string {
  return ((ms ?? 0) / 1000).toFixed(3);
}

/** The first line only: `message=` is an attribute, not a document. */
function firstLine(message: string): string {
  const line = message.split('\n', 1)[0] ?? '';
  return line.length > 500 ? `${line.slice(0, 500)}…` : line;
}

function attrs(pairs: Array<[string, string | number | null]>): string {
  return pairs
    .filter(([, value]) => value !== null && value !== '')
    .map(([name, value]) => `${name}="${escapeXml(String(value))}"`)
    .join(' ');
}

/**
 * CDATA cannot nest, and a diff containing the literal `]]>` would close the
 * section early — the one input that turns a report into malformed XML.
 */
function cdata(body: string): string {
  return `<![CDATA[${stripInvalidXmlChars(body).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function caseElement(row: TestReportRow): string {
  const open = `    <testcase ${attrs([
    ['name', row.caseName],
    // What CI groups by, so a failure reads as "this test, this case" rather
    // than as an unattributed case name floating on its own.
    ['classname', row.testId],
    ['time', seconds(row.durationMs)],
  ])}`;

  if (row.outcome === 'passed') return `${open} />`;

  const tag = row.outcome === 'failed'
    ? 'failure'
    : row.outcome === 'cantTell' ? 'error' : 'skipped';
  const body = truncate([row.message, row.detail].filter(Boolean).join('\n\n'));
  const inner = `      <${tag} ${attrs([['message', firstLine(row.message)], ['type', row.outcome]])}>`
    + `${cdata(body)}</${tag}>`;
  return `${open}>\n${inner}\n    </testcase>`;
}

export function toJUnitXml(input: TestReportInput): string {
  const rows = toRows(input);
  const totals = totalsFor(input, rows);

  // One suite per test, its cases inside it: the grouping every CI UI renders as
  // a collapsible section, and the only one where a parametrised test reads as
  // one thing with N cases rather than N unrelated tests.
  const suites = input.entries.map(({ result, subject, backend }) => {
    const suiteRows = rows.filter(row =>
      row.testId === result.testId && row.testVersionId === result.testVersionId);

    // The dimensions a verdict is only meaningful against. A red case with no
    // record of which backend and which subject version produced it is a bug
    // report nobody can act on.
    const properties = ([
      ['sqlib.testVersion', result.testVersionId],
      ['sqlib.subject', subject ?? null],
      ['sqlib.subjectVersion', result.subjectVersionId],
      ['sqlib.backend', backend ?? null],
      ['sqlib.expectationKind', result.expectationKind],
      ['sqlib.hermetic', String(result.hermetic)],
    ] as Array<[string, string | null]>).filter(([, value]) => Boolean(value)) as Array<[string, string]>;

    const header = `  <testsuite ${attrs([
      ['name', result.testId],
      ['tests', suiteRows.length],
      ['failures', suiteRows.filter(row => row.outcome === 'failed').length],
      ['errors', suiteRows.filter(row => row.outcome === 'cantTell').length],
      ['skipped', suiteRows.filter(row => row.outcome === 'inapplicable' || row.outcome === 'untested').length],
      ['time', seconds(result.durationMs)],
      ['timestamp', result.ranAt],
    ])}>`;

    const propertyBlock = properties.length === 0 ? '' : [
      '    <properties>',
      ...properties.map(([name, value]) => `      <property ${attrs([['name', name], ['value', value]])} />`),
      '    </properties>',
    ].join('\n');

    return [header, propertyBlock, ...suiteRows.map(caseElement), '  </testsuite>']
      .filter(part => part !== '')
      .join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites ${attrs([
      ['name', input.suite],
      ['tests', totals.cases],
      ['failures', totals.casesFailed],
      ['errors', totals.casesCantTell],
      ['time', seconds(totals.durationMs)],
    ])}>`,
    ...suites,
    '</testsuites>',
    '',
  ].join('\n');
}
