import { describe, it, expect } from 'vitest';
import {
  negotiateReportFormat,
  renderReport,
  TEST_REPORT_MEDIA_TYPES,
  type TestReportInput,
} from '../../../src/lib/reportFormats/index.js';
import type { TestRunResult } from '../../../src/lib/TestRunner.js';

function mediaTypeFor(accept: string): string {
  const negotiated = negotiateReportFormat(accept);
  return negotiated.kind === 'format' ? negotiated.format.mediaType : negotiated.kind;
}

describe('negotiateReportFormat', () => {
  it('treats a missing or empty Accept as the ordinary run response', () => {
    expect(negotiateReportFormat(undefined).kind).toBe('default');
    expect(negotiateReportFormat('').kind).toBe('default');
    expect(negotiateReportFormat('   ').kind).toBe('default');
  });

  it('never invents a format for a wildcard', () => {
    // A browser fetch sends `*/*`. Answering it with CSV because CSV sorts
    // first would make the plain call unpredictable.
    expect(mediaTypeFor('*/*')).toBe('default');
    expect(mediaTypeFor('application/json')).toBe('default');
    expect(mediaTypeFor('application/json, */*')).toBe('default');
  });

  it('picks the named format', () => {
    expect(mediaTypeFor('application/xml')).toBe(TEST_REPORT_MEDIA_TYPES.JUNIT);
    expect(mediaTypeFor('text/csv')).toBe(TEST_REPORT_MEDIA_TYPES.CSV);
    expect(mediaTypeFor('text/markdown')).toBe(TEST_REPORT_MEDIA_TYPES.MARKDOWN);
    expect(mediaTypeFor(TEST_REPORT_MEDIA_TYPES.JSON_EXPORT)).toBe(TEST_REPORT_MEDIA_TYPES.JSON_EXPORT);
  });

  it('accepts the older JUnit spelling and ignores case and parameters', () => {
    expect(mediaTypeFor('TEXT/XML')).toBe(TEST_REPORT_MEDIA_TYPES.JUNIT);
    expect(mediaTypeFor('text/csv; charset=utf-8')).toBe(TEST_REPORT_MEDIA_TYPES.CSV);
  });

  it('honours q-values, and falls back down the list', () => {
    expect(mediaTypeFor('text/csv;q=0.2, application/xml;q=0.9')).toBe(TEST_REPORT_MEDIA_TYPES.JUNIT);
    // `q=0` means "not this one" — the next acceptable type wins.
    expect(mediaTypeFor('application/xml;q=0, text/csv')).toBe(TEST_REPORT_MEDIA_TYPES.CSV);
  });

  it('breaks a tie in the order the caller wrote', () => {
    expect(mediaTypeFor('text/csv, application/xml')).toBe(TEST_REPORT_MEDIA_TYPES.CSV);
    expect(mediaTypeFor('application/xml, text/csv')).toBe(TEST_REPORT_MEDIA_TYPES.JUNIT);
  });

  it('reads a malformed q as absent rather than as a refusal', () => {
    expect(mediaTypeFor('application/xml;q=high')).toBe(TEST_REPORT_MEDIA_TYPES.JUNIT);
  });

  it('reports an Accept it cannot satisfy rather than quietly answering JSON', () => {
    // A CI step that asked for XML and silently received JSON is a step that
    // looks green while reporting nothing.
    expect(mediaTypeFor('application/pdf')).toBe('unacceptable');
    expect(mediaTypeFor('image/png, text/vcard')).toBe('unacceptable');
  });
});

describe('renderReport', () => {
  const result: TestRunResult = {
    testId: 'urn:sqlib:test:t1',
    testVersionId: 'urn:sqlib:test-version:tv1',
    passed: true,
    message: '',
    expectationKind: 'bindings' as TestRunResult['expectationKind'],
    hermetic: true,
    durationMs: 3,
    subjectVersionId: null,
    ranAt: '2026-08-14T09:32:11.000Z',
    cases: [{
      caseId: 'urn:sqlib:test-version:tv1#case-0',
      name: 'Case 1',
      position: 0,
      passed: true,
      message: '',
      inputs: { argumentSetVersion: null, dataGraphVersion: null },
      durationMs: 3,
    }],
    passedCount: 1,
    failedCount: 0,
  };
  const input: TestReportInput = { suite: 'urn:sqlib:test:t1', entries: [{ result }] };

  it('names the file and the type so a browser download lands usefully', () => {
    const negotiated = negotiateReportFormat('application/xml');
    if (negotiated.kind !== 'format') throw new Error('expected a format');
    const rendered = renderReport(negotiated.format, input);
    expect(rendered.contentType).toBe('application/xml; charset=utf-8');
    expect(rendered.contentDisposition).toBe('attachment; filename="test-results.xml"');
    expect(rendered.body).toContain('<testsuites');
  });
});
