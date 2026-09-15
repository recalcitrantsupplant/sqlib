/**
 * Resolving a request's data-graph input to the executor's base graph.
 *
 * Three ways in, one destination — the same three every input slot takes, so a
 * caller learns the shape once (plan D14):
 *
 * - `dataGraphVersionId` — a saved, versioned graph, so the run is
 *   reproducible: the same id is the same bytes forever. *Pinned*.
 * - `dataGraphId` — the graph itself, resolved to whatever its current version
 *   is at run time. *Floating*, and the spelling `OxigraphDataGraphSource`
 *   already uses for the same distinction on a backend's hydration sources.
 *   Argument sets have accepted a parent or a version id since they existed;
 *   graphs took only the pinned form, so "run against the latest of this graph"
 *   meant looking the version up first.
 * - `dataGraphInline` — raw RDF text, ephemeral. This is what the playground
 *   and unsaved drafts send. It is never written to the library; the browser
 *   may keep it in local scratch, and saving a draft is where it gets promoted
 *   to a DataGraph.
 *
 * Both land on `RuleSetExecutionOptions.initialGraph` — `G0`, the base graph
 * the rules run against. That is the same seam query-group chaining already
 * uses to hand a construct node's output to a downstream ruleset, which is why
 * this feature needs no new execution infrastructure.
 *
 * Note what this is *not*: DATA blocks. Those are part of a rule set and come
 * out in its inference graph. A data graph goes in and does not come out.
 */

import type { FastifyRequest } from 'fastify';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { requireLibraryMode, resolveOwningLibrary } from '../auth/enforce.js';
import type { LdkitDataGraphVersion } from '../persistence/schemas/DataGraphVersionSchema.js';
import {
  DEFAULT_DATA_GRAPH_FORMAT,
  DataGraphContentError,
  inspectDataGraphContent,
  storeManagerFormat,
  type DataGraphFormat,
} from './dataGraphContent.js';

export interface DataGraphInputRequest {
  dataGraphVersionId?: string | null;
  /** The graph, floating to its current version. Exclusive with the other two. */
  dataGraphId?: string | null;
  dataGraphInline?: string | null;
  dataGraphInlineFormat?: string | null;
}

/**
 * The caller a stored graph is being resolved *for*.
 *
 * A `dataGraphVersionId` or `dataGraphId` in a request body names a stored
 * entity that need not live in the library the route resolved — the same shape
 * as `POST /tuple-sets/:id/versions/from-etl`, `POST /data-graphs/:id/versions/
 * from-query` and the pins `ArgumentSetService.createVersion` checks. The
 * difference is that those three ask the question at their own call site, and
 * this one is asked by four routes through one helper, so it is asked here.
 *
 * `read`, not `execute`, for the reason `requirePinnedSourcesReadable` gives:
 * a data graph stores no query and runs nothing. Its triples are copied into
 * the store a run reads from, which is what Read on that library governs
 * everywhere else.
 *
 * Optional because two callers have already asked it: `ArgumentSetService`
 * checks its pins at *write*, then re-resolves them at every run, and a set
 * whose pins were checked when it was composed must keep running for anyone
 * the set itself is shared with.
 */
export interface DataGraphAuthScope {
  request: FastifyRequest;
}

export interface ResolvedDataGraph {
  /** RDF text to seed the execution store with. */
  content: string;
  /** Format name for `OxigraphStoreManager.loadDataFromString`. */
  format: string;
  /** Where it came from, for the caller's telemetry and error messages. */
  source: 'version' | 'inline';
  tripleCount: number;
}

/**
 * Resolve the data-graph input on an execute request, or null if there is none.
 *
 * Throws `DataGraphContentError` for anything the caller could have got right —
 * an unknown version id, unparseable inline text, both inputs at once. Routes
 * turn that into a 400.
 *
 * With an `authScope`, throws `AuthorizationError` (403) for a stored graph in
 * a library the caller may not read. Routes let that one through to the error
 * handler rather than flattening it into their 400 or 500: a refusal is
 * neither the caller's malformed body nor a server fault.
 */
export function resolveDataGraphInput(
  request: DataGraphInputRequest,
  authScope?: DataGraphAuthScope,
): ResolvedDataGraph | null {
  /**
   * Read on the library owning a stored graph or one of its versions.
   *
   * Applied to whichever entity the cache just produced, before anything is
   * read off it. An entity whose library does not resolve is refused rather
   * than abstained on, because `requireLibraryMode(null, …)` denies — so
   * neither an id naming nothing nor one whose library has since been deleted
   * is a way through.
   */
  const requireReadable = (entity: unknown): void => {
    if (!authScope) return;
    requireLibraryMode(authScope.request, resolveOwningLibrary(entity), 'read');
  };

  const pinnedId = request.dataGraphVersionId?.trim() || null;
  const graphId = request.dataGraphId?.trim() || null;
  const inline = request.dataGraphInline ?? null;
  const hasInline = typeof inline === 'string' && inline.trim().length > 0;

  const supplied = [pinnedId, graphId, hasInline ? 'inline' : null].filter(Boolean);
  if (supplied.length > 1) {
    throw new DataGraphContentError(
      'Provide exactly one of dataGraphVersionId, dataGraphId or dataGraphInline',
    );
  }

  /*
   * Floating resolves here rather than at the call sites, so every consumer —
   * the execute route, the rule-set routes, the playground, an argument set's
   * graph binding — gets it from one place and cannot disagree about what
   * "current" means.
   */
  let versionId = pinnedId;
  if (graphId) {
    const graph = getCacheCoordinator().get(graphId) as { '@type'?: string; currentVersion?: string } | null;
    if (!graph || graph['@type'] !== 'DataGraph') {
      throw new DataGraphContentError(`Data graph ${graphId} not found`);
    }
    // Before `currentVersion` is read, so an unreadable graph does not answer
    // whether it has one — the version check below would catch the content
    // either way, but not that.
    requireReadable(graph);
    if (!graph.currentVersion) {
      throw new DataGraphContentError(`Data graph ${graphId} has no current version`);
    }
    versionId = graph.currentVersion;
  }

  if (versionId) {
    const version = getCacheCoordinator().get(versionId) as LdkitDataGraphVersion | null;
    if (!version || version['@type'] !== 'DataGraphVersion') {
      throw new DataGraphContentError(`Data graph version ${versionId} not found`);
    }
    // After the existence check, so an id naming nothing is the 404-shaped 400
    // it always was and this speaks only about graphs that exist. The residual
    // signal — 403 rather than 400 says "this IRI is a data graph version
    // somewhere" — is the one `from-query` already carries.
    requireReadable(version);
    const format = (version.contentFormat || DEFAULT_DATA_GRAPH_FORMAT) as DataGraphFormat;
    return {
      content: version.contentString ?? '',
      format: storeManagerFormat(format),
      source: 'version',
      // Recorded at write from the parse, so this costs nothing to read.
      tripleCount: Number(version.tripleCount) || 0,
    };
  }

  if (hasInline) {
    // Inline content is ephemeral but not unchecked: it goes through the same
    // parse and the same per-version cap as anything saved, so `/execute` is
    // not a way around the limits (see `dataGraphContent`).
    const facts = inspectDataGraphContent(
      inline as string,
      request.dataGraphInlineFormat ?? DEFAULT_DATA_GRAPH_FORMAT,
    );
    return {
      content: facts.contentString,
      format: storeManagerFormat(facts.contentFormat),
      source: 'inline',
      tripleCount: facts.tripleCount,
    };
  }

  return null;
}

export { DataGraphContentError };
