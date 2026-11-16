/**
 * Runs a server recorded, read back for display.
 *
 * A server in demo mode (`SQLIB_DEMO=true`) is read-only and keeps no run a
 * visitor makes. The runs it shows are the ones recorded when its image was
 * built. These helpers turn the stored forms into the shapes the Tests and ETL
 * screens already draw for a run made in this browser.
 */
import type { TestRunResult } from '@sparql-query-lib/contracts';

/** A stored test run with its cases (`GET /tests/:id/runs/:runId`). */
export interface StoredTestRun {
  id: string;
  test: string;
  testVersion?: string | null;
  subjectVersion?: string | null;
  outcome: string;
  expectationKind: string;
  hermetic?: boolean | null;
  message?: string | null;
  durationMs?: number | null;
  passedCount?: number | null;
  failedCount?: number | null;
  slowCount?: number | null;
  ranAt: string;
  cases?: StoredTestRunCase[];
}

export interface StoredTestRunCase {
  id: string;
  testCase?: string | null;
  name?: string | null;
  position?: number | null;
  outcome: string;
  message?: string | null;
  detail?: string | null;
  durationMs?: number | null;
  maxDurationMs?: number | null;
  slow?: boolean | null;
  argumentSetVersion?: string | null;
  dataGraphVersion?: string | null;
  dataGraphVersions?: string[] | null;
}

function parseDetail(raw: string | null | undefined): TestRunResult['cases'][number]['detail'] {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || typeof value !== 'object') return null;
    return {
      ...(Array.isArray(value.missing) ? { missing: value.missing.map(String) } : {}),
      ...(Array.isArray(value.unexpected) ? { unexpected: value.unexpected.map(String) } : {}),
      ...(typeof value.matched === 'number' ? { matched: value.matched } : {}),
    };
  } catch {
    return null;
  }
}

/** A stored run as the verdict the Tests screens draw. */
export function testRunFromStored(stored: StoredTestRun): TestRunResult {
  const cases = [...(stored.cases ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((row, index) => ({
      caseId: row.testCase ?? row.id,
      name: row.name ?? `Case ${index + 1}`,
      position: row.position ?? index,
      passed: row.outcome === 'passed',
      message: row.message ?? '',
      detail: parseDetail(row.detail),
      inputs: {
        argumentSetVersion: row.argumentSetVersion ?? null,
        dataGraphVersion: row.dataGraphVersion ?? null,
        dataGraphVersions: row.dataGraphVersions ?? null,
      },
      durationMs: row.durationMs ?? 0,
      maxDurationMs: row.maxDurationMs ?? null,
      slow: row.slow ?? null,
    }));
  return {
    testId: stored.test,
    testVersionId: stored.testVersion ?? '',
    passed: stored.outcome === 'passed',
    message: stored.message ?? '',
    expectationKind: stored.expectationKind,
    hermetic: stored.hermetic ?? false,
    durationMs: stored.durationMs ?? 0,
    subjectVersionId: stored.subjectVersion ?? null,
    ranAt: stored.ranAt,
    cases,
    passedCount: stored.passedCount ?? cases.filter((c) => c.passed).length,
    failedCount: stored.failedCount ?? cases.filter((c) => !c.passed).length,
    slowCount: stored.slowCount ?? 0,
  };
}

/** An ETL execution as the server lists it (`GET /etl-jobs/:id/executions`). */
export interface StoredEtlExecution {
  id: string;
  status: string;
  totalRows?: number | null;
  totalChunks?: number | null;
  errorMessage?: string | null;
  outputFormat?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

/** What the ETL screen's Results tab draws, from a recorded execution and its RDF. */
export function etlResultFromStored(execution: StoredEtlExecution, rdfOutput: string) {
  return {
    status: execution.status,
    errorMessage: execution.errorMessage ?? undefined,
    totalRows: execution.totalRows ?? 0,
    totalChunks: execution.totalChunks ?? 0,
    rdfOutput,
    contentType: execution.outputFormat ?? undefined,
    recordedAt: execution.completedAt ?? execution.startedAt ?? null,
  };
}
