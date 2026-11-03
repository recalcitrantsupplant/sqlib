import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DARK_THEMES, DEFAULT_THEME_ID, LIGHT_THEMES, resolveThemeId, type ThemeDefinition } from '../../src/lib/themes';

/**
 * The colour themes, held to the rules a theme has to keep.
 *
 * A theme is a skin over the design system. So this checks, for every block in
 * themes.css: that the picker and the stylesheet agree on which themes exist
 * and what they look like; that the block touches only what a theme may
 * change; and that what it paints is readable, at the same AA bar the default
 * themes are held to in inkContrast.test.ts.
 */

const CSS_DIR = resolve(import.meta.dirname, '../../src/assets/css');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = strip(readFileSync(resolve(CSS_DIR, 'tokens.css'), 'utf8'));
const THEMES = strip(readFileSync(resolve(CSS_DIR, 'themes.css'), 'utf8'));

/** The declarations of the block that starts at `header`. */
function block(css: string, header: string): Map<string, string> {
  const at = css.indexOf(header);
  if (at < 0) throw new Error(`no ${header} block`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  const out = new Map<string, string>();
  for (const [, name, value] of css.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(name, value.trim());
  }
  return out;
}

const LIGHT_BASE = block(TOKENS, ':root {');
const DARK_BASE = block(TOKENS, '.dark {');
const selector = (id: string) => `:root[data-theme="${id}"]`;

/** The cascade at <html> for one theme: its block, then .dark if dark, then :root. */
function layers(theme: ThemeDefinition): Map<string, string>[] {
  const own = theme.id === DEFAULT_THEME_ID ? [] : [block(THEMES, selector(theme.id))];
  return theme.base === 'dark' ? [...own, DARK_BASE, LIGHT_BASE] : [...own, LIGHT_BASE];
}

function valueOf(theme: ThemeDefinition, name: string): string {
  const stack = layers(theme);
  const find = (n: string) => stack.map((map) => map.get(n)).find((v) => v !== undefined);
  let value = find(name);
  for (let hop = 0; value?.startsWith('var(') && hop < 8; hop += 1) {
    value = find(value.slice(4, value.lastIndexOf(')')).split(',')[0].trim());
  }
  if (!value) throw new Error(`${theme.id}: ${name} is not defined`);
  return value.toLowerCase();
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const n = parseInt(match[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const ALL = [...LIGHT_THEMES, ...DARK_THEMES];
const CUSTOM = ALL.filter((theme) => theme.id !== DEFAULT_THEME_ID);

describe('theme catalogue', () => {
  it('has one stylesheet block per theme, and no block without a theme', () => {
    const blocks = [...THEMES.matchAll(/:root\[data-theme="([a-z0-9-]+)"\]/g)].map((m) => m[1]).sort();
    expect(blocks).toEqual(CUSTOM.map((theme) => theme.id).sort());
  });

  it('gives each theme a unique id within its base, and a default in each', () => {
    for (const list of [LIGHT_THEMES, DARK_THEMES]) {
      const ids = list.map((theme) => theme.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain(DEFAULT_THEME_ID);
    }
    // An id names one theme across both lists, so data-theme is unambiguous.
    const custom = CUSTOM.map((theme) => theme.id);
    expect(new Set(custom).size).toBe(custom.length);
  });

  it('draws each swatch in the colours the theme actually paints', () => {
    const fields = {
      surface: '--surface',
      rail: '--surface-subtle',
      ink: '--ink',
      action: '--action',
      iri: '--rdf-iri',
      literal: '--rdf-literal',
    } as const;
    for (const theme of ALL) {
      for (const [field, token] of Object.entries(fields)) {
        expect(theme.swatch[field as keyof typeof fields], `${theme.base}/${theme.id} ${field}`)
          .toBe(valueOf(theme, token));
      }
    }
  });

  it('changes only what a theme may change', () => {
    /*
     * Colour tokens, the radius scale, shadows and the focus ring. Not spacing,
     * sizes, type, the font (a wider font wraps the run bar), primitives, or
     * --tag-* (a tag stores its hex in the RDF).
     */
    const forbidden = /^--(space|grid|control|panel-bar|icon|text|weight|leading|font|z|duration|popout|tag|gray|blue|green|red|amber|violet|cyan|orange)-?/;
    for (const theme of CUSTOM) {
      const touched = [...block(THEMES, selector(theme.id)).keys()].filter((name) => forbidden.test(name));
      expect(touched, `${theme.id} sets design-system tokens`).toEqual([]);
    }
  });

  it('keeps every text ink, action and RDF term readable on the page', () => {
    const failures: string[] = [];
    const check = (theme: ThemeDefinition, ink: string, ground: string, floor: number) => {
      const ratio = contrast(valueOf(theme, ink), valueOf(theme, ground));
      if (ratio < floor) failures.push(`${theme.id}: ${ink} on ${ground} is ${ratio.toFixed(2)}, needs ${floor}`);
    };
    for (const theme of CUSTOM) {
      for (const ink of ['--ink', '--ink-secondary', '--ink-muted']) check(theme, ink, '--surface', 4.5);
      for (const ink of ['--rdf-iri', '--rdf-literal', '--rdf-var', '--rdf-bnode', '--syntax-keyword']) {
        check(theme, ink, '--surface', 4.5);
      }
      check(theme, '--action-fg', '--action', 4.5);
      check(theme, '--action-ink', '--action-surface', 4.5);
      check(theme, '--action', '--surface', 3);
      check(theme, '--ink-muted', '--surface-sunken', 4.5);
    }
    expect(failures).toEqual([]);
  });
});

describe('resolveThemeId', () => {
  it('keeps a known id of the right base', () => {
    expect(resolveThemeId('light', 'paper')).toBe('paper');
    expect(resolveThemeId('dark', 'ember')).toBe('ember');
  });

  it('falls back to the default for an unknown id, the wrong base, or no id', () => {
    expect(resolveThemeId('light', 'gone')).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId('dark', 'paper')).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId('light', undefined)).toBe(DEFAULT_THEME_ID);
  });
});
