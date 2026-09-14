/**
 * The ETL job's run log.
 *
 * `EtlExecution` has recorded runs of `/etl-jobs/:id/execute` since ETL was
 * written — started, finished, how many chunks and rows, and where the RDF
 * went. What it had never recorded is the *other* sink: a run through
 * `/tuple-sets/:id/versions/from-etl` (issue #211) executed the same job
 * version's SQL against the same source and left no trace in the job's
 * history at all.
 *
 * That absence is what the unchanged-re-snapshot rule asked for under "a run
 * log", and the finding is the same shape as the one that rule itself opened
 * with: the mechanism was already stored, and what was missing was the writing.
 * It matters most for the case that rule created. An unchanged re-snapshot
 * deliberately cuts no version, so without a log a pipeline that runs every
 * hour over an unchanging table leaves *nothing* behind — the version chain is
 * silent by design, and silence cannot be told apart from a pipeline that never
 * ran.
 *
 * So the writes are collected here rather than inlined at each sink:
 *
 * - **What is logged is a run of the job, not a route.** Both sinks ask for a
 *   job version's SQL to be run against its real source and keep what came
 *   back. `/etl-jobs/preview` is exempt because it is a sample of arbitrary
 *   SQL with no job version in the story, and a test run is exempt because its
 *   executor and its rows are substituted (`EtlService.runPipeline`) — neither
 *   is a run of the job, which is the rule that docblock already states.
 * - **A run is logged even when it stores nothing.** A failure after the
 *   stream opened, and a re-snapshot that reused the current version, are both
 *   things that happened; a log that only held successes would answer "did it
 *   run" with the same silence as never running.
 */

import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { toError } from './toError.js';
import type { LdkitEtlExecution } from '../persistence/schemas/EtlExecutionSchema.js';

export interface BeginEtlExecutionInput {
  /** The version whose SQL is being run, as an IRI. */
  etlJobVersionId: string;
  /** The mapping version that types its columns, as an IRI. */
  columnMappingVersionId: string;
  /** When the run started, so the log and the provenance agree to the millisecond. */
  startedAt: string;
  /** Recorded as a JSON string, the way the execute path records its own config. */
  executionConfig?: Record<string, unknown>;
}

/** Fields a finished run adds. `status` and `completedAt` are set here. */
export type EtlExecutionOutcome = Partial<
  Pick<
    LdkitEtlExecution,
    | 'totalChunks'
    | 'completedChunks'
    | 'totalRows'
    | 'outputFormat'
    | 'outputLocation'
    | 'outputTupleSetVersion'
    | 'outputReused'
  >
>;

/** Open a run's record, before anything has been read. */
export async function beginEtlExecution(input: BeginEtlExecutionInput): Promise<string> {
  const executionId = mintId('etlExecution');
  const execution: LdkitEtlExecution = {
    $id: executionId,
    etlJobVersion: input.etlJobVersionId,
    columnMappingVersion: input.columnMappingVersionId,
    status: 'running',
    startedAt: input.startedAt,
    ...(input.executionConfig ? { executionConfig: JSON.stringify(input.executionConfig) } : {}),
  };

  await getCacheCoordinator().create('EtlExecution', execution);
  return executionId;
}

/**
 * Record how far a run has got, while it is still running.
 *
 * Only the file-writing sink reports this: it streams chunk by chunk into a
 * file, so a long run is worth watching. The tabular sink holds its rows in
 * memory until the snapshot, so there is no partial state to report — it is
 * one chunk loop with one outcome.
 */
export async function recordEtlExecutionProgress(
  executionId: string,
  progress: { completedChunks: number; totalRows: number },
): Promise<void> {
  await getCacheCoordinator().update('EtlExecution', executionId, {
    completedChunks: progress.completedChunks,
    totalRows: progress.totalRows,
  });
}

/** Close a run's record as completed, with what it produced. */
export async function completeEtlExecution(
  executionId: string,
  outcome: EtlExecutionOutcome = {},
): Promise<void> {
  await getCacheCoordinator().update('EtlExecution', executionId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    ...outcome,
  });
}

/**
 * Close a run's record as failed.
 *
 * Never throws. This is called from a `catch`, where the error the caller is
 * holding is the one that matters: a log write that failed here would
 * otherwise replace "the SQL was invalid" with "the store rejected a write",
 * and the caller would report the wrong failure.
 */
export async function failEtlExecution(executionId: string, error: unknown): Promise<void> {
  const message = toError(error).message;
  try {
    await getCacheCoordinator().update('EtlExecution', executionId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      errorMessage: message,
    });
  } catch (writeFailure__u: unknown) {
    console.warn(
      `Could not record the failure of ETL execution ${executionId}: ${toError(writeFailure__u).message}`,
    );
  }
}
