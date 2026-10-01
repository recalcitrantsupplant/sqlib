/**
 * Which backend a query runs on when the caller names none.
 *
 * The order is the query's own `defaultBackend`, then its library's. A query
 * version answers for its parent query. Nothing past the library is assumed:
 * a run with no backend and no default is refused rather than sent to the
 * in-memory store, because results from the wrong store look like real ones.
 *
 * Query groups do not use this — each node names its own backend.
 */

type EntityGetter = (id: string) => unknown;

export interface ResolvedDefaultBackend {
  backendId: string;
  source: 'query' | 'library';
}

function stringField(entity: unknown, field: string): string | undefined {
  if (!entity || typeof entity !== 'object') return undefined;
  const value = (entity as Record<string, unknown>)[field];
  return typeof value === 'string' && value ? value : undefined;
}

function typeOf(entity: unknown): string | undefined {
  return stringField(entity, '@type');
}

/**
 * Resolve the default backend for a Query or QueryVersion target.
 * Returns null when neither the query nor its library names one.
 */
export function resolveQueryDefaultBackend(
  target: unknown,
  get: EntityGetter,
): ResolvedDefaultBackend | null {
  let query: unknown = target;
  if (typeOf(target) === 'QueryVersion') {
    const parentId = stringField(target, 'isPartOf');
    query = parentId ? get(parentId) : null;
  }
  if (typeOf(query) !== 'Query') return null;

  const queryDefault = stringField(query, 'defaultBackend');
  if (queryDefault) return { backendId: queryDefault, source: 'query' };

  // A query's `isPartOf` holds its library alongside any groups it is in.
  const rawParents = (query as { isPartOf?: unknown }).isPartOf;
  const parents = Array.isArray(rawParents) ? rawParents : [rawParents];
  const library = parents
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => get(id))
    .find((entity) => typeOf(entity) === 'Library');
  const libraryDefault = stringField(library, 'defaultBackend');
  return libraryDefault ? { backendId: libraryDefault, source: 'library' } : null;
}
