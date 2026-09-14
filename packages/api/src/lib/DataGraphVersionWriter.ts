import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { nextVersionNumber } from './versionNumbering.js';
import type { LdkitDataGraph } from '../persistence/schemas/DataGraphSchema.js';
import type { LdkitDataGraphVersion } from '../persistence/schemas/DataGraphVersionSchema.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import { oxigraphStoreManager } from './OxigraphStoreManager.js';
import {
  DEFAULT_DATA_GRAPH_FORMAT,
  DataGraphContentError,
  MAX_DATA_GRAPH_LIBRARY_BYTES,
  dataGraphByteSize,
  inspectDataGraphContent,
} from './dataGraphContent.js';

type AnyRecord = Record<string, unknown>;

/** Provenance for a version materialized from a query rather than hand-authored (issue #153). */
export interface DataGraphVersionSource {
  queryVersionId: string;
  argumentSetVersionId?: string | null;
  backendId: string;
  executedAt: string;
  resultHash: string;
}

export interface CreateDataGraphVersionInput {
  contentString: string;
  contentFormat?: string | null;
  comment?: string | null;
  immutable?: boolean;
  source?: DataGraphVersionSource;
}

export interface AnnotateDataGraphVersionInput {
  comment?: string | null;
  immutable?: boolean;
}

/**
 * The library a data graph belongs to, or null when it is not resolvable.
 *
 * `isPartOf` is the array-of-exactly-one-Library shape the routes enforce on
 * write; reading the first entry is what every other consumer of that shape
 * does.
 */
function libraryOf(dataGraph: LdkitDataGraph | null): string | null {
  const parents = Array.isArray(dataGraph?.isPartOf) ? dataGraph.isPartOf : [];
  return parents[0] ?? null;
}

/**
 * Total bytes already stored for a library, excluding one version.
 *
 * The exclusion is what makes an *update* chargeable at its new size rather
 * than at old-plus-new: replacing a 900 KB version with a 900 KB version is not
 * 1.8 MB of storage, and without this it would be rejected as though it were.
 */
function libraryBytesInUse(libraryId: string, excludeVersionId?: string): number {
  const cacheCoordinator = getCacheCoordinator();
  const graphsInLibrary = new Set(
    (cacheCoordinator.list('DataGraph') as LdkitDataGraph[])
      .filter(graph => libraryOf(graph) === libraryId)
      .map(graph => graph.$id),
  );

  return (cacheCoordinator.list('DataGraphVersion') as LdkitDataGraphVersion[])
    .filter(version => version.$id !== excludeVersionId && graphsInLibrary.has(version.isPartOf))
    .reduce((total, version) => total + (Number(version.byteSize) || 0), 0);
}

function assertLibraryBudget(dataGraphId: string, incomingBytes: number, excludeVersionId?: string): void {
  const cacheCoordinator = getCacheCoordinator();
  const parent = cacheCoordinator.get(dataGraphId) as LdkitDataGraph | null;
  const libraryId = libraryOf(parent);
  // A data graph with no resolvable library cannot be budgeted against one. The
  // per-version cap has already applied, so this is bounded either way.
  if (!libraryId) return;

  const inUse = libraryBytesInUse(libraryId, excludeVersionId);
  if (inUse + incomingBytes > MAX_DATA_GRAPH_LIBRARY_BYTES) {
    throw new DataGraphContentError(
      `Library data graph storage would reach ${inUse + incomingBytes} bytes, over the ${MAX_DATA_GRAPH_LIBRARY_BYTES}-byte limit`,
    );
  }
}

/**
 * Create the next immutable DataGraphVersion and point the parent at it.
 *
 * Same shape as `createDataBlockVersion`, and deliberately so — the difference
 * between the two entities is what the content *is* (a data graph is the input
 * a ruleset runs against; a data block is part of the ruleset), not how it is
 * versioned.
 */
export async function createDataGraphVersion(
  dataGraphId: string,
  body: CreateDataGraphVersionInput,
): Promise<LdkitDataGraphVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const nextVersion = nextVersionNumber('DataGraphVersion', dataGraphId);

  const facts = inspectDataGraphContent(
    body.contentString ?? '',
    body.contentFormat ?? DEFAULT_DATA_GRAPH_FORMAT,
  );
  assertLibraryBudget(dataGraphId, facts.byteSize);

  const versionId = mintId('dataGraphVersion');
  const payload: AnyRecord = {
    $id: versionId,
    '@type': 'DataGraphVersion',
    isPartOf: dataGraphId,
    version: nextVersion,
    // Frozen on create (issue #192). A version is a snapshot: what it holds is
    // what the reference to it means, so it is never created in a state where
    // it could still change. `immutable` on the request body is ignored rather
    // than honoured — there is no such thing as a mutable version.
    immutable: true,
    contentString: facts.contentString,
    contentFormat: facts.contentFormat,
    tripleCount: facts.tripleCount,
    byteSize: facts.byteSize,
    // Content that did not parse never reaches here — `inspectDataGraphContent`
    // throws — so a stored version is always valid. The field is kept for the
    // uniform version shape and so that a future "save anyway" flag has a
    // place to record itself.
    grammarValid: true,
    comment: body.comment ?? undefined,
    ...(body.source
      ? {
          sourceQueryVersion: body.source.queryVersionId,
          sourceArgumentSetVersion: body.source.argumentSetVersionId ?? undefined,
          sourceBackend: body.source.backendId,
          sourceExecutedAt: body.source.executedAt,
          sourceResultHash: body.source.resultHash,
        }
      : {}),
  };

  const created = await cacheCoordinator.create('DataGraphVersion', toLdkit(payload));

  const updated = await cacheCoordinator.update('DataGraph', dataGraphId, { currentVersion: versionId });
  if (!updated) {
    throw new Error(`Failed to set currentVersion on DataGraph ${dataGraphId}`);
  }

  // This is the entire "kept in sync" mechanism for in-memory Oxigraph backends
  // that track this graph's head: the head just moved, so any store hydrated
  // from it is stale and gets dropped, rebuilding on next use. It is cheap
  // precisely because every data-graph write comes through here — no polling
  // and no diffing. Backends pinned to a version id are untouched by
  // construction, since the version they name has not changed.
  //
  // A failure to invalidate must not fail the save: the version is written
  // and the parent already points at it, so throwing here would report a
  // successful write as an error. The cost of the miss is a store serving the
  // previous version until it is next rebuilt.
  try {
    await oxigraphStoreManager.invalidateStoresTrackingDataGraph(dataGraphId);
  } catch (error) {
    console.error(`Failed to invalidate stores tracking DataGraph ${dataGraphId}:`, error);
  }

  return created;
}

/**
 * Annotate an existing DataGraphVersion.
 *
 * A version is a snapshot (issue #192): its content is what was saved, and
 * every compatibility check that named the version stays true. What is left is
 * the annotation — the comment *about* the snapshot — plus the freeze
 * transition for versions stored before creation started freezing them.
 */
export async function annotateDataGraphVersion(
  versionId: string,
  body: AnnotateDataGraphVersionInput,
): Promise<LdkitDataGraphVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const current = cacheCoordinator.get(versionId) as LdkitDataGraphVersion | null;
  if (!current || current['@type'] !== 'DataGraphVersion') {
    throw new Error(`DataGraphVersion ${versionId} not found`);
  }

  const updates: AnyRecord = {};
  if (body.comment !== undefined) updates.comment = body.comment;
  // Only false → true. Unfreezing would undo the guarantee every reference to
  // the version relies on, and the route rejects it before we get here.
  if (body.immutable === true) updates.immutable = true;

  if (Object.keys(updates).length === 0) return current;

  const updated = await cacheCoordinator.update('DataGraphVersion', versionId, updates);
  if (!updated) {
    throw new Error(`Failed to update DataGraphVersion ${versionId}`);
  }

  return updated;
}

/** Re-exported so routes can turn a content problem into a 400 without importing two modules. */
export { DataGraphContentError, dataGraphByteSize };
