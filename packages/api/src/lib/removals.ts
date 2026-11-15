/**
 * Which deletes leave a `Removal` record, for the library Activity feed.
 *
 * A record is written when all of these hold:
 *
 * - The delete runs in a request. A delete outside one is sqlib's own
 *   (startup, a cleanup job), and nobody made it.
 * - The request is a `DELETE` whose `:id` is the deleted entity. A route that
 *   deletes an entity's versions, its pointer moves or a group's parts on the
 *   way deletes those as part of the one delete the caller asked for, and
 *   only that one is recorded.
 * - The entity is one of the kinds a library lists (`REMOVAL_KINDS`), and it
 *   belongs to a library. A library delete writes none: its own feed goes
 *   with it.
 */
import type { EntityTypeName } from '../persistence/entityTypeNames.js';

export const REMOVAL_KINDS: ReadonlySet<EntityTypeName> = new Set<EntityTypeName>([
  'Query',
  'QueryGroup',
  'RuleSet',
  'Rule',
  'DataBlock',
  'DataGraph',
  'TupleSet',
  'ArgumentSet',
  'Test',
  'EtlJob',
  'Notebook',
  'BenchmarkExperiment',
  'Tag',
  'Environment',
]);

type Entity = Record<string, unknown> & { $id?: string; '@type'?: unknown };

/**
 * The library an entity belongs to, following `isPartOf` up to four levels.
 * The same walk as `resolveOwningLibrary` in `auth/enforce.ts`, over a lookup
 * the caller passes, so the coordinator can use it without importing auth.
 */
export function libraryOf(entity: Entity | null, get: (id: string) => Entity | null, depth = 0): string | null {
  if (!entity || depth > 4) return null;
  if (entity['@type'] === 'Library' && typeof entity.$id === 'string') return entity.$id;
  const raw = entity.isPartOf;
  const parents = (Array.isArray(raw) ? raw : [raw]).filter((id): id is string => typeof id === 'string' && id.length > 0);
  for (const parent of parents) {
    if (get(parent)?.['@type'] === 'Library') return parent;
  }
  for (const parent of parents) {
    const found = libraryOf(get(parent), get, depth + 1);
    if (found) return found;
  }
  return null;
}
