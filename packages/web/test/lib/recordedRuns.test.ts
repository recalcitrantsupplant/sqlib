import { describe, it, expect } from 'vitest';
import { etlResultFromStored, testRunFromStored } from '@/lib/recordedRuns';

describe('a recorded test run', () => {
  it('becomes the verdict the Tests screens draw, with cases in order', () => {
    const verdict = testRunFromStored({
      id: 'urn:sqlib:testRun:1',
      test: 'urn:sqlib:test:a',
      testVersion: 'urn:sqlib:test:a:v2',
      outcome: 'failed',
      expectationKind: 'rows',
      hermetic: true,
      message: '1 of 2 cases failed',
      durationMs: 12,
      passedCount: 1,
      failedCount: 1,
      slowCount: 0,
      ranAt: '2026-11-16T10:00:00.000Z',
      cases: [
        { id: 'c2', testCase: 'case-2', name: 'Second', position: 1, outcome: 'failed', message: 'Missing a row', detail: '{"missing":["x"],"matched":3}', durationMs: 5 },
        { id: 'c1', testCase: 'case-1', name: 'First', position: 0, outcome: 'passed', detail: 'not json', durationMs: 7 },
      ],
    });
    expect(verdict).toMatchObject({
      testId: 'urn:sqlib:test:a',
      testVersionId: 'urn:sqlib:test:a:v2',
      passed: false,
      passedCount: 1,
      failedCount: 1,
      ranAt: '2026-11-16T10:00:00.000Z',
    });
    expect(verdict.cases.map((c) => [c.caseId, c.passed])).toEqual([['case-1', true], ['case-2', false]]);
    expect(verdict.cases[1].detail).toEqual({ missing: ['x'], matched: 3 });
    expect(verdict.cases[0].detail).toBeNull();
  });

  it('counts cases when the run has no counts', () => {
    const verdict = testRunFromStored({
      id: 'r', test: 't', outcome: 'passed', expectationKind: 'ask', ranAt: '2026-11-16T10:00:00.000Z',
      cases: [{ id: 'c', outcome: 'passed' }],
    });
    expect(verdict).toMatchObject({ passed: true, passedCount: 1, failedCount: 0, testVersionId: '' });
    expect(verdict.cases[0].name).toBe('Case 1');
  });
});

describe('a recorded ETL execution', () => {
  it('becomes the Results tab of the ETL screen, with when it ran', () => {
    expect(etlResultFromStored(
      { id: 'e', status: 'completed', totalRows: 16, totalChunks: 1, outputFormat: 'application/n-triples', completedAt: '2026-11-16T10:00:00.000Z' },
      '<a> <b> <c> .',
    )).toEqual({
      status: 'completed',
      errorMessage: undefined,
      totalRows: 16,
      totalChunks: 1,
      rdfOutput: '<a> <b> <c> .',
      contentType: 'application/n-triples',
      recordedAt: '2026-11-16T10:00:00.000Z',
    });
  });
});
