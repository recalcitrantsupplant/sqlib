/**
 * The default backend a client offers for a query: a UI convenience.
 *
 * In an environment the order is the environment's `defaultBackend`, then the
 * query's own, then its library's. Outside an environment (`latest`) the order
 * is the query's own, then its library's. The environment comes first because
 * a dev, test and prod chain runs each environment on its own backend: a
 * query's own default would send the prod version to the dev backend. A query
 * version answers for its parent query. `/execute` never runs on it: a run
 * must name its backend, and the refusal names this default as a hint.
 *
 * Query groups do not use this — each node names its own backend.
 */

type EntityGetter = (id: string) => unknown;

/** Finds a library's environment by name; see `findEnvironment` in `environments.ts`. */
export type EnvironmentFinder = (libraryId: string, name: string) => { defaultBackend?: string | null } | null;

export interface ResolvedDefaultBackend {
  backendId: string;
  source: 'environment' | 'query' | 'library';
}

export interface DefaultBackendOptions {
  /** The environment the run resolves in. Null, undefined or `latest` means none. */
  environment?: string | null;
  findEnvironment?: EnvironmentFinder;
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
  options: DefaultBackendOptions = {},
): ResolvedDefaultBackend | null {
  let query: unknown = target;
  if (typeOf(target) === 'QueryVersion') {
    const parentId = stringField(target, 'isPartOf');
    query = parentId ? get(parentId) : null;
  }
  if (typeOf(query) !== 'Query') return null;

  // A query's `isPartOf` holds its library alongside any groups it is in.
  const rawParents = (query as { isPartOf?: unknown }).isPartOf;
  const parents = Array.isArray(rawParents) ? rawParents : [rawParents];
  const library = parents
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => get(id))
    .find((entity) => typeOf(entity) === 'Library');

  const { environment, findEnvironment } = options;
  const libraryId = stringField(library, '$id');
  if (environment && environment !== 'latest' && findEnvironment && libraryId) {
    const environmentDefault = findEnvironment(libraryId, environment)?.defaultBackend;
    if (environmentDefault) return { backendId: environmentDefault, source: 'environment' };
  }

  const queryDefault = stringField(query, 'defaultBackend');
  if (queryDefault) return { backendId: queryDefault, source: 'query' };

  const libraryDefault = stringField(library, 'defaultBackend');
  return libraryDefault ? { backendId: libraryDefault, source: 'library' } : null;
}
