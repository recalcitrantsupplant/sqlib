/**
 * Selecting which of a library's queries an export covers.
 *
 * Kept apart from both the route and the CLI because they need the same answer
 * from different starting points — a request's repositories, or a script's cache —
 * and apart from `buildExportBundle` because selection is about entities while
 * compilation is about query text.
 */

import type { PersistedQuery } from '../../persistence/schemas/QuerySchema.js';
import type { PersistedQueryVersion } from '../../persistence/schemas/QueryVersionSchema.js';
import type { ExportQueryInput } from './queryBundle.js';
import { slotPoliciesOf } from '../slotPolicies.js';

/** The `inputPolicies` field for an export input, or nothing when it has none. */
export function inputPoliciesOf(
  version: PersistedQueryVersion,
  getEntity: ((id: string) => unknown) | undefined,
): Pick<ExportQueryInput, 'inputPolicies'> {
  if (!getEntity) return {};
  const inputPolicies = slotPoliciesOf(version, getEntity);
  return inputPolicies.length > 0 ? { inputPolicies } : {};
}

/** The entity reads this module needs, so a script can supply them too. */
export interface LibraryQuerySource {
  listQueries(): PersistedQuery[];
  getQueryVersion(id: string): PersistedQueryVersion | null;
  /**
   * Any entity by IRI, for the version's input tuples and their `whenEmpty`.
   * Without it the export carries no slot policies.
   */
  getEntity?(id: string): unknown;
}

export interface CollectOptions {
  /** Tag IRIs to filter by. Empty means "every query in the library". */
  tags?: readonly string[];
  /** `any` (the default) keeps a query carrying any listed tag; `all` requires all. */
  match?: 'any' | 'all';
  /**
   * Export one environment's versions in place of each entity's current one
   * (`docs/explanation/environments.md`). An entity the environment has no
   * version of is skipped and reported.
   */
  environment?: ExportEnvironment;
}

/** An environment as an export sees it: a name, and its pointer per entity. */
export interface ExportEnvironment {
  name: string;
  versionOf(entityId: string): string | null;
}

/**
 * The version an export carries for an entity: its current one, or the one an
 * environment points to. A string is the reason it carries none.
 */
export function exportVersionOf(
  entity: { $id: string; currentVersion?: string | null },
  environment: ExportEnvironment | undefined,
  kind: string,
): { versionId: string } | { reason: string } {
  if (environment) {
    const versionId = environment.versionOf(entity.$id);
    return versionId ? { versionId } : { reason: `The ${kind} has no version in "${environment.name}".` };
  }
  return entity.currentVersion ? { versionId: entity.currentVersion } : { reason: `The ${kind} has no current version.` };
}

/** A query the export could not include, and why — reported, never swallowed. */
export interface SkippedQuery {
  id: string;
  name: string;
  reason: string;
}

export interface CollectedQueries {
  queries: ExportQueryInput[];
  skipped: SkippedQuery[];
}

function matchesTags(query: PersistedQuery, tags: readonly string[], match: 'any' | 'all'): boolean {
  if (tags.length === 0) return true;
  const carried = query.tags ?? [];
  return match === 'all'
    ? tags.every((tag) => carried.includes(tag))
    : tags.some((tag) => carried.includes(tag));
}

/**
 * Resolve a library's queries to the text an export should compile.
 *
 * A query with no current version, or whose pointer dangles, is *skipped rather
 * than fatal*: a draft in the corner of a library should not stop the rest being
 * exported. Every skip is returned so the caller can say so — an export that
 * quietly covers less than it appears to is worse than one that refuses.
 */
export function collectLibraryQueries(
  source: LibraryQuerySource,
  libraryId: string,
  options: CollectOptions = {},
): CollectedQueries {
  const tags = options.tags ?? [];
  const match = options.match ?? 'any';

  const queries: ExportQueryInput[] = [];
  const skipped: SkippedQuery[] = [];

  const members = source
    .listQueries()
    // `Query.isPartOf` is an array — a query may sit in a group as well as a library.
    .filter((query) => query.isPartOf?.includes(libraryId))
    .filter((query) => matchesTags(query, tags, match));

  for (const query of members) {
    const name = query.name ?? query.$id;
    const picked = exportVersionOf(query, options.environment, 'query');
    if ('reason' in picked) {
      skipped.push({ id: query.$id, name, reason: picked.reason });
      continue;
    }
    const version = source.getQueryVersion(picked.versionId);
    if (!version) {
      skipped.push({
        id: query.$id,
        name,
        reason: `Its version ${picked.versionId} could not be found.`,
      });
      continue;
    }
    if (!version.queryString) {
      skipped.push({ id: query.$id, name, reason: 'Its current version has no query text.' });
      continue;
    }

    queries.push({
      name,
      queryString: version.queryString,
      sourceQuery: query.$id,
      sourceVersion: version.$id,
      ...(query.tags && query.tags.length > 0 ? { tags: [...query.tags] } : {}),
      ...(query.description ? { description: query.description } : {}),
      ...inputPoliciesOf(version, source.getEntity),
    });
  }

  // Stable output regardless of store iteration order, so re-exporting an
  // unchanged library produces a byte-identical bundle and a clean diff.
  queries.sort((a, b) => a.name.localeCompare(b.name));
  skipped.sort((a, b) => a.name.localeCompare(b.name));

  return { queries, skipped };
}
