/**
 * Types whose instances are snapshots from the moment they exist: every
 * version type, and a test version's cases, which are part of what the
 * version means. Frozen by type, not by the stored `immutable` flag — the flag
 * was missing on versions written before creation started setting it, on
 * every argument set version, and on ETL column mapping versions, and a guard
 * reading it let all of those be rewritten in place.
 */
const FROZEN_TYPES = new Set([
  'QueryVersion',
  'QueryGroupVersion',
  'RuleVersion',
  'DataBlockVersion',
  'RuleSetVersion',
  'DataGraphVersion',
  'TestVersion',
  'TupleSetVersion',
  'ArgumentSetVersion',
  'EtlJobVersion',
  'EtlColumnMappingVersion',
  'TestCase',
  'TestCaseDataGraph',
]);

/**
 * Versions that start as editable drafts and are frozen on request, so the
 * stored flag is the state rather than a hint. A benchmark experiment version
 * is configured, tried and then frozen (`BenchmarkExperimentService.updateVersion`).
 */
const FROZEN_BY_FLAG_TYPES = new Set(['BenchmarkExperimentVersion']);

/**
 * Pointers a frozen type may still move, because they say what has been
 * attached to the snapshot since rather than what the snapshot is: a column
 * mapping is created for an ETL job version after the version exists.
 */
const MOVABLE_POINTERS: Record<string, ReadonlySet<string>> = {
  EtlJobVersion: new Set(['currentColumnMappingVersion']),
};

export class ImmutableEntityError extends Error {
  /** A conflict with the stored state, not a malformed request: routes answer 409. */
  readonly statusCode = 409;

  constructor(entityType: string, id?: string) {
    const target = id ? `${entityType} ${id}` : entityType;
    super(`${target} is immutable and cannot be updated. Create a new version instead.`);
    this.name = 'ImmutableEntityError';
  }
}

export function isImmutableType(entityType: string): boolean {
  return FROZEN_TYPES.has(entityType) || FROZEN_BY_FLAG_TYPES.has(entityType);
}

function isFrozen(entityType: string, entity: Record<string, unknown>): boolean {
  if (FROZEN_TYPES.has(entityType)) return true;
  return FROZEN_BY_FLAG_TYPES.has(entityType) && entity.immutable === true;
}

/**
 * Refuse a write that would edit a frozen version.
 *
 * `updates` is what makes this a rule about *content* rather than about the
 * entity: a frozen version still accepts its annotations — the comment about
 * the snapshot, and the freeze transition itself — because neither is part of
 * what a reference to the version means (issue #192, and `lib/versionPatch.ts`
 * for where the same allowlist is applied at the route edge). Called without
 * `updates`, the guard refuses any write.
 */
export function assertMutableEntity(
  entityType: string,
  entity: Record<string, unknown> | null,
  updates?: Record<string, unknown>
): void {
  if (!entity || !isFrozen(entityType, entity)) return;
  if (updates && isAnnotationOnly(entityType, updates)) return;
  throw new ImmutableEntityError(entityType, entity['$id'] as string | undefined);
}

/** `dateModified` rides along on every write, so it is not evidence of a content change. */
const WRITE_METADATA_KEYS = new Set(['dateModified']);

function isAnnotationOnly(entityType: string, updates: Record<string, unknown>): boolean {
  const movable = MOVABLE_POINTERS[entityType];
  const keys = Object.keys(updates).filter(
    (key) => updates[key] !== undefined && !WRITE_METADATA_KEYS.has(key)
  );
  if (keys.length === 0) return true;
  return keys.every(
    (key) =>
      key === 'comment' ||
      (key === 'immutable' && updates[key] === true) ||
      (movable?.has(key) ?? false)
  );
}
