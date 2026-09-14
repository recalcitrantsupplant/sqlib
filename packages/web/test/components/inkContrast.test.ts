import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * What the ink tokens actually measure against the grounds they are painted on.
 *
 * The design system names four inks and says what each is for; it has never
 * said what any of them measures. That gap is why `--ink-disabled` — the
 * lightest of the four, and 2.07:1 on the page in light mode — spread to a
 * hundred and twenty-six declarations, most of them text a reader is meant to
 * read. The sixth pass caught one instance of it by eye at 3.4:1 (issue #37,
 * `RuleSetExecutionResults`'s dark-mode focus title); nothing was counting.
 *
 * So the numbers live here, computed from `tokens.css` rather than asserted
 * from memory, and the rule the thirteenth pass sweeps by rests on them:
 *
 *   - `--ink`, `--ink-secondary` and `--ink-muted` are text inks. AA body text
 *     is 4.5:1 (WCAG 2.2 SC 1.4.3).
 *   - `--ink-disabled` clears neither 4.5:1 nor the 3:1 that non-text needs, on
 *     any ground, in light mode. It is legitimate on an element that IS
 *     inactive — 1.4.3 exempts those explicitly — and wrong for anything else.
 *   - `--ink-muted` is the floor of the readable ramp: the next primitive up
 *     (`--gray-500`) is the disabled ink itself.
 *
 * The matrix is pinned to two decimals both ways. A palette change that
 * improves one of these fails here as loudly as one that breaks it, which is
 * the point: the numbers are the argument, so they cannot move quietly.
 */

const TOKENS = resolve(import.meta.dirname, '../../src/assets/css/tokens.css');
const css = readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of one top-level block, by name. */
const block = (header: string): Map<string, string> => {
  const at = css.indexOf(header);
  if (at < 0) throw new Error(`tokens.css has no ${header} block`);
  const open = css.indexOf('{', at);
  let depth = 0;
  let close = -1;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) { close = index; break; }
    }
  }
  const out = new Map<string, string>();
  for (const [, name, value] of css.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(name, value.trim());
  }
  return out;
};

const LIGHT = block(':root');
const DARK = block('.dark');

/** A token's value in one theme, following `var()` to a literal colour. */
const inkOf = (name: string, theme: 'light' | 'dark'): string => {
  let value = (theme === 'dark' ? DARK.get(name) : undefined) ?? LIGHT.get(name);
  for (let hop = 0; value && value.startsWith('var(') && hop < 8; hop += 1) {
    const inner = value.slice(4, value.lastIndexOf(')')).split(',')[0].trim();
    value = (theme === 'dark' ? DARK.get(inner) : undefined) ?? LIGHT.get(inner);
  }
  if (!value) throw new Error(`${name} is not defined`);
  return value;
};

const channels = (value: string): [number, number, number] => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const full = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const fn = /rgba?\(([^)]+)\)/i.exec(value);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    return [parts[0], parts[1], parts[2]];
  }
  throw new Error(`not a literal colour: ${value}`);
};

/** WCAG 2.x relative luminance. */
const luminance = (value: string): number => {
  const [r, g, b] = channels(value).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Two decimals, the precision the assertions below are written at. */
const ratio = (ink: string, ground: string, theme: 'light' | 'dark'): number =>
  Math.round(contrast(inkOf(ink, theme), inkOf(ground, theme)) * 100) / 100;

const GROUNDS = ['--surface', '--surface-subtle', '--surface-sunken', '--surface-raised'] as const;

describe('ink contrast', () => {
  /*
   * The three text inks against the page. Every one of them clears AA with room
   * to spare except the last, which clears it by 0.19 — see the headroom test.
   */
  it('the text inks clear AA on the page ground, in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const ink of ['--ink', '--ink-secondary', '--ink-muted']) {
        expect(ratio(ink, '--surface', theme), `${ink} on --surface (${theme})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  /*
   * And the fact the sweep rests on: in light mode the disabled ink clears
   * nothing at all — not the 4.5:1 text needs, not the 3:1 a control's own
   * glyph needs (SC 1.4.11). In dark it reaches 3.75:1 on the page, which is
   * still under AA and is what the sixth pass measured by hand at one site.
   *
   * This is not an argument for changing the token. A disabled control is
   * exempt from 1.4.3, and being visibly unreachable is what the colour is
   * for. It is an argument about where it may be used.
   */
  it('the disabled ink clears neither text nor non-text contrast', () => {
    for (const ground of GROUNDS) {
      expect(ratio('--ink-disabled', ground, 'light'), `light, on ${ground}`).toBeLessThan(3);
      expect(ratio('--ink-disabled', ground, 'dark'), `dark, on ${ground}`).toBeLessThan(4.5);
    }
    expect(ratio('--ink-disabled', '--surface', 'light')).toBe(2.07);
    expect(ratio('--ink-disabled', '--surface', 'dark')).toBe(3.75);
  });

  /*
   * The headroom, which is why the sweep has one destination rather than a
   * choice of two. `--ink-muted` is 4.69:1 on white — 0.19 above the floor —
   * and the next step up the primitive ramp IS the disabled ink. There is no
   * lighter readable step to reach for, so a hierarchy below the muted note has
   * to be drawn with size, weight or position rather than with a fourth grey.
   */
  it('the muted ink is the floor of the readable ramp', () => {
    expect(ratio('--ink-muted', '--surface', 'light')).toBe(4.69);
    expect(contrast(inkOf('--gray-500', 'light'), '#ffffff')).toBeLessThan(4.5);
    expect(inkOf('--ink-disabled', 'light')).toBe(inkOf('--gray-500', 'light'));
  });

  /*
   * The gap this pass does NOT close, recorded as numbers so it is a known
   * quantity rather than a surprise: the muted ink clears AA on the page and
   * misses it on every chrome ground in light mode. A toolbar caption is
   * 4.45:1 and a chip caption 3.95:1 — better than the 1.97 and 1.75 the
   * disabled ink gave them, and still short.
   *
   * Closing it means darkening `--ink-muted` itself, which moves every muted
   * label in the app: a token-layer decision, not a sweep. Pinned in both
   * directions, so the change that makes it lands here.
   */
  it('records the muted ink falling short on the chrome grounds', () => {
    expect(ratio('--ink-muted', '--surface-subtle', 'light')).toBe(4.45);
    expect(ratio('--ink-muted', '--surface-sunken', 'light')).toBe(4.22);
    expect(ratio('--ink-muted', '--surface-raised', 'light')).toBe(3.95);
    // Dark mode holds everywhere but the raised chip, which is the same shape.
    expect(ratio('--ink-muted', '--surface-subtle', 'dark')).toBe(6.34);
    expect(ratio('--ink-muted', '--surface-raised', 'dark')).toBe(4.04);
  });
});
