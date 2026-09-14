/**
 * Hydrating an in-process Oxigraph store from library data graphs.
 *
 * This is the seam that makes `oxigraphMemory` backends worth having: instead
 * of pointing a store at a file path on the server, a backend names data graphs
 * that already live in the library — versioned, access-controlled, and
 * parse-validated at write against this very engine (`dataGraphContent`).
 *
 * Two kinds of reference, and the difference is the whole sync story:
 *
 * - **Pinned** (`dataGraphVersionId`). Version content is immutable, so
 *   rehydration is exact and reproducible by construction. There is nothing to
 *   keep in sync — this is the mode with no hard problems in it.
 * - **Tracked** (`dataGraphId`). Resolved to the graph's `currentVersion` at
 *   load. Keeping up is cheap rather than hard, because every data-graph write
 *   goes through our own API: saving a version invalidates the stores that
 *   track it, and the next use rebuilds. No polling, no diffing.
 *
 * Hydration is one-directional. Nothing here ever writes back to a data graph:
 * the per-version cap and the versioning model make data graphs the wrong home
 * for mutable bulk data, and write-back would mean inventing conflict
 * resolution for no payoff.
 */

import * as oxigraph from 'oxigraph';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { markStoreWritten } from './storeWrites.js';
import type { LdkitDataGraph } from '../persistence/schemas/DataGraphSchema.js';
import type { LdkitDataGraphVersion } from '../persistence/schemas/DataGraphVersionSchema.js';
import type { OxigraphDataGraphSource } from '../persistence/schemas/BackendSchema.js';
import {
  DEFAULT_DATA_GRAPH_FORMAT,
  DataGraphContentError,
  type DataGraphFormat,
} from './dataGraphContent.js';

/** One resolved source, ready to load. */
export interface ResolvedDataGraphSource {
  /** RDF text. */
  content: string;
  /**
   * The content's media type, passed straight to `oxigraph.Store.load`.
   *
   * The MIME type rather than a short token or the store manager's own format
   * names: `load` accepts media types directly (as `SystemStoreLoader` relies
   * on), and a data graph version already records one, so there is no
   * translation step to get wrong.
   */
  format: DataGraphFormat;
  /** The version actually resolved — for pinned sources, the one named. */
  versionId: string;
  /** Set only for tracked sources, so invalidation knows what to watch. */
  dataGraphId?: string;
  /** Whether this source follows the graph's head. */
  tracked: boolean;
  tripleCount: number;
  namedGraph?: string;
}

export interface HydrationResult {
  sources: ResolvedDataGraphSource[];
  /** Total quads loaded, counted from the store rather than claimed. */
  quadsLoaded: number;
  /** Data graph ids whose head this store follows. Empty when fully pinned. */
  trackedDataGraphIds: string[];
}

/**
 * Validate a source reference and say which kind it is.
 *
 * Rejecting "both ids" rather than picking one is deliberate: the two mean
 * different sync behaviours, so a config that asks for both is a config whose
 * author did not decide, and guessing on their behalf would bake in the wrong
 * answer silently.
 */
export function classifyDataGraphSource(source: OxigraphDataGraphSource): {
  tracked: boolean;
  id: string;
} {
  const versionId = source.dataGraphVersionId?.trim() || null;
  const graphId = source.dataGraphId?.trim() || null;

  if (versionId && graphId) {
    throw new DataGraphContentError(
      'Provide either dataGraphVersionId (pinned) or dataGraphId (tracked) for a source, not both',
    );
  }
  if (!versionId && !graphId) {
    throw new DataGraphContentError(
      'Each oxigraph source requires either dataGraphVersionId or dataGraphId',
    );
  }

  return versionId ? { tracked: false, id: versionId } : { tracked: true, id: graphId as string };
}

function loadVersion(versionId: string): LdkitDataGraphVersion {
  const version = getCacheCoordinator().get(versionId) as LdkitDataGraphVersion | null;
  if (!version || version['@type'] !== 'DataGraphVersion') {
    throw new DataGraphContentError(`Data graph version ${versionId} not found`);
  }
  return version;
}

/**
 * Resolve one source reference to its content.
 *
 * A tracked graph with no `currentVersion` is an error rather than an empty
 * load: a store configured to follow a graph that has never been saved is
 * a config mistake, and silently hydrating nothing would present it as an
 * empty dataset instead.
 */
export function resolveDataGraphSource(source: OxigraphDataGraphSource): ResolvedDataGraphSource {
  const { tracked, id } = classifyDataGraphSource(source);

  let versionId = id;
  let dataGraphId: string | undefined;

  if (tracked) {
    const graph = getCacheCoordinator().get(id) as LdkitDataGraph | null;
    if (!graph || graph['@type'] !== 'DataGraph') {
      throw new DataGraphContentError(`Data graph ${id} not found`);
    }
    const head = graph.currentVersion?.trim();
    if (!head) {
      throw new DataGraphContentError(`Data graph ${id} has no saved version to track`);
    }
    versionId = head;
    dataGraphId = id;
  }

  const version = loadVersion(versionId);
  const format = (version.contentFormat || DEFAULT_DATA_GRAPH_FORMAT) as DataGraphFormat;

  return {
    content: version.contentString ?? '',
    format,
    versionId,
    dataGraphId,
    tracked,
    // Recorded at write from the parse, so reading it costs nothing.
    tripleCount: Number(version.tripleCount) || 0,
    namedGraph: source.namedGraph?.trim() || undefined,
  };
}

/**
 * Load every configured source into `store`, in order.
 *
 * The store is not cleared first — callers hydrate a store they just created,
 * and clearing one that already holds data is the caller's decision to make
 * (a durable store's whole point is that its disk state survives).
 */
export function hydrateStoreFromDataGraphs(
  store: oxigraph.Store,
  sources: OxigraphDataGraphSource[] | undefined,
): HydrationResult {
  const resolved: ResolvedDataGraphSource[] = [];
  const tracked = new Set<string>();

  const before = store.size;

  for (const source of sources ?? []) {
    const entry = resolveDataGraphSource(source);
    if (entry.content.trim()) {
      const options: { format: string; to_graph_name?: oxigraph.NamedNode } = { format: entry.format };
      if (entry.namedGraph) {
        options.to_graph_name = oxigraph.namedNode(entry.namedGraph);
      }
      store.load(entry.content, options);
      // A hydrated store differs from whatever snapshot it has on disk, so the
      // next periodic checkpoint has to write rather than skip (#443).
      markStoreWritten(store);
    }
    resolved.push(entry);
    if (entry.dataGraphId) tracked.add(entry.dataGraphId);
  }

  return {
    sources: resolved,
    quadsLoaded: store.size - before,
    trackedDataGraphIds: Array.from(tracked),
  };
}

/**
 * The data graph ids a config follows, without loading any content.
 *
 * Used to register invalidation interest before hydration, so a save that
 * lands mid-hydration is not missed.
 */
export function trackedDataGraphIds(sources: OxigraphDataGraphSource[] | undefined): string[] {
  const ids = new Set<string>();
  for (const source of sources ?? []) {
    const graphId = source.dataGraphId?.trim();
    if (graphId && !source.dataGraphVersionId?.trim()) {
      ids.add(graphId);
    }
  }
  return Array.from(ids);
}

export { DataGraphContentError };
