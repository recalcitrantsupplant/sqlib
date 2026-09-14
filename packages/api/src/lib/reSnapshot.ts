/**
 * "This run produced what the last one produced."
 *
 * Both materializing sinks — `/data-graphs/:id/versions/from-query` (#153) and
 * `/tuple-sets/:id/versions/from-etl` (#211) — record a `sourceResultHash`
 * beside the source that produced the content. Until now nothing read it: the
 * field described a snapshot without ever being used to decide whether that
 * snapshot was worth taking, so a caller that ran the same job twice got two
 * versions holding the same bytes, and #211's third point — "a pipeline that
 * runs on a schedule would cut a version per run" — was a budget question with
 * no mechanism to answer it.
 *
 * This is the mechanism. A re-snapshot is *unchanged* when the parent's current
 * version was produced by the same source and hashed the same, and an unchanged
 * re-snapshot is not a new version: the sink returns the version that already
 * says it.
 *
 * Three things the rule deliberately does:
 *
 * **It compares the current version only, not every version.** The chain is a
 * history of the head. Content that changed and changed back is two real
 * transitions, and reusing the older match would move `currentVersion`
 * backwards — a head that goes down is not a history.
 *
 * **It requires the source to match, not only the hash.** `sourceResultHash`
 * says what the content hashed to; the fields beside it say what produced it.
 * The same rows arriving from a different job version are the same bytes making
 * a different claim, and a pin that named the older version would attribute
 * them to a source that did not produce them.
 *
 * **It requires a hash on both sides.** A version with no recorded hash — a
 * hand-authored one, or one written before its sink recorded provenance —
 * matches nothing, so absence never reads as agreement.
 */

import { getCacheCoordinator } from './CacheCoordinatorProvider.js';

/**
 * The provenance fields that have to agree, as they are spelled *on the stored
 * version*. Each sink passes its own set: the query/argument-set/backend triple
 * for a data graph, the job/mapping pair for a tuple set.
 *
 * `null` and `undefined` mean the same thing here — the field is absent — which
 * is what lets an optional source (`sourceArgumentSetVersion`) compare equal
 * whether the writer stored it as absent or the caller passed it as null.
 */
export type SnapshotSource = Record<string, string | null | undefined>;

/** Absent is one value, however it was spelled. */
function sameField(stored: unknown, expected: string | null | undefined): boolean {
  const left = stored === undefined || stored === null || stored === '' ? null : stored;
  const right = expected === undefined || expected === null || expected === '' ? null : expected;
  return left === right;
}

/**
 * The parent's current version, if it has one and it is really a version of
 * this parent.
 *
 * `isPartOf` is checked rather than trusted: a `currentVersion` pointing
 * somewhere else is a corruption, and the safe reading of a corrupt pointer is
 * "no comparable version", which cuts a new one.
 */
export function currentVersionOfParent<T extends Record<string, unknown>>(
  parentId: string,
  versionType: string,
): T | null {
  const cacheCoordinator = getCacheCoordinator();
  const parent = cacheCoordinator.get(parentId) as { currentVersion?: string | null } | null;
  const currentId = parent?.currentVersion;
  if (!currentId) return null;

  const version = cacheCoordinator.get(currentId) as T | null;
  if (!version || version['@type'] !== versionType) return null;
  if (version.isPartOf !== parentId) return null;
  return version;
}

/**
 * Whether `current` already holds exactly what this run produced, from exactly
 * the source this run named.
 */
export function isUnchangedReSnapshot(
  current: Record<string, unknown> | null,
  resultHash: string,
  source: SnapshotSource,
): boolean {
  if (!current) return false;

  const storedHash = current.sourceResultHash;
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false;
  if (!resultHash || storedHash !== resultHash) return false;

  return Object.entries(source).every(([field, value]) => sameField(current[field], value));
}
