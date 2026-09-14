import { chordFromEvent, hasCommandModifier, isTypingTarget } from '../lib/keys';
import { useCommandRegistry, type Command } from './useCommandRegistry';

/**
 * The one keydown handler, resolving events against the command registry.
 *
 * Sequences (`g q`) are why this is a small state machine rather than a lookup:
 * a chord that no command claims outright may still be the first step of one,
 * and the next keystroke decides. The pending run is dropped after
 * `SEQUENCE_TIMEOUT_MS`, so a stray `g` cannot turn the next unrelated key into
 * a navigation.
 *
 * The dispatcher is deliberately separate from `plugins/commands.client.ts`:
 * the plugin owns a window listener and cannot be unit-tested without Nuxt,
 * whereas everything worth testing is here.
 */

export const SEQUENCE_TIMEOUT_MS = 1200;

export interface KeyDispatcher {
  handle: (event: KeyboardEvent) => Command | null;
  /** The chords pressed so far in an unfinished sequence. For a hint chip. */
  pending: () => string[];
  reset: () => void;
}

export function createKeyDispatcher(now: () => number = () => Date.now()): KeyDispatcher {
  const registry = useCommandRegistry();
  let pending: string[] = [];
  let pendingAt = 0;

  const reset = () => {
    pending = [];
    pendingAt = 0;
  };

  const expired = () => pending.length > 0 && now() - pendingAt > SEQUENCE_TIMEOUT_MS;

  const handle = (event: KeyboardEvent): Command | null => {
    // An IME composition sends keydowns that mean nothing on their own.
    if (event.isComposing || event.keyCode === 229) return null;
    if (expired()) reset();

    const chord = chordFromEvent(event);
    // A modifier pressed on its own is never a chord, and must not break a
    // sequence in progress — holding Shift to reach the next key is normal.
    if (['shift', 'control', 'alt', 'meta'].includes(event.key.toLowerCase())) return null;

    /*
     * Typing wins over shortcuts. Only chords carrying Ctrl/Cmd/Alt — which no
     * amount of typing produces — reach a command from inside an input or a
     * CodeMirror editor, and a sequence in progress is abandoned rather than
     * continued across a click into a field.
     */
    if (isTypingTarget(event.target) && !hasCommandModifier(chord)) {
      reset();
      return null;
    }

    const run = [...pending, chord];
    const command = registry.matchSequence(run);
    if (command) {
      reset();
      event.preventDefault();
      registry.execute(command.id);
      return command;
    }

    if (registry.isSequencePrefix(run)) {
      pending = run;
      pendingAt = now();
      // A prefix key is consumed: `g` alone must not scroll or type anywhere.
      event.preventDefault();
      return null;
    }

    /*
     * No match. If a sequence was in progress the keystroke ended it, and it is
     * retried on its own — so `g` then `Mod+K` still opens the palette rather
     * than being eaten by the dead sequence.
     */
    if (pending.length > 0) {
      reset();
      const direct = registry.matchSequence([chord]);
      if (direct) {
        event.preventDefault();
        registry.execute(direct.id);
        return direct;
      }
    }
    return null;
  };

  return { handle, pending: () => [...pending], reset };
}
