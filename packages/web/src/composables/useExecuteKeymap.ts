import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';

/**
 * Creates a keymap extension for executing queries with Ctrl+Enter (or Cmd+Enter on Mac).
 * @param onExecute - Callback function to execute when the key combination is pressed
 */
export function useExecuteKeymap(onExecute: () => void | Promise<void>): Extension {
  const executeQuery: KeyBinding = {
    key: 'Mod-Enter',
    run: () => {
      // Call the execute callback
      const result = onExecute();
      // If it's a promise, we don't need to wait for it
      if (result instanceof Promise) {
        result.catch((err) => console.error('Execute keymap error:', err));
      }
      return true;
    },
  };

  /*
   * Highest precedence, or the binding never runs: vue-codemirror builds the
   * editor state from basicSetup and only then appends the `extensions` prop
   * through a compartment, so anything passed in sits *below* the default
   * keymap — whose own Mod-Enter (insert blank line) was swallowing the event
   * while the run button went on advertising Ctrl+Enter.
   */
  return Prec.highest(keymap.of([executeQuery]));
}
