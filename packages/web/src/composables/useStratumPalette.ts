/**
 * The categorical palette used to tint rule-stratification layers.
 *
 * A categorical colour ramp is a design-system concern, so the values live in
 * assets/css/tokens.css as --stratum-1..8 and this module only references them.
 * The returned strings are `var(--stratum-N)`, which resolve wherever they land
 * in a CSS property — inline `:style` bindings, CodeMirror theme objects, and
 * VueFlow node styles all qualify.
 *
 * Previously this array was duplicated verbatim in three components, which is
 * how they drifted apart on the fallback colour. It now has four readers — the
 * editor's stratum gutter, the document outline, the graph and the footer chip
 * — and one stratum has to be one colour across all of them.
 */

export const STRATUM_PALETTE: readonly string[] = [
  'var(--stratum-1)',
  'var(--stratum-2)',
  'var(--stratum-3)',
  'var(--stratum-4)',
  'var(--stratum-5)',
  'var(--stratum-6)',
  'var(--stratum-7)',
  'var(--stratum-8)',
];

/** Colour for content with no stratum assigned. */
export const STRATUM_NONE = 'var(--stratum-none)';

/**
 * Resolve a stratum number to its colour, wrapping around the palette.
 * Returns STRATUM_NONE for null/undefined/non-numeric input.
 */
export function stratumColor(
  stratum: number | string | null | undefined,
  palette: readonly string[] = STRATUM_PALETTE,
): string {
  if (stratum === null || stratum === undefined || stratum === '') return STRATUM_NONE;
  const n = Number(stratum);
  if (!Number.isFinite(n)) return STRATUM_NONE;
  return palette[Math.abs(Math.trunc(n)) % palette.length] ?? STRATUM_NONE;
}

/**
 * Strata are 0-based in the stratifier and 1-based to a reader.
 *
 * Beside `stratumColor` because a colour and its number are the same fact: a
 * band the gutter paints `--stratum-3` and calls "3" has to read the same way
 * in the graph, the outline and the replay timeline.
 */
export function stratumLabel(stratum: number | null | undefined): string {
  return stratum === null || stratum === undefined || !Number.isFinite(stratum) ? '—' : String(stratum + 1);
}

export function useStratumPalette() {
  return { STRATUM_PALETTE, STRATUM_NONE, stratumColor, stratumLabel };
}
