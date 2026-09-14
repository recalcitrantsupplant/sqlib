/**
 * A failed case's difference, as one marked list.
 *
 * `−` is expected but absent, `+` is produced but not expected. Reading them
 * interleaved is how you see that a "missing" triple is really the same triple
 * with one term wrong, which two separate lists hide.
 *
 * Here rather than in a component because two screens show the same diff: the
 * single-test work area, and the Runs tab's drill-in column. One of them was
 * always going to be a second implementation of the other otherwise, and a diff
 * that reads differently in two places is a diff nobody trusts.
 */
import type { TestCaseRunResult } from '../composables/useApiClient.js';

export interface TestDiffLine {
  mark: '-' | '+';
  text: string;
}

type WithDetail = Pick<TestCaseRunResult, 'detail'> | null | undefined;

export function testDiffLines(caseResult: WithDetail): TestDiffLine[] {
  const detail = caseResult?.detail;
  if (!detail) return [];
  return [
    ...(detail.missing ?? []).map((text) => ({ mark: '-' as const, text })),
    ...(detail.unexpected ?? []).map((text) => ({ mark: '+' as const, text })),
  ];
}

/** `11 matched · 1 expected only` — the arithmetic under the list. */
export function testDiffFooter(caseResult: WithDetail): string {
  const detail = caseResult?.detail;
  if (!detail) return '';
  const parts = [`${detail.matched ?? 0} matched`];
  if (detail.missing?.length) parts.push(`${detail.missing.length} expected only`);
  if (detail.unexpected?.length) parts.push(`${detail.unexpected.length} actual only`);
  return parts.join(' · ');
}

/** `1 missing, 0 unexpected` — the banner's one-line verdict. */
export function testDiffSummary(caseResult: WithDetail): string {
  const detail = caseResult?.detail;
  if (!detail) return '';
  return `${detail.missing?.length ?? 0} missing, ${detail.unexpected?.length ?? 0} unexpected`;
}
