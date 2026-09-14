import fuzzysort from 'fuzzysort';

/**
 * Fuzzy filtering for choosers, on fuzzysort.
 *
 * One wrapper rather than fuzzysort calls scattered through components, so the
 * knobs are set once: every character of the query must appear in order but
 * not adjacently ("qgrp" finds "query-group"), any match survives however weak
 * (`threshold: 0` — a chooser that silently hides a row it half-matched reads
 * as data loss), and nothing is truncated (`limit: 0` — fuzzysort's default of
 * ten would cap a dropdown at ten visible options). Results come back
 * best-first, which is the point of fuzzy over substring: "set" ranks
 * "settings" above "rule-set-tests".
 *
 * The same rule holds wherever a *name* is filtered — the choosers here, and
 * the sidebar and list panes through `fuzzyMatches` below. A pane that filters
 * exactly while the dropdown beside it filters fuzzily is the surprising thing;
 * one rule for "find the thing I can half-spell" is the point.
 *
 * The exception is `useDataTable`, which filters *data* rather than names: a
 * results cell holding an IRI is searched for a literal fragment, and a
 * subsequence spread across a long cell would match nearly every row while
 * looking like a mistake. Values stay substring; names are fuzzy.
 */

/** A label cut into runs, the matched ones flagged for highlighting. */
export interface MatchSegment {
  text: string;
  matched: boolean;
}

export interface FuzzyMatch<T> {
  item: T;
  segments: MatchSegment[];
}

const wholeLabel = (label: string): MatchSegment[] => (label ? [{ text: label, matched: false }] : []);

/** Merge fuzzysort's per-character indexes into contiguous runs. */
const toSegments = (label: string, indexes: readonly number[]): MatchSegment[] => {
  const segments: MatchSegment[] = [];
  const hit = new Set(indexes);
  for (const [i, char] of [...label].entries()) {
    const matched = hit.has(i);
    const last = segments[segments.length - 1];
    if (last && last.matched === matched) last.text += char;
    else segments.push({ text: char, matched });
  }
  return segments;
};

/**
 * Rank `items` against `query`. An empty query returns everything in the
 * caller's own order, so a chooser can open onto its full list.
 */
export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  getLabel: (item: T) => string,
): FuzzyMatch<T>[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return items.map((item) => ({ item, segments: wholeLabel(getLabel(item)) }));
  }
  const results = fuzzysort.go(trimmed, items, { key: getLabel, limit: 0, threshold: 0 });
  return results.map((result) => ({
    item: result.obj,
    segments: toSegments(result.target, result.indexes),
  }));
}

/**
 * Fuzzy predicate for the panes that keep their own order.
 *
 * `fuzzyFilter` re-orders by rank, which is what a chooser wants and a grouped
 * pane does not: a sidebar clustered by kind or tag, a table sorted by name, a
 * tree of libraries — each has already decided what order its rows are in, and
 * a filter should remove rows rather than shuffle them. So this answers only
 * "does this row survive?".
 *
 * `label` is matched fuzzily; `details` — a description, an endpoint, a
 * namespace — are plain substring tests, ORed in. A subsequence spread across a
 * paragraph or a URL matches almost anything, so fuzzy there would return the
 * whole list for two letters; a detail that literally contains what you typed
 * is still worth keeping.
 */
export function fuzzyMatches(
  query: string,
  label: string,
  ...details: (string | null | undefined)[]
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  if (fuzzysort.single(trimmed, label)) return true;
  const needle = trimmed.toLowerCase();
  return details.some((detail) => (detail ?? '').toLowerCase().includes(needle));
}
