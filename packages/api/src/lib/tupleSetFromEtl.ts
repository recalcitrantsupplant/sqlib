/**
 * Materialize a TupleSetVersion by running an ETL job's SQL.
 *
 * A DuckDB ETL job already produces exactly what a tuple set holds — a table of
 * rows — and until now the only place those rows could go was a SPARQL template
 * and, from there, a backend. A pipeline that computed a table had nowhere to
 * put the table itself except back out through a file. This is that sink
 * (issue #211), and it is the tabular twin of `dataGraphFromQuery`: resolve a
 * source, run it once, snapshot what came back.
 *
 * Three things are deliberate.
 *
 * **The rows are the ETL job's rows, not DuckDB's.** The conversion runs
 * through `EtlService.convertRowsToBindings`, the same call the SPARQL load
 * path makes, so a column mapping means one thing — its term types, datatypes,
 * IRI templates and null policy — whichever sink consumes it. A tuple set
 * written here holds the terms the SPARQL load would have inserted.
 *
 * **The mapping version is provenance, not decoration.** The SQL alone does not
 * decide the columns; the mapping does. So a snapshot records which mapping
 * version typed it, and `columnMappingVersionId` may be pinned rather than
 * defaulted to the job version's current one.
 *
 * **A result over the cap fails rather than truncates.** A half-table stored as
 * a version would be a lie a pinned id tells forever, so the budget is checked
 * as the stream is read and the run stops loudly — the rule `#153` set for
 * SPARQL-sourced data graphs, applied here.
 *
 * **A run that produced the same table is not a new version.** #211's third
 * point — version churn — is answered by `reSnapshot.ts`: if the set's current
 * version came from this job version and this mapping version and hashed the
 * same, that version already says what this run says, and cutting a second one
 * spends `MAX_TUPLE_SET_LIBRARY_BYTES` to store the sentence twice. The SQL is
 * still run, because the hash is what running it produces; what is saved is the
 * storage, which is what the cap actually bounds.
 *
 * **The run is recorded whatever it stored.** Because of the rule above, the
 * version chain is not a history of runs — an unchanged re-run deliberately
 * leaves it untouched — so the run goes in the job's own log instead
 * (`etlRunLog.ts`): started, rows and chunks read, which version it ended at,
 * and whether that version was cut or reused. A run that failed after the
 * stream opened is recorded too, since what it stored (nothing) is the same
 * thing an unchanged re-run stores and the two are otherwise indistinguishable
 * from outside.
 */

import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { requireLibraryMode, resolveOwningLibrary } from '../auth/enforce.js';
import { duckDbService } from './DuckDbService.js';
import { EtlService } from './EtlService.js';
import { createTupleSetVersion, MAX_TUPLE_SET_VERSION_BYTES } from './TupleSetVersionWriter.js';
import { currentVersionOfParent, isUnchangedReSnapshot } from './reSnapshot.js';
import { beginEtlExecution, completeEtlExecution, failEtlExecution } from './etlRunLog.js';
import type { LdkitTupleSetVersion } from '../persistence/schemas/TupleSetVersionSchema.js';
import type { LdkitEtlJobVersion } from '../persistence/schemas/EtlJobVersionSchema.js';
import type {
  ColumnDefinition,
  LdkitEtlColumnMappingVersion,
} from '../persistence/schemas/EtlColumnMappingVersionSchema.js';
import type { TupleRow } from './tupleContent.js';

const etlService = new EtlService();

/** A caller mistake — bad job version, no mapping, empty mapping. Maps to 400/404. */
export class TupleSetEtlSourceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'TupleSetEtlSourceError';
  }
}

export interface MaterializeTupleSetVersionFromEtlInput {
  etlJobVersionId: string;
  /** Defaults to the job version's current mapping; pin it to snapshot an older typing. */
  columnMappingVersionId?: string | null;
  comment?: string | null;
}

/**
 * What the sink did. `reused` distinguishes "there is now a version holding
 * these rows" from "there is now a *new* version holding these rows" — the
 * route turns it into 200 rather than 201, which is the only place the caller
 * can read the difference.
 */
export interface MaterializedTupleSetVersion {
  version: LdkitTupleSetVersion;
  reused: boolean;
}

const DEFAULT_CHUNK_SIZE = 1000;

/** Column order is the mapping's order; a variable mapped twice appears once. */
function variablesOf(columns: ColumnDefinition[]): string[] {
  const seen = new Set<string>();
  const vars: string[] = [];
  for (const column of columns) {
    if (!column.targetVariable || seen.has(column.targetVariable)) continue;
    seen.add(column.targetVariable);
    vars.push(column.targetVariable);
  }
  return vars;
}

function parseColumnDefinitions(mapping: LdkitEtlColumnMappingVersion): ColumnDefinition[] {
  try {
    const parsed = JSON.parse(mapping.columns) as unknown;
    return Array.isArray(parsed) ? (parsed as ColumnDefinition[]) : [];
  } catch {
    throw new TupleSetEtlSourceError(
      `Column mapping version ${mapping.$id} does not hold a readable column list`,
      400,
    );
  }
}

/**
 * Resolve the job version and its mapping, stream the SQL, and hand back a
 * persisted `TupleSetVersion`.
 *
 * Split the same way `materializeDataGraphVersionFromQuery` is: this is the
 * "how did we get the content" half, `createTupleSetVersion` is "content in,
 * snapshot out".
 */
export async function materializeTupleSetVersionFromEtl(
  tupleSetId: string,
  input: MaterializeTupleSetVersionFromEtlInput,
  authScope?: { request: FastifyRequest },
): Promise<MaterializedTupleSetVersion> {
  const cacheCoordinator = getCacheCoordinator();

  const jobVersion = cacheCoordinator.get(input.etlJobVersionId) as LdkitEtlJobVersion | null;
  if (!jobVersion || jobVersion['@type'] !== 'EtlJobVersion') {
    throw new TupleSetEtlSourceError(`EtlJobVersion ${input.etlJobVersionId} not found`, 404);
  }

  // The route guard checks the tuple set being written; this is the second
  // entity, and running its SQL is an execution. Without this, write on one
  // library would run any other library's stored DuckDB SQL — the reach #132
  // closed on `/etl-jobs/preview`, arriving by a different door.
  if (authScope) {
    requireLibraryMode(authScope.request, resolveOwningLibrary(jobVersion), 'execute');
  }

  const mappingVersionId = input.columnMappingVersionId ?? jobVersion.currentColumnMappingVersion;
  if (!mappingVersionId) {
    throw new TupleSetEtlSourceError(
      `EtlJobVersion ${input.etlJobVersionId} has no current column mapping version — a tuple set needs one to know its columns`,
      400,
    );
  }

  const mappingVersion = cacheCoordinator.get(mappingVersionId) as LdkitEtlColumnMappingVersion | null;
  if (!mappingVersion || mappingVersion['@type'] !== 'EtlColumnMappingVersion') {
    throw new TupleSetEtlSourceError(`EtlColumnMappingVersion ${mappingVersionId} not found`, 404);
  }

  const columns = parseColumnDefinitions(mappingVersion);
  const vars = variablesOf(columns);
  if (vars.length === 0) {
    throw new TupleSetEtlSourceError(
      `Column mapping version ${mappingVersionId} maps no columns — there is no table to save`,
      400,
    );
  }

  const chunkSize = Number(jobVersion.chunkSize) || DEFAULT_CHUNK_SIZE;
  const bindings: TupleRow[] = [];
  // The cap is the persisted document's, so the running estimate is over the
  // rows alone; the head and the JSON scaffolding only make the real figure
  // larger, and `createTupleSetVersion` checks it exactly before storing.
  let rowBytes = 0;
  const executedAt = new Date().toISOString();

  // Opened after every caller mistake above has been refused, so the log holds
  // runs rather than typos: an unknown job version or an empty mapping ran no
  // SQL and is not an execution of anything.
  const executionId = await beginEtlExecution({
    etlJobVersionId: input.etlJobVersionId,
    columnMappingVersionId: mappingVersionId,
    startedAt: executedAt,
    // The tuple set is part of the config rather than the outcome: a run that
    // fails still says which set it was writing into, which is what makes a
    // failed run in the log answerable without the caller's request beside it.
    executionConfig: { chunkSize, sink: 'tuple-set', tupleSetId },
  });

  // Counted the way the execute path counts them — over the rows DuckDB
  // returned, not the bindings they converted to, so a mapping that drops rows
  // is visible as the difference between the log and the version's `rowCount`.
  let totalRows = 0;
  let completedChunks = 0;
  let outcome: MaterializedTupleSetVersion;

  try {
    try {
      for await (const { rows } of duckDbService.streamChunks(jobVersion.sql, chunkSize)) {
        totalRows += rows.length;
        const converted: TupleRow[] = etlService.convertRowsToBindings(rows, columns);
        for (const binding of converted) {
          rowBytes += Buffer.byteLength(JSON.stringify(binding), 'utf8') + 1;
          if (rowBytes > MAX_TUPLE_SET_VERSION_BYTES) {
            throw new TupleSetEtlSourceError(
              `The ETL result passed the ${MAX_TUPLE_SET_VERSION_BYTES}-byte limit for one tuple set version after ${bindings.length} rows — narrow the query rather than storing part of the table`,
              400,
            );
          }
          bindings.push(binding);
        }
        completedChunks += 1;
      }
    } catch (error) {
      if (error instanceof TupleSetEtlSourceError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new TupleSetEtlSourceError(`Failed to run the ETL job's SQL: ${message}`, 502);
    }

    const contentString = JSON.stringify({ head: { vars }, results: { bindings } });
    // Over the document we hand the writer. Rows are ordered, so unlike the
    // data-graph twin there is nothing to sort first: the same query over the
    // same table produces the same hash only if it produced the same table in
    // the same order, which is exactly the claim a snapshot makes.
    const resultHash = createHash('sha256').update(contentString).digest('hex');

    // Hashed before normalisation, and compared against a hash taken the same
    // way — so a normaliser that gained cleverness between the two runs is not
    // a difference. That is the same rule `TupleSetVersionWriter` already
    // states: a version means what it meant when it was imported, and
    // normalisation is never retroactive.
    const current = currentVersionOfParent<LdkitTupleSetVersion & Record<string, unknown>>(
      tupleSetId,
      'TupleSetVersion',
    );
    if (
      current &&
      isUnchangedReSnapshot(current, resultHash, {
        sourceEtlJobVersion: input.etlJobVersionId,
        sourceColumnMappingVersion: mappingVersionId,
      })
    ) {
      outcome = { version: current, reused: true };
    } else {
      const version = await createTupleSetVersion(tupleSetId, {
        contentString,
        sourceFormat: 'etl-results',
        comment: input.comment ?? null,
        source: {
          etlJobVersionId: input.etlJobVersionId,
          columnMappingVersionId: mappingVersionId,
          executedAt,
          resultHash,
        },
      });
      outcome = { version, reused: false };
    }
  } catch (error) {
    // Everything the snapshot can refuse belongs here as much as a broken
    // query does — the library budget in particular, which fails *after* the
    // whole table has been read and is exactly the run an operator will want
    // to find later.
    await failEtlExecution(executionId, error);
    throw error;
  }

  // Outside the catch above on purpose: a log write that fails here must not
  // turn a run that stored a version into a run recorded as failed.
  await completeEtlExecution(executionId, {
    totalRows,
    completedChunks,
    totalChunks: completedChunks,
    outputTupleSetVersion: outcome.version.$id,
    outputReused: outcome.reused,
  });

  return outcome;
}
