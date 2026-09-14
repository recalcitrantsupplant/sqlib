/**
 * Materialize a DataGraphVersion by running a CONSTRUCT/DESCRIBE query.
 *
 * "Get the data graph from a SPARQL endpoint" is a reduced query group — one
 * CONSTRUCT/DESCRIBE, optional arguments, one backend — snapshotted rather
 * than kept live: versions are immutable, and reproducibility is the point.
 * A live pull is already expressible as a query-group edge; this is for the
 * case where you want a graph *this* execution produced, forever after.
 *
 * See issue #153 (first bullet).
 *
 * A run that produced the same graph is not a new version — see
 * `reSnapshot.ts`. The rule is #211's (version churn on the tuple-set sink) and
 * applies here unchanged, because this sink is the same shape: caller-driven
 * today, and a version per run the moment anything drives it on a schedule.
 */

import { createHash } from 'node:crypto';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { ArgumentSetService } from './ArgumentSetService.js';
import { ExecutorFactory } from './orchestration/ExecutorFactory.js';
import type { ExecutionAuthScope } from '../auth/executionScope.js';
import { requireLibraryMode, resolveOwningLibrary } from '../auth/enforce.js';
import { SparqlQueryParser } from './parser.js';
import { toQueryTypeIri, isGraphQueryType } from './queryTypes.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import {
  DEFAULT_DATA_GRAPH_FORMAT,
  type DataGraphFormat,
  isDataGraphFormat,
  rdfToNQuads,
} from './dataGraphContent.js';
import { createDataGraphVersion } from './DataGraphVersionWriter.js';
import { currentVersionOfParent, isUnchangedReSnapshot } from './reSnapshot.js';
import type { LdkitDataGraphVersion } from '../persistence/schemas/DataGraphVersionSchema.js';

const argumentSetService = new ArgumentSetService();
const parser = new SparqlQueryParser();

/** A caller mistake — bad query id, wrong query type, unresolvable argument set. Maps to 400/404. */
export class DataGraphQuerySourceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'DataGraphQuerySourceError';
  }
}

/**
 * What the sink did. `reused` distinguishes "there is now a version holding
 * this graph" from "there is now a *new* version holding it" — the route turns
 * it into 200 rather than 201.
 */
export interface MaterializedDataGraphVersion {
  version: LdkitDataGraphVersion;
  reused: boolean;
}

export interface MaterializeDataGraphVersionInput {
  queryVersionId: string;
  argumentSetVersionId?: string | null;
  backendId: string;
  comment?: string | null;
}

/** The content-type strings a backend might actually report, normalised to one of our three formats. */
function resolveContentFormat(contentType: string | undefined): DataGraphFormat {
  if (!contentType) return DEFAULT_DATA_GRAPH_FORMAT;
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return isDataGraphFormat(mediaType) ? mediaType : DEFAULT_DATA_GRAPH_FORMAT;
}

/** SHA-256 over the sorted N-Quads lines — stable under reordering, no bnode canonicalisation dependency. */
function hashNQuads(nQuads: string): string {
  const lines = nQuads.split('\n').filter(line => line.trim().length > 0).sort();
  const hasher = createHash('sha256');
  for (const line of lines) {
    hasher.update(line);
    hasher.update('\n');
  }
  return hasher.digest('hex');
}

/**
 * Resolve `queryVersionId` + `argumentSetVersionId` + `backendId`, run the
 * query, and hand back a `createDataGraphVersion` input ready to persist.
 *
 * Deliberately separate from `createDataGraphVersion` itself: this is the
 * "how did we get the content" half, that function is "content in, snapshot
 * out" — the same split `BenchmarkRunner.executeQueryVersion` draws between
 * resolving a subject and running it.
 */
export async function materializeDataGraphVersionFromQuery(
  dataGraphId: string,
  input: MaterializeDataGraphVersionInput,
  authScope?: ExecutionAuthScope,
): Promise<MaterializedDataGraphVersion> {
  const cacheCoordinator = getCacheCoordinator();

  const versionEntity = cacheCoordinator.get(input.queryVersionId) as LdkitQueryVersion | null;
  if (!versionEntity || versionEntity['@type'] !== 'QueryVersion') {
    throw new DataGraphQuerySourceError(`QueryVersion ${input.queryVersionId} not found`, 404);
  }

  /*
   * The route guard checks the data graph being written; this is the second
   * entity, and running its stored query is an execution. Without it, write on
   * one library ran any other library's saved query — the reach
   * `materializeTupleSetVersionFromEtl` closes on the ETL job version it is
   * handed, arriving through a different door. It is checked before the query
   * type, so an unreachable query answers the same whatever it is.
   *
   * `input.argumentSetVersionId` is deliberately *not* checked the same way:
   * `/execute` requires Execute on the target's library and says nothing about
   * the argument sets applied to it, so narrowing it here would make this route
   * disagree with the one every client already uses. It is a deployment-wide
   * question rather than a data-graph one.
   */
  if (authScope) {
    requireLibraryMode(authScope.request, resolveOwningLibrary(versionEntity), 'execute');
  }

  const queryType = toQueryTypeIri(versionEntity.queryType);
  if (!isGraphQueryType(queryType)) {
    throw new DataGraphQuerySourceError(
      `QueryVersion ${input.queryVersionId} is not a CONSTRUCT or DESCRIBE query — only a query with a graph result can seed a data graph`,
      400,
    );
  }

  let queryString = versionEntity.queryString;
  if (input.argumentSetVersionId) {
    const resolved = argumentSetService.resolveExportVersionId(input.argumentSetVersionId);
    if ('problem' in resolved) {
      throw new DataGraphQuerySourceError(
        resolved.problem === 'not-found'
          ? `Argument set ${input.argumentSetVersionId} not found`
          : `Argument set ${input.argumentSetVersionId} has no current version`,
        404,
      );
    }
    const runtimePayload = await argumentSetService.exportRuntimePayload([input.argumentSetVersionId]);
    try {
      if (runtimePayload.limits.length > 0 || runtimePayload.offsets.length > 0) {
        queryString = parser.applyLimitOffsetParameters(queryString, runtimePayload.limits, runtimePayload.offsets);
      }
      if (runtimePayload.tupleList.length > 0) {
        queryString = parser.applyArguments(queryString, runtimePayload.tupleList);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DataGraphQuerySourceError(`Failed to apply arguments to the source query: ${message}`, 400);
    }
  }

  // Checked up front so a bad backendId is a 404 like the query/argument-set
  // checks above, rather than falling into the catch-all 502 a real backend
  // failure gets: only the latter is actually "the backend misbehaved".
  const backendEntity = cacheCoordinator.get(input.backendId);
  if (!backendEntity || (backendEntity as { '@type'?: string })['@type'] !== 'Backend') {
    throw new DataGraphQuerySourceError(`Backend ${input.backendId} not found`, 404);
  }

  const executor = await new ExecutorFactory(authScope).getExecutorForBackendId(input.backendId);
  const { result, contentType } = await executor.constructQueryParsed(queryString);
  const contentFormat = resolveContentFormat(contentType);

  // Same measure as a hand-authored version's `resultHash` would need: the
  // N-Quads form of exactly what got saved, so a version materialized twice
  // from unchanged data hashes the same regardless of backend serialisation
  // quirks (line order, blank-node labelling within one document).
  const resultHash = hashNQuads(rdfToNQuads(result, contentFormat));

  // An unchanged re-run reuses the version that already says it, rather than
  // cutting a second one against the library budget. Nothing else has to be
  // undone by taking this branch: no head moves, so the Oxigraph stores
  // tracking this graph are not stale and are deliberately not invalidated.
  const current = currentVersionOfParent<LdkitDataGraphVersion & Record<string, unknown>>(
    dataGraphId,
    'DataGraphVersion',
  );
  if (
    current &&
    isUnchangedReSnapshot(current, resultHash, {
      sourceQueryVersion: input.queryVersionId,
      sourceArgumentSetVersion: input.argumentSetVersionId ?? null,
      sourceBackend: input.backendId,
    })
  ) {
    return { version: current, reused: true };
  }

  const version = await createDataGraphVersion(dataGraphId, {
    contentString: result,
    contentFormat,
    comment: input.comment ?? null,
    source: {
      queryVersionId: input.queryVersionId,
      argumentSetVersionId: input.argumentSetVersionId ?? null,
      backendId: input.backendId,
      executedAt: new Date().toISOString(),
      resultHash,
    },
  });
  return { version, reused: false };
}
