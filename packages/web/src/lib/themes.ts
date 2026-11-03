/**
 * The colour themes a user can pick in Settings.
 *
 * A theme is a skin over the design system, not a change to it. Each one is a
 * block in `assets/css/themes.css`, scoped to `:root[data-theme="<id>"]`, that
 * redefines semantic colour tokens and, at most, the radius scale, shadows and
 * the focus ring. Spacing, sizes, the type scale and the font stay with the
 * design system: a wider font wraps the run bar, which is a layout change.
 *
 * Every theme has a base. A dark theme is applied together with the `.dark`
 * class, so it inherits the dark status colours and every component rule that
 * hangs off `.dark`; it only has to restate what it changes. The user picks
 * one light theme and one dark theme, and the light/dark mode chooses between
 * them — so "System" keeps following the OS.
 *
 * `default` is the plain `tokens.css` look and sets no `data-theme` at all.
 *
 * The swatch colours draw the picker's preview. They are copies of the
 * theme's own tokens, and `test/components/themeCatalogue.test.ts` holds them
 * to the stylesheet so the two cannot drift.
 */

export type ThemeBase = 'light' | 'dark';

export interface ThemeSwatch {
  /** --surface */
  surface: string;
  /** --surface-subtle */
  rail: string;
  /** --ink */
  ink: string;
  /** --action */
  action: string;
  /** --rdf-iri */
  iri: string;
  /** --rdf-literal */
  literal: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  base: ThemeBase;
  swatch: ThemeSwatch;
}

export const DEFAULT_THEME_ID = 'default';

export const LIGHT_THEMES: readonly ThemeDefinition[] = [
  {
    id: DEFAULT_THEME_ID,
    name: 'Default',
    base: 'light',
    swatch: { surface: '#ffffff', rail: '#f8f9fa', ink: '#212529', action: '#0d6efd', iri: '#0b5ed7', literal: '#1a7f37' },
  },
  {
    id: 'paper',
    name: 'Paper',
    base: 'light',
    swatch: { surface: '#fbf8f1', rail: '#f4efe4', ink: '#2b2620', action: '#2f5d8a', iri: '#2f5d8a', literal: '#4f6b1f' },
  },
  {
    id: 'contrast',
    name: 'Contrast',
    base: 'light',
    swatch: { surface: '#ffffff', rail: '#ffffff', ink: '#000000', action: '#0038b0', iri: '#0038b0', literal: '#00661c' },
  },
];

export const DARK_THEMES: readonly ThemeDefinition[] = [
  {
    id: DEFAULT_THEME_ID,
    name: 'Default',
    base: 'dark',
    swatch: { surface: '#0f172a', rail: '#172033', ink: '#f8f9fa', action: '#3b82f6', iri: '#60a5fa', literal: '#4ade80' },
  },
  {
    id: 'fjord',
    name: 'Fjord',
    base: 'dark',
    swatch: { surface: '#1b2230', rail: '#212a3a', ink: '#e6ebf2', action: '#4fb3bf', iri: '#7fb4e6', literal: '#a3d18b' },
  },
  {
    id: 'ember',
    name: 'Ember',
    base: 'dark',
    swatch: { surface: '#1c1714', rail: '#241e1a', ink: '#f2e9df', action: '#e8954a', iri: '#8bb8e8', literal: '#b5cf7a' },
  },
  {
    id: 'console',
    name: 'Console',
    base: 'dark',
    swatch: { surface: '#0b0f0c', rail: '#111712', ink: '#d6f5dc', action: '#3ddc84', iri: '#7cc7ff', literal: '#c8e66a' },
  },
];

/** The stored id if it names a theme of that base, else the default. */
export function resolveThemeId(base: ThemeBase, id: unknown): string {
  const list = base === 'dark' ? DARK_THEMES : LIGHT_THEMES;
  return typeof id === 'string' && list.some((theme) => theme.id === id) ? id : DEFAULT_THEME_ID;
}
