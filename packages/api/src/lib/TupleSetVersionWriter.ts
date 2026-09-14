/**
 * Writing immutable `TupleSetVersion`s.
 *
 * Deliberately the same shape as `DataGraphVersionWriter` — the two entities
 * differ in what the content *is* (RDF a ruleset runs against, versus rows a
 * signature is filled with), not in how it is versioned or budgeted.
 *
 * The one real difference is that content is *normalised* on the way in rather
 * than stored verbatim. `parseTupleContent` interprets a source once, at
 * import, and what it produces is what executes forever after — which is what
 * makes a pinned version id reproducible even as import gains cleverness like
 * type auto-suggestion. See `docs/concepts.md`.
 */

import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { nextVersionNumber } from './versionNumbering.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import { applyColumnTypes, parseTupleContent, TupleContentError } from './tupleContent.js';
import type { SuggestedColumnType } from './tupleContent.js';
import type { LdkitTupleSet } from '../persistence/schemas/TupleSetSchema.js';
import type {
  LdkitTupleSetVersion,
  TupleSourceFormat,
} from '../persistence/schemas/TupleSetVersionSchema.js';

type AnyRecord = Record<string, unknown>;

/**
 * Per-version and per-library ceilings, mirroring the data-graph caps and
 * tunable the same way. A tuple set is reference data for development, not bulk
 * storage; the per-library cap is the one that actually bounds cost, since a
 * thousand capped versions is otherwise a gigabyte.
 */
export const MAX_TUPLE_SET_VERSION_BYTES = Number.parseInt(
  process.env.TUPLE_SET_MAX_VERSION_BYTES ?? '1048576',
  10,
) || 1048576;

export const MAX_TUPLE_SET_LIBRARY_BYTES = Number.parseInt(
  process.env.TUPLE_SET_MAX_LIBRARY_BYTES ?? '16777216',
  10,
) || 16777216;

/**
 * What produced a version whose rows were computed rather than uploaded
 * (issue #211). Recorded on the snapshot, never followed — the mapping version
 * is part of it because the mapping, not the SQL alone, decides the columns.
 */
export interface TupleSetVersionEtlSource {
  etlJobVersionId: string;
  columnMappingVersionId: string;
  executedAt: string;
  resultHash: string;
}

export interface CreateTupleSetVersionInput {
  contentString: string;
  sourceFormat: TupleSourceFormat;
  comment?: string | null;
  immutable?: boolean;
  /**
   * Column-type suggestions the author accepted (issue #208). Applied after
   * parsing and before anything is persisted, so the stored outcome — not the
   * source bytes plus a promise to reinterpret them — is what a pinned
   * version means forever.
   */
  columnTypes?: Record<string, SuggestedColumnType>;
  /** Set when the rows were computed — see `tupleSetFromEtl.ts`. */
  source?: TupleSetVersionEtlSource;
}

export interface AnnotateTupleSetVersionInput {
  comment?: string | null;
  immutable?: boolean;
}

function libraryOf(tupleSet: LdkitTupleSet | null): string | null {
  const parents = Array.isArray(tupleSet?.isPartOf) ? tupleSet.isPartOf : [];
  return parents[0] ?? null;
}

/** Bytes already stored for a library, excluding one version — see the data-graph twin. */
function libraryBytesInUse(libraryId: string, excludeVersionId?: string): number {
  const cacheCoordinator = getCacheCoordinator();
  const setsInLibrary = new Set(
    (cacheCoordinator.list('TupleSet') as LdkitTupleSet[])
      .filter(set => libraryOf(set) === libraryId)
      .map(set => set.$id),
  );

  return (cacheCoordinator.list('TupleSetVersion') as LdkitTupleSetVersion[])
    .filter(version => version.$id !== excludeVersionId && setsInLibrary.has(version.isPartOf))
    .reduce((total, version) => total + (Number(version.byteSize) || 0), 0);
}

function assertBudget(tupleSetId: string, incomingBytes: number, excludeVersionId?: string): void {
  if (incomingBytes > MAX_TUPLE_SET_VERSION_BYTES) {
    throw new TupleContentError(
      `Tuple set content is ${incomingBytes} bytes, over the ${MAX_TUPLE_SET_VERSION_BYTES}-byte limit for one version`,
    );
  }

  const parent = getCacheCoordinator().get(tupleSetId) as LdkitTupleSet | null;
  const libraryId = libraryOf(parent);
  // Unresolvable library: the per-version cap has already applied, so this is
  // bounded either way.
  if (!libraryId) return;

  const inUse = libraryBytesInUse(libraryId, excludeVersionId);
  if (inUse + incomingBytes > MAX_TUPLE_SET_LIBRARY_BYTES) {
    throw new TupleContentError(
      `Library tuple set storage would reach ${inUse + incomingBytes} bytes, over the ${MAX_TUPLE_SET_LIBRARY_BYTES}-byte limit`,
    );
  }
}

export async function createTupleSetVersion(
  tupleSetId: string,
  body: CreateTupleSetVersionInput,
): Promise<LdkitTupleSetVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const nextVersion = nextVersionNumber('TupleSetVersion', tupleSetId);

  let parsed = parseTupleContent(body.contentString ?? '', body.sourceFormat);
  if (body.columnTypes && Object.keys(body.columnTypes).length > 0) {
    parsed = applyColumnTypes(parsed, body.columnTypes);
  }
  assertBudget(tupleSetId, parsed.byteSize);

  const versionId = mintId('tupleSetVersion');
  const payload: AnyRecord = {
    $id: versionId,
    '@type': 'TupleSetVersion',
    isPartOf: tupleSetId,
    version: nextVersion,
    // Frozen on create (issue #192). A version is a snapshot: what it holds is
    // what the reference to it means, so it is never created in a state where
    // it could still change. `immutable` on the request body is ignored rather
    // than honoured — there is no such thing as a mutable version.
    immutable: true,
    // The normalised document, never the source bytes.
    contentString: parsed.contentString,
    sourceFormat: body.sourceFormat,
    tupleColumns: parsed.columns,
    rowCount: parsed.rowCount,
    byteSize: parsed.byteSize,
    comment: body.comment ?? undefined,
    ...(body.source
      ? {
          sourceEtlJobVersion: body.source.etlJobVersionId,
          sourceColumnMappingVersion: body.source.columnMappingVersionId,
          sourceExecutedAt: body.source.executedAt,
          sourceResultHash: body.source.resultHash,
        }
      : {}),
  };

  const created = await cacheCoordinator.create('TupleSetVersion', toLdkit(payload));

  const updated = await cacheCoordinator.update('TupleSet', tupleSetId, { currentVersion: versionId });
  if (!updated) {
    throw new Error(`Failed to set currentVersion on TupleSet ${tupleSetId}`);
  }

  return created;
}

/**
 * Annotate an existing TupleSetVersion.
 *
 * A version is a snapshot (issue #192): its content is what was saved, and
 * every compatibility check that named the version stays true. What is left is
 * the annotation — the comment *about* the snapshot — plus the freeze
 * transition for versions stored before creation started freezing them.
 */
export async function annotateTupleSetVersion(
  versionId: string,
  body: AnnotateTupleSetVersionInput,
): Promise<LdkitTupleSetVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const current = cacheCoordinator.get(versionId) as LdkitTupleSetVersion | null;
  if (!current || current['@type'] !== 'TupleSetVersion') {
    throw new Error(`TupleSetVersion ${versionId} not found`);
  }

  const updates: AnyRecord = {};
  if (body.comment !== undefined) updates.comment = body.comment;
  // Only false → true. Unfreezing would undo the guarantee every reference to
  // the version relies on, and the route rejects it before we get here.
  if (body.immutable === true) updates.immutable = true;

  if (Object.keys(updates).length === 0) return current;

  const updated = await cacheCoordinator.update('TupleSetVersion', versionId, updates);
  if (!updated) {
    throw new Error(`Failed to update TupleSetVersion ${versionId}`);
  }

  return updated;
}
