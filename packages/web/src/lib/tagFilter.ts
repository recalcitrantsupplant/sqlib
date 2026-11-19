/**
 * The tag filter of a section list: the chosen tags, and whether a row must
 * carry any of them or all of them.
 *
 * The same rule runs on the server (`tag` and `tagMatch` in the API's
 * `lib/listPage.ts`) for the paged sections, and here for the sections that
 * hold their whole list (Tests).
 */
export type TagMatch = 'any' | 'all';

export interface TagFilter {
  tags: string[];
  match: TagMatch;
}

/** Any is the default, so adding a tag widens the list. The server needs `tagMatch=any` for it. */
export const EMPTY_TAG_FILTER: TagFilter = Object.freeze({ tags: [], match: 'any' }) as TagFilter;

export function normalizeTagFilter(value: unknown): TagFilter {
  const raw = (value ?? {}) as { tags?: unknown; match?: unknown };
  const tags = Array.isArray(raw.tags) ? [...new Set(raw.tags.filter((tag): tag is string => typeof tag === 'string' && !!tag))] : [];
  return { tags, match: raw.match === 'all' ? 'all' : 'any' };
}

/** True when a row carrying `carried` passes the filter. An empty filter passes every row. */
export function matchesTagFilter(carried: readonly string[] | null | undefined, filter: TagFilter): boolean {
  if (filter.tags.length === 0) return true;
  const own = carried ?? [];
  return filter.match === 'any'
    ? filter.tags.some((tag) => own.includes(tag))
    : filter.tags.every((tag) => own.includes(tag));
}

/** The list parameters for the filter, or none when it is empty. */
export function tagFilterParams(filter: TagFilter): { tag?: string[]; tagMatch?: TagMatch } {
  if (filter.tags.length === 0) return {};
  return { tag: [...filter.tags], ...(filter.match === 'any' ? { tagMatch: 'any' as const } : {}) };
}
