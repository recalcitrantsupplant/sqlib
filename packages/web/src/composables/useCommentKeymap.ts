import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';

/**
 * Creates a keymap extension that toggles line comments with Ctrl+/ (or Cmd+/ on Mac).
 * Adds or removes '#' at the start of each selected line.
 */
export function useCommentKeymap(): Extension {
  const toggleLineComment: KeyBinding = {
    key: 'Mod-/',
    run: (view) => {
      const { state } = view;
      const changes = [];

      // Process each selection range
      for (const range of state.selection.ranges) {
        const from = state.doc.lineAt(range.from);
        const to = state.doc.lineAt(range.to);

        // Iterate through all lines in the selection
        for (let lineNum = from.number; lineNum <= to.number; lineNum++) {
          const line = state.doc.line(lineNum);
          const lineText = line.text;
          const trimmedText = lineText.trimStart();
          const leadingWhitespace = lineText.substring(0, lineText.length - trimmedText.length);

          if (trimmedText.startsWith('#')) {
            // Remove comment: remove the first '#' (and optional space after it)
            const afterHash = trimmedText.substring(1);
            const newText = afterHash.startsWith(' ')
              ? leadingWhitespace + afterHash.substring(1)
              : leadingWhitespace + afterHash;

            changes.push({
              from: line.from,
              to: line.to,
              insert: newText,
            });
          } else {
            // Add comment: insert '# ' at the start (after leading whitespace)
            const newText = leadingWhitespace + '# ' + trimmedText;
            changes.push({
              from: line.from,
              to: line.to,
              insert: newText,
            });
          }
        }
      }

      if (changes.length > 0) {
        view.dispatch({
          changes,
          selection: state.selection,
        });
        return true;
      }

      return false;
    },
  };

  return keymap.of([toggleLineComment]);
}
