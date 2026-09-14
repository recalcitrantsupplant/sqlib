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

import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
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
 */
export function resolveDataGraphInput(request: DataGraphInputRequest): ResolvedDataGraph | null {
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
