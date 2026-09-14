/**
 * One colour per backend, stable across every benchmark screen.
 *
 * The support matrix, the execution timeline and the requests table all mark
 * the same store, and they only read as the same store if the colour does not
 * move between them. Assignment is by position in the benchmark's backend axis
 * rather than by hashing the IRI: a hash is stable too, but it hands adjacent
 * backends adjacent hues often enough to matter, and the axis is short.
 */

const SERIES_COUNT = 6;

/** `var(--series-3)`, ready for a style binding. Unknown index → the grey. */
export function seriesVar(index: number | null | undefined): string {
  if (index == null || index < 0 || !Number.isFinite(index)) return 'var(--series-unknown)';
  return `var(--series-${(index % SERIES_COUNT) + 1})`;
}

/** Colour lookup for a fixed list of ids — the benchmark's backend axis. */
export function seriesLookup(ids: string[]): (id: string | null | undefined) => string {
  const byId = new Map(ids.map((id, index) => [id, seriesVar(index)]));
  return (id) => (id ? byId.get(id) ?? 'var(--series-unknown)' : 'var(--series-unknown)');
}
