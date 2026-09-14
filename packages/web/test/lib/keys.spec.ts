/**
 * Chord normalisation, both directions.
 *
 * The declared vocabulary and the browser's have to meet in the middle, and the
 * three places that has ever gone wrong are Mod on a Mac, Shift baked into a
 * punctuation character, and a sequence being told apart from a chord. Those
 * are what these pin.
 */
import { describe, it, expect } from 'vitest';

import {
  chordFromEvent,
  formatBinding,
  hasCommandModifier,
  isTypingTarget,
  normalizeChord,
  parseBinding,
} from '@/lib/keys';

const APPLE = true;
const OTHER = false;

const event = (init: Partial<KeyboardEventInit> & { key: string }) =>
  new KeyboardEvent('keydown', init);

describe('normalizeChord', () => {
  it('resolves Mod per platform', () => {
    expect(normalizeChord('Mod+k', APPLE)).toBe('meta+k');
    expect(normalizeChord('Mod+k', OTHER)).toBe('ctrl+k');
  });

  it('keeps an explicit Ctrl as Ctrl on a Mac', () => {
    expect(normalizeChord('Ctrl+k', APPLE)).toBe('ctrl+k');
  });

  it('orders modifiers so equality is enough', () => {
    expect(normalizeChord('Shift+Alt+Mod+p', OTHER)).toBe(normalizeChord('Mod+Shift+Alt+p', OTHER));
  });

  it('drops Shift from a key that already carries it', () => {
    expect(normalizeChord('?', OTHER)).toBe('?');
    expect(normalizeChord('Shift+?', OTHER)).toBe('?');
  });

  it('keeps Shift on letters and named keys', () => {
    expect(normalizeChord('Shift+k', OTHER)).toBe('shift+k');
    expect(normalizeChord('Shift+Enter', OTHER)).toBe('shift+enter');
  });

  it('accepts the common aliases', () => {
    expect(normalizeChord('Cmd+Esc', OTHER)).toBe('meta+escape');
    expect(normalizeChord('Option+Up', OTHER)).toBe('alt+arrowup');
  });
});

describe('chordFromEvent', () => {
  it('matches what the binding normalises to', () => {
    expect(chordFromEvent(event({ key: 'k', metaKey: true }))).toBe(normalizeChord('Mod+k', APPLE));
    expect(chordFromEvent(event({ key: 'Enter', ctrlKey: true }))).toBe(normalizeChord('Mod+Enter', OTHER));
  });

  it('reports Shift+/ as the question mark the binding declares', () => {
    expect(chordFromEvent(event({ key: '?', shiftKey: true }))).toBe(normalizeChord('?', OTHER));
  });

  it('lower-cases a shifted letter but keeps the modifier', () => {
    expect(chordFromEvent(event({ key: 'K', shiftKey: true }))).toBe('shift+k');
  });
});

describe('parseBinding', () => {
  it('splits a sequence on whitespace', () => {
    expect(parseBinding('g q', OTHER)).toEqual(['g', 'q']);
  });

  it('leaves a single chord as one step', () => {
    expect(parseBinding('Mod+Shift+p', OTHER)).toEqual(['ctrl+shift+p']);
  });
});

describe('hasCommandModifier', () => {
  it('is true only for chords typing cannot produce', () => {
    expect(hasCommandModifier('ctrl+enter')).toBe(true);
    expect(hasCommandModifier('meta+k')).toBe(true);
    expect(hasCommandModifier('alt+arrowup')).toBe(true);
    expect(hasCommandModifier('shift+k')).toBe(false);
    expect(hasCommandModifier('g')).toBe(false);
  });
});

describe('formatBinding', () => {
  it('reads as the platform writes it', () => {
    expect(formatBinding('Mod+k', APPLE)).toBe('⌘K');
    expect(formatBinding('Mod+k', OTHER)).toBe('Ctrl+K');
    expect(formatBinding('Mod+Shift+f', OTHER)).toBe('Ctrl+Shift+F');
  });

  it('keeps a sequence a sequence', () => {
    expect(formatBinding('g q', OTHER)).toBe('G Q');
  });

  it('names the keys that have no character', () => {
    expect(formatBinding('Mod+Enter', OTHER)).toBe('Ctrl+Enter');
  });
});

describe('isTypingTarget', () => {
  const el = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild as HTMLElement;
  };

  it('is true for text entry', () => {
    expect(isTypingTarget(el('<input type="text">'))).toBe(true);
    expect(isTypingTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isTypingTarget(el('<div contenteditable="true"></div>'))).toBe(true);
  });

  it('is true inside a CodeMirror editor, which owns its own keymap', () => {
    const host = el('<div class="cm-editor"><div class="cm-content"></div></div>');
    expect(isTypingTarget(host.querySelector('.cm-content'))).toBe(true);
  });

  it('is false for a checkbox or a button', () => {
    expect(isTypingTarget(el('<input type="checkbox">'))).toBe(false);
    expect(isTypingTarget(el('<button></button>'))).toBe(false);
  });
});
