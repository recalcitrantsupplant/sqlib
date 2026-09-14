/**
 * The colour model shared by every tag surface (tags mockup 1c).
 */
import { describe, it, expect } from 'vitest';
import { TAG_PALETTE, nextFreeTagColor, normalizeTagColor, tagForeground } from '@/lib/tagPalette';

describe('tagPalette', () => {
  it('hands out the first colour no other tag holds', () => {
    expect(nextFreeTagColor([])).toBe(TAG_PALETTE[0].hex);
    expect(nextFreeTagColor([TAG_PALETTE[0].hex])).toBe(TAG_PALETTE[1].hex);
    // Case and whitespace are storage noise, not a different colour.
    expect(nextFreeTagColor([' #2F6FEB '])).toBe(TAG_PALETTE[1].hex);
  });

  it('wraps rather than inventing a ninth colour', () => {
    const all = TAG_PALETTE.map((swatch) => swatch.hex);
    expect(all).toContain(nextFreeTagColor(all));
  });

  it('ignores colours outside the palette when counting what is taken', () => {
    expect(nextFreeTagColor(['#123456', null, undefined])).toBe(TAG_PALETTE[0].hex);
  });

  it('falls back rather than rendering an unstorable colour', () => {
    expect(normalizeTagColor('rebeccapurple')).toBe('#8a919e');
    expect(normalizeTagColor('#ABCDEF')).toBe('#abcdef');
  });

  it('derives a foreground that reads on the fill', () => {
    expect(tagForeground('#ffffff')).toBe('#16181d');
    expect(tagForeground('#15803d')).toBe('#ffffff');
  });
});
