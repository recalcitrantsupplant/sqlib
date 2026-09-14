const IMMUTABLE_VERSION_TYPES = new Set([
  'QueryVersion',
  'QueryGroupVersion',
  'RuleVersion',
  'DataBlockVersion',
  'RuleSetVersion',
  'BenchmarkExperimentVersion',
  'DataGraphVersion',
  'TestVersion',
]);

export class ImmutableEntityError extends Error {
  constructor(entityType: string, id?: string) {
    const target = id ? `${entityType} ${id}` : entityType;
    super(`${target} is immutable and cannot be updated. Create a new version instead.`);
    this.name = 'ImmutableEntityError';
  }
}

export function isImmutableType(entityType: string): boolean {
  return IMMUTABLE_VERSION_TYPES.has(entityType);
}

/**
 * Refuse a write that would edit a frozen version.
 *
 * `updates` is what makes this a rule about *content* rather than about the
 * entity: a frozen version still accepts its annotations — the comment about
 * the snapshot, and the freeze transition itself — because neither is part of
 * what a reference to the version means (issue #192, and `lib/versionPatch.ts`
 * for where the same allowlist is applied at the route edge). Called without
 * `updates`, the guard stays as strict as it was.
 */
export function assertMutableEntity(
  entityType: string,
  entity: Record<string, unknown> | null,
  updates?: Record<string, unknown>
): void {
  if (!entity || !isImmutableType(entityType)) return;
  if (entity.immutable !== true) return;
  if (updates && isAnnotationOnly(updates)) return;
  throw new ImmutableEntityError(entityType, entity['$id'] as string | undefined);
}

/** `dateModified` rides along on every write, so it is not evidence of a content change. */
const WRITE_METADATA_KEYS = new Set(['dateModified']);

function isAnnotationOnly(updates: Record<string, unknown>): boolean {
  const keys = Object.keys(updates).filter(
    (key) => updates[key] !== undefined && !WRITE_METADATA_KEYS.has(key)
  );
  if (keys.length === 0) return true;
  return keys.every((key) => key === 'comment' || (key === 'immutable' && updates[key] === true));
}
