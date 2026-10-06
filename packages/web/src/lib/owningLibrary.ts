/**
 * The library a saved record belongs to, read from the record itself.
 *
 * A record's id is a global IRI, and the record names its container in
 * `isPartOf`. So a link to `/<section>/<id>` already says which library it is
 * in, and a `?library=` beside it could only repeat that or contradict it. The
 * workspace uses this to point the active library at the record a link opened,
 * rather than leaving the list beside it showing whatever library this browser
 * last had open.
 *
 * Mirrors `resolveOwningLibrary` in the API's `auth/enforce.ts`, which is what
 * decides access: `Query.isPartOf` may name query groups beside its library,
 * and a query reached only through a group belongs to the group's library.
 */
export interface OwnedEntity {
  isPartOf?: string | string[] | null;
}

export interface OwningLibraryLookup {
  /** True for the id of a library this browser knows. */
  isLibrary: (id: string) => boolean;
  /** The loaded entity with this id, to follow a group hop through. */
  entityById: (id: string) => OwnedEntity | null | undefined;
}

function containerRefs(entity: OwnedEntity): string[] {
  const raw = entity.isPartOf;
  const refs = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
}

export function owningLibrary(
  entity: OwnedEntity | null | undefined,
  lookup: OwningLibraryLookup,
  depth = 0,
): string | null {
  // Depth-bounded so a cyclic isPartOf cannot spin.
  if (!entity || depth > 4) return null;
  const refs = containerRefs(entity);
  const direct = refs.find((ref) => lookup.isLibrary(ref));
  if (direct) return direct;
  for (const ref of refs) {
    const resolved = owningLibrary(lookup.entityById(ref), lookup, depth + 1);
    if (resolved) return resolved;
  }
  return null;
}
