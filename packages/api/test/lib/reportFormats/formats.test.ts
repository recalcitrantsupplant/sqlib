import { describe, it, expect } from 'vitest';
import { toJUnitXml } from '../../../src/lib/reportFormats/junit.js';
import { toCsv, CSV_COLUMNS } from '../../../src/lib/reportFormats/csv.js';
import { toJobSummaryMarkdown, MAX_SUMMARY_BYTES } from '../../../src/lib/reportFormats/markdown.js';
import { toJsonExport } from '../../../src/lib/reportFormats/jsonExport.js';
import { toEarlTurtle } from '../../../src/lib/reportFormats/earlTurtle.js';
import { toRows, totalsFor, type TestReportInput } from '../../../src/lib/reportFormats/rows.js';
import type { TestCaseResult, TestRunResult } from '../../../src/lib/TestRunner.js';
import * as oxigraph from 'oxigraph';

const TEST_ID = 'urn:sqlib:test:t1';
const VERSION_ID = 'urn:sqlib:test-version:tv1';

function testCase(overrides: Partial<TestCaseResult> = {}): TestCaseResult {
  return {
    caseId: `${VERSION_ID}#case-0`,
    name: 'Case 1',
    position: 0,
    passed: true,
    message: '',
    inputs: {
      argumentSetVersion: 'urn:sqlib:argument-set-version:a1',
      dataGraphVersion: 'urn:sqlib:data-graph-version:d1',
    },
    durationMs: 5,
    ...overrides,
  };
}

function runResult(overrides: Partial<TestRunResult> = {}): TestRunResult {
  return {
    testId: TEST_ID,
    testVersionId: VERSION_ID,
    passed: true,
    message: '',
    expectationKind: 'bindings' as TestRunResult['expectationKind'],
    hermetic: true,
    durationMs: 12,
    subjectVersionId: 'urn:sqlib:query-version:7',
    ranAt: '2026-08-14T09:32:11.000Z',
    cases: [testCase()],
    passedCount: 1,
    failedCount: 0,
    ...overrides,
  };
}

function input(overrides: Partial<TestReportInput> = {}): TestReportInput {
  return {
    suite: TEST_ID,
    entries: [{ result: runResult(), subject: 'urn:sqlib:query:q1', backend: 'urn:sqlib:backend:b1' }],
    ...overrides,
  };
}

const FAILING_CASE = testCase({
  caseId: `${VERSION_ID}#case-1`,
  name: 'Case 2',
  position: 1,
  passed: false,
  message: 'Expected 3 bindings, got 2',
  detail: { missing: [{ s: 'urn:a' }] } as TestCaseResult['detail'],
  durationMs: 9,
});

const FAILED_RUN = runResult({
  passed: false,
  message: '1 of 2 cases failed',
  cases: [testCase(), FAILING_CASE],
  passedCount: 1,
  failedCount: 1,
});

/** The `notRunResult` shape the by-tag route emits: a run with no cases at all. */
const NOT_RUN = runResult({
  passed: false,
  message: 'TestVersion has no subject',
  cases: [],
  passedCount: 0,
  failedCount: 0,
  subjectVersionId: null,
});

describe('toRows', () => {
  it('emits one row per case, carrying the test context onto each', () => {
    const rows = toRows(input({ entries: [{ result: FAILED_RUN, subject: 'urn:sqlib:query:q1', backend: 'urn:sqlib:backend:b1' }] }));
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.outcome)).toEqual(['passed', 'failed']);
    expect(rows.every(row => row.subject === 'urn:sqlib:query:q1')).toBe(true);
    expect(rows.every(row => row.backend === 'urn:sqlib:backend:b1')).toBe(true);
    // The case's own duration, not the run's — the same rule the EARL
    // assertions follow.
    expect(rows.map(row => row.durationMs)).toEqual([5, 9]);
  });

  it('reports a test that produced no cases as one cantTell row, not as nothing', () => {
    const rows = toRows(input({ entries: [{ result: NOT_RUN }] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('cantTell');
    expect(rows[0].message).toBe('TestVersion has no subject');
    expect(rows[0].caseId).toBe('');
  });

  it('counts a test that could not run apart from a failing one', () => {
    const report = input({
      entries: [{ result: FAILED_RUN }, { result: NOT_RUN }],
    });
    const totals = totalsFor(report, toRows(report));
    expect(totals).toMatchObject({
      tests: 2,
      testsPassed: 0,
      testsFailed: 1,
      testsNotRun: 1,
      cases: 3,
      casesPassed: 1,
      casesFailed: 1,
      casesCantTell: 1,
    });
  });
});

describe('toJUnitXml', () => {
  it('emits one suite per test with its cases inside it', () => {
    const xml = toJUnitXml(input({ entries: [{ result: FAILED_RUN, backend: 'urn:sqlib:backend:b1' }] }));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(`<testsuite name="${TEST_ID}" tests="2" failures="1" errors="0"`);
    expect(xml).toContain('<testcase name="Case 1" classname="urn:sqlib:test:t1" time="0.005" />');
    expect(xml).toContain('<property name="sqlib.backend" value="urn:sqlib:backend:b1" />');
  });

  it('reports a comparator mismatch as <failure>, carrying the diff in the body', () => {
    const xml = toJUnitXml(input({ entries: [{ result: FAILED_RUN }] }));
    expect(xml).toContain('<failure message="Expected 3 bindings, got 2" type="failed">');
    // The diff rides inside CDATA, so its JSON quotes stay unescaped.
    expect(xml).toContain('<![CDATA[Expected 3 bindings, got 2');
    expect(xml).toContain('{"missing":[{"s":"urn:a"}]}');
  });

  it('reports a test that could not run as <error>, not <failure>', () => {
    // The distinction `earl:cantTell` exists for: "we never found out" is not
    // "the subject is wrong", and CI draws the same line.
    const xml = toJUnitXml(input({ entries: [{ result: NOT_RUN }] }));
    expect(xml).toContain('<error message="TestVersion has no subject" type="cantTell">');
    expect(xml).not.toContain('<failure');
    expect(xml).toContain('errors="1"');
  });

  it('escapes markup and drops characters XML 1.0 cannot represent', () => {
    const nasty = runResult({
      passed: false,
      cases: [testCase({
        name: 'a & b <c>',
        passed: false,
        message: 'got "x" \u0001\u0002 <tag>',
      })],
    });
    const xml = toJUnitXml(input({ entries: [{ result: nasty }] }));
    expect(xml).toContain('name="a &amp; b &lt;c&gt;"');
    // No escape exists for a C0 control character in XML 1.0, so it is dropped.
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(xml).toContain('&quot;x&quot;');
  });

  it('splits a CDATA section that would otherwise close early', () => {
    const nasty = runResult({
      passed: false,
      cases: [testCase({ passed: false, message: 'contains ]]> inside' })],
    });
    const xml = toJUnitXml(input({ entries: [{ result: nasty }] }));
    expect(xml).toContain(']]]]><![CDATA[>');
    // One opening and one closing marker per split part — never an unbalanced
    // section, which is the failure this guards.
    expect(xml.split('<![CDATA[').length).toBe(xml.split(']]>').length);
  });

  it('totals the run at the top level', () => {
    const xml = toJUnitXml(input({
      suite: 'urn:sqlib:tag:negation',
      entries: [{ result: FAILED_RUN }, { result: NOT_RUN }],
    }));
    expect(xml).toContain('<testsuites name="urn:sqlib:tag:negation" tests="3" failures="1" errors="1"');
  });
});

describe('toCsv', () => {
  it('emits the fixed header and one row per case', () => {
    const csv = toCsv(input({ entries: [{ result: FAILED_RUN, subject: 'urn:sqlib:query:q1' }] }));
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('failed');
  });

  it('quotes cells containing a comma, a quote or a newline', () => {
    const awkward = runResult({
      passed: false,
      cases: [testCase({ passed: false, message: 'a,b "quoted"\nsecond line' })],
    });
    const csv = toCsv(input({ entries: [{ result: awkward }] }));
    expect(csv).toContain('"a,b ""quoted""\nsecond line"');
  });

  it('leaves the diff out — it belongs in a format that can hold it', () => {
    expect(CSV_COLUMNS).not.toContain('detail');
    const csv = toCsv(input({ entries: [{ result: FAILED_RUN }] }));
    expect(csv).not.toContain('missing');
  });
});

describe('toJsonExport', () => {
  it('is self-describing, flat, and carries the totals', () => {
    const json = toJsonExport(input({ entries: [{ result: FAILED_RUN }, { result: NOT_RUN }] }));
    expect(json.format).toBe('sqlib-test-report');
    expect(json.version).toBe(1);
    expect(json.cases).toHaveLength(3);
    expect(json.totals.casesCantTell).toBe(1);
    expect(json.ranAt).toBe('2026-08-14T09:32:11.000Z');
  });

  it('keeps the diff, which the CSV drops', () => {
    const json = toJsonExport(input({ entries: [{ result: FAILED_RUN }] }));
    expect(json.cases[1].detail).toContain('missing');
  });
});

describe('toJobSummaryMarkdown', () => {
  it('leads with the verdict and the tally', () => {
    const markdown = toJobSummaryMarkdown(input({ entries: [{ result: FAILED_RUN }] }));
    expect(markdown.startsWith('## ❌ sqlib test results')).toBe(true);
    expect(markdown).toContain('**1/2** cases passed');
  });

  it('marks a passing run green', () => {
    expect(toJobSummaryMarkdown(input()).startsWith('## ✅')).toBe(true);
  });

  it('puts failures above the fold and folds the passes away', () => {
    const markdown = toJobSummaryMarkdown(input({ entries: [{ result: FAILED_RUN }] }));
    expect(markdown.indexOf('### Failures')).toBeLessThan(markdown.indexOf('<details>'));
    expect(markdown).toContain('<summary>1 passing case</summary>');
  });

  it('escapes pipes and flattens newlines so the table survives', () => {
    const awkward = runResult({
      passed: false,
      cases: [testCase({ passed: false, message: 'a | b\nnext' })],
    });
    const markdown = toJobSummaryMarkdown(input({ entries: [{ result: awkward }] }));
    expect(markdown).toContain('a \\| b next');
    const failureRow = markdown.split('\n').find(line => line.includes('a \\| b next'));
    expect(failureRow?.startsWith('|')).toBe(true);
    expect(failureRow?.endsWith('|')).toBe(true);
  });

  it('truncates rather than overshooting the job-summary limit', () => {
    // GitHub rejects the whole summary when it is too large, so losing rows is
    // the recoverable failure and losing the file is not.
    const many = Array.from({ length: 4000 }, (_, index) => testCase({
      caseId: `${VERSION_ID}#case-${index}`,
      name: `Case ${index} ${'x'.repeat(400)}`,
      passed: false,
      message: 'y'.repeat(400),
    }));
    const markdown = toJobSummaryMarkdown(input({
      entries: [{ result: runResult({ passed: false, cases: many }) }],
    }));
    expect(Buffer.byteLength(markdown, 'utf8')).toBeLessThan(MAX_SUMMARY_BYTES + 4096);
    expect(markdown).toContain('Summary truncated');
  });
});

describe('toEarlTurtle', () => {
  const EARL = 'http://www.w3.org/ns/earl#';

  /** Parsed rather than string-matched: a report that will not load is not a report. */
  function parse(turtle: string): oxigraph.Store {
    const store = new oxigraph.Store();
    store.load(turtle, { format: 'text/turtle' });
    return store;
  }

  it('parses, and carries one assertion per case', () => {
    const store = parse(toEarlTurtle(input({
      entries: [{
        result: runResult({ cases: [testCase(), FAILING_CASE], passed: false, passedCount: 1, failedCount: 1 }),
        subject: 'urn:sqlib:query:q1',
        backend: 'urn:sqlib:backend:b1',
      }],
    })));

    const assertions = store.match(null, null, oxigraph.namedNode(`${EARL}Assertion`), null);
    expect(assertions).toHaveLength(2);

    const outcomes = store
      .match(null, oxigraph.namedNode(`${EARL}outcome`), null, null)
      .map(quad => quad.object.value)
      .sort();
    expect(outcomes).toEqual([`${EARL}failed`, `${EARL}passed`]);
  });

  it('reports a test that could not run as cantTell rather than dropping it', () => {
    const store = parse(toEarlTurtle(input({
      entries: [{ result: runResult({ cases: [], passed: false, message: 'no subject', passedCount: 0, failedCount: 0 }) }],
    })));

    const outcomes = store.match(null, oxigraph.namedNode(`${EARL}outcome`), null, null);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.object.value).toBe(`${EARL}cantTell`);
  });

  it('declares its prefixes and uses them, so the document is readable', () => {
    const turtle = toEarlTurtle(input());
    expect(turtle).toContain('@prefix earl: <http://www.w3.org/ns/earl#> .');
    expect(turtle).toContain('a earl:Assertion');
    expect(turtle).toContain('earl:outcome earl:passed');
    // Opaque minted identities stay full IRIs: a prefix over them would imply a
    // namespace that means something.
    expect(turtle).toMatch(/<urn:sqlib:assertion:[0-9a-f]+>/);
  });

  it('survives a suite name that would otherwise break the header comment', () => {
    const turtle = toEarlTurtle(input({ suite: 'urn:sqlib:tag:a\nnot a comment' }));
    expect(parse(turtle)).toBeDefined();
    expect(turtle.split('\n')[0]).toContain('not a comment');
  });

  it('escapes a comparator diff rather than emitting it raw', () => {
    // The diff is JSON, so it is full of quotes; a literal that does not escape
    // them is a document that stops parsing at the first one.
    const store = parse(toEarlTurtle(input({
      entries: [{ result: runResult({ cases: [FAILING_CASE], passed: false, passedCount: 0, failedCount: 1 }) }],
    })));
    const details = store.match(null, oxigraph.namedNode('https://sparql-query-lib/detail'), null, null);
    expect(details).toHaveLength(1);
    expect(JSON.parse(details[0]!.object.value)).toEqual({ missing: [{ s: 'urn:a' }] });
  });
});
