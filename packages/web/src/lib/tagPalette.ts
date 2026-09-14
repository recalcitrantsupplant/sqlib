/**
 * The eight colours a tag can take, and the rules for handing them out.
 *
 * A tag stores a literal `#rrggbb` rather than a token name: the library store
 * is exported as RDF, where a private token name means nothing. So the palette
 * lives here as hex, and `tokens.css` carries the same eight as `--tag-1..8`
 * for the stylesheet's benefit — the two lists are the same values wearing
 * different hats, which is why `TAG_PALETTE` is the one that assignment reads.
 *
 * Ordered to stay distinguishable side by side, like `--series-*` above them
 * in the token file: these are foreground marks a few pixels wide, not fills.
 */
export interface TagSwatch {
  /** `#rrggbb`, exactly as it will be stored. */
  hex: string;
  /** What the swatch's tooltip calls it. */
  label: string;
}

export const TAG_PALETTE: readonly TagSwatch[] = [
  { hex: '#2f6feb', label: 'Blue' },
  { hex: '#0d7676', label: 'Teal' },
  { hex: '#b8603a', label: 'Rust' },
  { hex: '#6b3a7a', label: 'Plum' },
  { hex: '#15803d', label: 'Green' },
  { hex: '#b45309', label: 'Amber' },
  { hex: '#0b7285', label: 'Cyan' },
  { hex: '#6f42c1', label: 'Violet' },
];

/** What a tag with no colour of its own renders as. */
export const TAG_COLOR_FALLBACK = '#8a919e';

/** The grey the computed "Untagged" group wears; never stored on anything. */
export const UNTAGGED_COLOR = '#ced4da';

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Anything that is not a storable `#rrggbb` becomes the fallback grey. */
export function normalizeTagColor(color: string | null | undefined): string {
  if (!color) return TAG_COLOR_FALLBACK;
  const trimmed = color.trim();
  return HEX_PATTERN.test(trimmed) ? trimmed.toLowerCase() : TAG_COLOR_FALLBACK;
}

export function isTagColor(color: string): boolean {
  return HEX_PATTERN.test(color.trim());
}

/**
 * The first palette colour no tag in this library holds.
 *
 * Tags are library-scoped, so the count restarts per library and eight is
 * usually more than enough. Past eight it wraps rather than inventing a ninth
 * colour: two tags sharing a hue is a smaller problem than a palette that
 * drifts into shades nobody can tell apart, and the picker is there for the
 * case where the collision matters.
 */
export function nextFreeTagColor(taken: Iterable<string | null | undefined>): string {
  const used = new Set([...taken].map((color) => normalizeTagColor(color)));
  const free = TAG_PALETTE.find((swatch) => !used.has(swatch.hex));
  if (free) return free.hex;
  const count = [...used].filter((color) => TAG_PALETTE.some((swatch) => swatch.hex === color)).length;
  return TAG_PALETTE[count % TAG_PALETTE.length].hex;
}

/**
 * Black or white, whichever reads on the given fill.
 *
 * Only chips filled with the tag's colour need this; a dot does not. Relative
 * luminance per WCAG, the same computation GitHub labels and Linear both make
 * at render time rather than storing a second colour.
 */
export function tagForeground(color: string | null | undefined): string {
  const hex = normalizeTagColor(color);
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.45 ? '#16181d' : '#ffffff';
}

/** A tag with its chip colours resolved, ready to render. */
export interface DecoratedTag {
  id: string;
  name: string;
  /** Always a storable `#rrggbb`. */
  color: string;
  /** Black or white, whichever reads on `color`. */
  ink: string;
}

/**
 * Resolve a stored tag into what a filled chip needs.
 *
 * The pair is always computed together — a chip filled with `color` is
 * unreadable without the matching `ink` — so deriving them in one place keeps
 * a caller from filling a chip and forgetting the foreground.
 */
export function decorateTag(tag: { id: string; name: string; color?: string | null }): DecoratedTag {
  return {
    id: tag.id,
    name: tag.name,
    color: normalizeTagColor(tag.color),
    ink: tagForeground(tag.color),
  };
}
