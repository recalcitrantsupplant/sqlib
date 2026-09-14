/**
 * Keyboard chords, normalised once so a binding and a key event can be compared
 * as strings.
 *
 * Two vocabularies meet here: the one a command declares (`'Mod+Enter'`,
 * `'g q'`, `'?'`) and the one the browser reports (a KeyboardEvent's `key` plus
 * four modifier booleans). Both are funnelled through `normalizeChord` /
 * `chordFromEvent` into the same lower-case, fixed-order string —
 * `'meta+enter'`, `'g'`, `'?'` — because the alternative is every dispatcher
 * re-deciding whether Cmd counts as Ctrl and whether Shift+/ is a `?`.
 *
 * `Mod` is the only platform-aware token: it resolves to Meta on Apple hardware
 * and Ctrl everywhere else, at parse time, so nothing downstream branches on
 * the platform. A binding that genuinely means the Control key on a Mac can say
 * `Ctrl+` and get it.
 */

/** Modifier order in a normalised chord. Fixed so string equality is enough. */
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const;

const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
  win: 'meta',
};

/** Spellings a binding may use for a key the browser names differently. */
const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
  ins: 'insert',
  plus: '+',
};

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const source = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /mac|iphone|ipad|ipod/i.test(source);
}

/**
 * Whether Shift belongs in the chord for this key.
 *
 * A punctuation key already carries its shift in the character the browser
 * reports — Shift+/ arrives as `?` — so recording the modifier as well would
 * make `'?'` unmatchable. Letters and digits do not: Shift+K arrives as `K`,
 * which lower-cases back to the unshifted chord, and named keys (Enter, Tab)
 * never change at all.
 */
function shiftIsSignificant(key: string): boolean {
  return key.length !== 1 || /[a-z0-9]/i.test(key);
}

function normalizeKeyToken(raw: string): string {
  return (KEY_ALIASES[raw.toLowerCase()] ?? raw).toLowerCase();
}

function assemble(key: string, mods: Set<string>): string {
  if (!shiftIsSignificant(key)) mods.delete('shift');
  const ordered = MODIFIER_ORDER.filter((mod) => mods.has(mod));
  return [...ordered, key].join('+');
}

/**
 * Normalise one declared chord: `'Mod+Shift+P'` → `'ctrl+shift+p'` (or
 * `'meta+shift+p'` on a Mac). Unknown modifier names are treated as the key,
 * which keeps a typo visible in the cheat sheet rather than silently dropped.
 */
export function normalizeChord(chord: string, apple: boolean = isApplePlatform()): string {
  const parts = chord.trim().split('+').filter((part) => part.length > 0);
  // A bare '+' binding splits to nothing; put it back rather than returning ''.
  if (parts.length === 0) return chord.trim() ? '+' : '';

  const mods = new Set<string>();
  let key = '';
  for (const [index, part] of parts.entries()) {
    const lower = part.toLowerCase();
    const last = index === parts.length - 1;
    if (lower === 'mod' && !last) {
      mods.add(apple ? 'meta' : 'ctrl');
      continue;
    }
    const alias = MODIFIER_ALIASES[lower];
    if (alias && !last) {
      mods.add(alias);
      continue;
    }
    key = lower === 'mod' ? (apple ? 'meta' : 'ctrl') : normalizeKeyToken(part);
  }
  return assemble(key, mods);
}

/** Normalise a key event into the same space as `normalizeChord`. */
export function chordFromEvent(event: KeyboardEvent): string {
  const mods = new Set<string>();
  if (event.ctrlKey) mods.add('ctrl');
  if (event.altKey) mods.add('alt');
  if (event.shiftKey) mods.add('shift');
  if (event.metaKey) mods.add('meta');
  return assemble(normalizeKeyToken(event.key), mods);
}

/**
 * Split a binding into the chords that have to be pressed in turn.
 *
 * Space separates the steps of a sequence (`'g q'`), which is why a literal
 * space key is spelled `'Space'` and normalised back to `' '`.
 */
export function parseBinding(binding: string, apple: boolean = isApplePlatform()): string[] {
  return binding
    .trim()
    .split(/\s+/)
    .filter((step) => step.length > 0)
    .map((step) => normalizeChord(step, apple));
}

/** True when the chord carries a modifier that no plain typing produces. */
export function hasCommandModifier(chord: string): boolean {
  return /(^|\+)(ctrl|meta|alt)\+/.test(chord);
}

const DISPLAY_APPLE: Record<string, string> = {
  meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧',
};
const DISPLAY_OTHER: Record<string, string> = {
  meta: 'Win', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift',
};
const DISPLAY_KEYS: Record<string, string> = {
  enter: 'Enter', escape: 'Esc', ' ': 'Space', arrowup: '↑', arrowdown: '↓',
  arrowleft: '←', arrowright: '→', backspace: '⌫', delete: 'Del', tab: 'Tab',
};

/** A binding as it should read on screen: `'Mod+K'` → `'⌘K'` or `'Ctrl+K'`. */
export function formatBinding(binding: string, apple: boolean = isApplePlatform()): string {
  return parseBinding(binding, apple)
    .map((chord) => formatChord(chord, apple))
    .join(' ');
}

export function formatChord(chord: string, apple: boolean = isApplePlatform()): string {
  const parts = chord.split('+');
  // Trailing '+' key: the split leaves an empty tail, so restore it.
  const key = parts.pop() || '+';
  const mods = parts.map((mod) => (apple ? DISPLAY_APPLE : DISPLAY_OTHER)[mod] ?? mod);
  const label = DISPLAY_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key.replace(/^./, (c) => c.toUpperCase()));
  return apple ? [...mods, label].join('') : [...mods, label].join('+');
}

/**
 * Whether the event landed somewhere the user is typing.
 *
 * Single-letter shortcuts and sequences must not fire mid-word, and CodeMirror
 * owns its own keymap (`useExecuteKeymap`, `useEditorKeymaps`) — so the global
 * dispatcher stands down inside `.cm-editor` as well as in form fields.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('.cm-editor')) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    // Checkboxes and buttons are not text entry; a letter shortcut over one is
    // still a shortcut.
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
  }
  return false;
}
