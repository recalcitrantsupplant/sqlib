/**
 * Selecting which of a library's queries an export covers.
 *
 * Kept apart from both the route and the CLI because they need the same answer
 * from different starting points — a request's repositories, or a script's cache —
 * and apart from `buildExportBundle` because selection is about entities while
 * compilation is about query text.
 */

import type { LdkitQuery } from '../../persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../../persistence/schemas/QueryVersionSchema.js';
import type { ExportQueryInput } from './queryBundle.js';

/** The entity reads this module needs, so a script can supply them too. */
export interface LibraryQuerySource {
  listQueries(): LdkitQuery[];
  getQueryVersion(id: string): LdkitQueryVersion | null;
}

export interface CollectOptions {
  /** Tag IRIs to filter by. Empty means "every query in the library". */
  tags?: readonly string[];
  /** `any` (the default) keeps a query carrying any listed tag; `all` requires all. */
  match?: 'any' | 'all';
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

function matchesTags(query: LdkitQuery, tags: readonly string[], match: 'any' | 'all'): boolean {
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
    if (!query.currentVersion) {
      skipped.push({ id: query.$id, name, reason: 'The query has no current version.' });
      continue;
    }
    const version = source.getQueryVersion(query.currentVersion);
    if (!version) {
      skipped.push({
        id: query.$id,
        name,
        reason: `Its current version ${query.currentVersion} could not be found.`,
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
    });
  }

  // Stable output regardless of store iteration order, so re-exporting an
  // unchanged library produces a byte-identical bundle and a clean diff.
  queries.sort((a, b) => a.name.localeCompare(b.name));
  skipped.sort((a, b) => a.name.localeCompare(b.name));

  return { queries, skipped };
}
