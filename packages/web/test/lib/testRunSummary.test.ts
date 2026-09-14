/**
 * The Runs tab's arithmetic.
 *
 * Everything on that screen is "of this run", so the facts worth pinning are
 * the ones that make that true: a test the scope named but that never answered
 * is excluded rather than absent, a test under two tags is counted once, and a
 * verdict stamped with a version the test has left is shown as such rather than
 * silently.
 */
import { describe, expect, it } from 'vitest';
import { buildTestRunSummary, formatRunDuration, type TestRunScope } from '@/lib/testRunSummary';
import type { TestRunResult } from '@/composables/useApiClient';

const scope = (testIds: string[], answeredIds: string[] = testIds): TestRunScope => ({
  kind: 'tag',
  label: 'tag: conformance',
  tagIds: ['tag:conformance'],
  match: 'any',
  testIds,
  answeredIds,
  startedAt: '2026-08-31T10:00:00.000Z',
  finishedAt: '2026-08-31T10:00:48.000Z',
  wallMs: 48_000,
  cancelled: false,
});

function verdict(overrides: Partial<TestRunResult> & { testId: string }): TestRunResult {
  return {
    testVersionId: `${overrides.testId}/v/1`,
    passed: true,
    message: '',
    expectationKind: 'bindings',
    hermetic: false,
    durationMs: 100,
    subjectVersionId: null,
    ranAt: '2026-08-31T10:00:10.000Z',
    cases: [],
    passedCount: 1,
    failedCount: 0,
    ...overrides,
  };
}

function caseResult(name: string, passed: boolean, message = '') {
  return {
    caseId: `${name}-id`,
    name,
    position: 0,
    passed,
    message,
    detail: passed ? null : { missing: ['<a> <b> <c> .'], unexpected: [], matched: 11 },
    durationMs: 30,
  };
}

const tags = {
  'tag:queries': { name: 'Queries', color: null },
  'tag:w3c': { name: 'W3C eval suite', color: null },
};

describe('buildTestRunSummary', () => {
  it('counts a test the scope named but that never ran as excluded', () => {
    const summary = buildTestRunSummary({
      scope: scope(['t1', 't2'], ['t1']),
      tests: [
        { id: 't1', name: 'first', tags: ['tag:queries'], currentVersion: 't1/v/1' },
        { id: 't2', name: 'second', tags: ['tag:queries'], currentVersion: 't2/v/1' },
      ],
      results: { t1: verdict({ testId: 't1' }) },
      tags,
    });

    expect(summary.tallies.tests).toBe(2);
    expect(summary.tallies.excluded).toBe(1);
    expect(summary.rows.find((row) => row.id === 't2')?.status).toBe('excluded');
    // Excluded is a row in the failures list too — under its own filter.
    expect(summary.failures.filter((row) => row.status === 'excluded')).toHaveLength(1);
  });

  it('counts cases rather than tests, and one row per failing case', () => {
    const summary = buildTestRunSummary({
      scope: scope(['t1']),
      tests: [{ id: 't1', name: 'matrix', tags: ['tag:queries'], currentVersion: 't1/v/1' }],
      results: {
        t1: verdict({
          testId: 't1',
          passed: false,
          cases: [caseResult('a', true), caseResult('b', false, 'one missing'), caseResult('c', false, 'two missing')],
        }),
      },
      tags,
    });

    expect(summary.tallies.cases).toBe(3);
    expect(summary.tallies.passed).toBe(1);
    expect(summary.tallies.failed).toBe(2);
    expect(summary.failures).toHaveLength(2);
    expect(summary.failures[0].reason).toBe('one missing');
  });

  it('puts a test under one group, whatever else it carries', () => {
    const summary = buildTestRunSummary({
      scope: scope(['t1']),
      tests: [{ id: 't1', name: 'both', tags: ['tag:w3c', 'tag:queries'], currentVersion: 't1/v/1' }],
      results: { t1: verdict({ testId: 't1' }) },
      tags,
      tagOrder: ['tag:queries', 'tag:w3c'],
    });

    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0].label).toBe('Queries');
    expect(summary.byGroup).toHaveLength(1);
    expect(summary.byGroup[0].total).toBe(1);
  });

  it('groups an untagged test rather than dropping it', () => {
    const summary = buildTestRunSummary({
      scope: scope(['t1']),
      tests: [{ id: 't1', name: 'loose', tags: [], currentVersion: 't1/v/1' }],
      results: { t1: verdict({ testId: 't1' }) },
      tags,
    });

    expect(summary.groups[0].label).toBe('Untagged');
  });

  it('flags a verdict judged against a version the test has since left', () => {
    const summary = buildTestRunSummary({
      scope: scope(['t1']),
      tests: [{ id: 't1', name: 'edited', tags: ['tag:queries'], currentVersion: 't1/v/2' }],
      results: { t1: verdict({ testId: 't1', testVersionId: 't1/v/1' }) },
      tags,
    });

    expect(summary.rows[0].superseded).toBe(true);
  });

  it('splits by backend, and keeps a test whose store was not recorded', () => {
    const summary = buildTestRunSummary({
      scope: scope(['t1', 't2']),
      tests: [
        { id: 't1', name: 'on fuseki', tags: ['tag:queries'], currentVersion: 't1/v/1' },
        { id: 't2', name: 'unattributed', tags: ['tag:queries'], currentVersion: 't2/v/1' },
      ],
      results: {
        t1: verdict({ testId: 't1' }),
        t2: verdict({ testId: 't2', passed: false, cases: [caseResult('only', false, 'nope')] }),
      },
      tags,
      backends: { t1: { id: 'backend:fuseki', name: 'Fuseki' } },
    });

    expect(summary.byBackend.map((row) => row.label).sort())
      .toEqual(['Backend not recorded', 'Fuseki']);
    // Both columns describe the same run, so both add up to the same cases.
    const cases = (rows: { total: number }[]) => rows.reduce((sum, row) => sum + row.total, 0);
    expect(cases(summary.byBackend)).toBe(cases(summary.byGroup));
  });

  it('records a test that could not run at all as one failure, not zero', () => {
    const summary = buildTestRunSummary({
      scope: scope(['t1']),
      tests: [{ id: 't1', name: 'broken subject', tags: ['tag:queries'], currentVersion: 't1/v/1' }],
      results: { t1: verdict({ testId: 't1', passed: false, message: 'Test could not be run', cases: [] }) },
      tags,
    });

    expect(summary.tallies.failed).toBe(1);
    expect(summary.tallies.cases).toBe(1);
    expect(summary.failures[0].reason).toBe('Test could not be run');
  });
});

describe('a run that has not answered yet', () => {
  /*
   * The bug this guards: Run all repainted the previous run's bars the instant
   * it started, because a verdict in the cache looked like an answer to the run
   * in front of you. You watched a duration change and got the same tallies
   * back.
   */
  const verdicts = { t1: verdict({ testId: 't1' }), t2: verdict({ testId: 't2', passed: false }) };
  const tests = [
    { id: 't1', name: 'first', tags: ['tag:queries'], currentVersion: 't1/v/1' },
    { id: 't2', name: 'second', tags: ['tag:queries'], currentVersion: 't2/v/1' },
  ];

  it('counts nothing from the run before it', () => {
    const summary = buildTestRunSummary({
      scope: scope(['t1', 't2'], []),
      tests,
      results: verdicts,
      tags,
      running: true,
    });

    expect(summary.tallies.pending).toBe(2);
    expect(summary.tallies.cases).toBe(0);
    expect(summary.tallies.passed).toBe(0);
    expect(summary.tallies.failed).toBe(0);
    /*
     * Nothing drawn as a verdict, but the run's size is known from the moment
     * it opens: an empty bar over `0/2`, not an empty bar over `0/0`. This is
     * what makes the bar fill in rather than reading full from the first
     * verdict to the last.
     */
    expect(summary.byGroup[0]).toMatchObject({ pass: 0, fail: 0, pending: 2, total: 2 });
    expect(summary.failures).toHaveLength(0);
  });

  it('fills in as each test answers', () => {
    const summary = buildTestRunSummary({
      scope: scope(['t1', 't2'], ['t1']),
      tests,
      results: verdicts,
      tags,
      running: true,
    });

    expect(summary.tallies.passed).toBe(1);
    expect(summary.tallies.pending).toBe(1);
    expect(summary.rows.find((row) => row.id === 't2')?.status).toBe('pending');
    // Half the bar, not all of it: the denominator is the whole run throughout.
    expect(summary.byGroup[0]).toMatchObject({ pass: 1, pending: 1, total: 2 });
    // And the heading counts the test still to answer as one case, so `1 / 2`
    // is a run half done rather than a run that has finished twice.
    expect(summary.groups[0].totalCases).toBe(2);
  });

  it('stops counting what never answered as still to come once the run stops', () => {
    const summary = buildTestRunSummary({
      scope: scope(['t1', 't2'], ['t1']),
      tests,
      results: verdicts,
      tags,
      running: false,
    });

    expect(summary.byGroup[0]).toMatchObject({ pass: 1, excluded: 1, pending: 0, total: 2 });
  });

  it('calls what never answered excluded once the run has stopped', () => {
    const summary = buildTestRunSummary({
      scope: scope(['t1', 't2'], ['t1']),
      tests,
      results: verdicts,
      tags,
      running: false,
    });

    expect(summary.tallies.pending).toBe(0);
    expect(summary.tallies.excluded).toBe(1);
    expect(summary.rows.find((row) => row.id === 't2')?.status).toBe('excluded');
  });
});

describe('formatRunDuration', () => {
  it('reads a duration at the scale it is', () => {
    expect(formatRunDuration(312)).toBe('312ms');
    expect(formatRunDuration(4_800)).toBe('4.8s');
    expect(formatRunDuration(48_000)).toBe('48s');
    expect(formatRunDuration(125_000)).toBe('2m 5s');
  });

});
