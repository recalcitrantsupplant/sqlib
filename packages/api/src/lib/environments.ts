/**
 * Environments: named version pointers inside one library.
 *
 * A library may define environments ("dev", "test", "prod", any names its
 * people choose). Each one points to at most one version of each promotable
 * entity — a query, a query group, a rule set. A caller that names an
 * environment runs the version it points to. A caller that names none runs
 * `currentVersion`, which is the implicit environment `latest`.
 *
 * This module is the one place that turns "this entity, in this environment"
 * into a version. Every route that resolves a float goes through
 * `resolveVersionIn`, so `/execute`, MCP, published tools and the export bundle
 * cannot disagree about what "prod" means. See
 * `docs/explanation/environments.md`.
 */
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { resolveOwningLibrary } from '../auth/enforce.js';
import type { PersistedEnvironment } from '../persistence/schemas/EnvironmentSchema.js';
import { ENVIRONMENT_VERSION_TYPES } from '../persistence/schemas/EnvironmentSchema.js';

/** The implicit environment every entity has: its `currentVersion`. */
export const LATEST_ENVIRONMENT = 'latest';

/** The stable entity kinds an environment can point into, by their version kind. */
export const PROMOTABLE_TYPES = {
  Query: 'QueryVersion',
  QueryGroup: 'QueryGroupVersion',
  RuleSet: 'RuleSetVersion',
} as const;

export type PromotableType = keyof typeof PROMOTABLE_TYPES;

type Entity = Record<string, unknown> & { $id: string; '@type'?: string };

export function isPromotableType(type: unknown): type is PromotableType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(PROMOTABLE_TYPES, type);
}

export function isEnvironmentVersionType(type: unknown): boolean {
  return typeof type === 'string' && (ENVIRONMENT_VERSION_TYPES as readonly string[]).includes(type);
}

/** Every environment in the cache. */
function allEnvironments(): PersistedEnvironment[] {
  const cache = getCacheCoordinator() as { list?: (type: never) => unknown };
  // A cache without `list` (a stub in a unit test) holds no environments.
  if (typeof cache.list !== 'function') return [];
  return (cache.list('Environment' as never) as PersistedEnvironment[] | null) ?? [];
}

/** Every environment of a library, in chain order (position, then name). */
export function environmentsOf(libraryIri: string): PersistedEnvironment[] {
  return allEnvironments()
    .filter(env => env.isPartOf === libraryIri)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name));
}

/** A library's environment by its exact name, or null. */
export function findEnvironment(libraryIri: string, name: string): PersistedEnvironment | null {
  return environmentsOf(libraryIri).find(env => env.name === name) ?? null;
}

/** The version of `entityId` that `env` points to, or null. */
export function versionIn(env: Pick<PersistedEnvironment, 'versions'>, entityId: string): string | null {
  const cache = getCacheCoordinator();
  for (const versionId of env.versions ?? []) {
    const version = cache.get(versionId) as Entity | null;
    if (version && version.isPartOf === entityId) return versionId;
  }
  return null;
}

/** The environments that point at `versionId`. */
export function environmentsPointingTo(versionId: string): PersistedEnvironment[] {
  return allEnvironments().filter(env => (env.versions ?? []).includes(versionId));
}

/**
 * The outcome of resolving an entity in an environment.
 *
 * Two refusals are kept apart because a caller must be able to tell them
 * apart: an environment the library does not define is a mistake in the call
 * (400), while an environment the entity has no version in is a fact about the
 * entity (409, "not promoted yet").
 */
export type Resolution =
  | { ok: true; version: string; environment: PersistedEnvironment | null }
  | { ok: false; status: 400 | 409; error: string };

/**
 * The version `entity` resolves to in `environment`.
 *
 * - No environment, or `latest`: the entity's `currentVersion`.
 * - A name the entity's library defines: the version it points to.
 * - A library that defines no environments: `currentVersion`, whatever the
 *   name. Environments are opt-in per library.
 * - A library that defines some, and not this name: refused. A server
 *   configured for "prod" then fails loudly against a library that has
 *   environments but no "prod", rather than quietly running its latest text.
 */
export function resolveVersionIn(entity: Entity, environment: string | null | undefined): Resolution {
  const name = environment?.trim() || null;
  const label = typeof entity.name === 'string' ? `"${entity.name}"` : entity.$id;

  if (!name || name === LATEST_ENVIRONMENT) {
    const current = typeof entity.currentVersion === 'string' ? entity.currentVersion : null;
    if (!current) return { ok: false, status: 409, error: `${label} has no saved version.` };
    return { ok: true, version: current, environment: null };
  }

  const library = resolveOwningLibrary(entity);
  const defined = library ? environmentsOf(library) : [];
  if (defined.length === 0) {
    // A library that defines no environments has only `latest`. A deployment
    // default such as "prod" must not break every such library.
    return resolveVersionIn(entity, null);
  }
  const env = defined.find(candidate => candidate.name === name) ?? null;
  if (!env) {
    return { ok: false, status: 400, error: `The library of ${label} has no environment named "${name}".` };
  }
  const version = versionIn(env, entity.$id);
  if (!version) {
    return { ok: false, status: 409, error: `${label} has no version in "${name}".` };
  }
  return { ok: true, version, environment: env };
}

/**
 * The environment name a request asks for, falling back to the deployment's
 * default (`SQLIB_DEFAULT_ENVIRONMENT`). Null means `latest`.
 */
export function requestedEnvironment(explicit: unknown): string | null {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const fallback = process.env.SQLIB_DEFAULT_ENVIRONMENT?.trim();
  return fallback || null;
}
