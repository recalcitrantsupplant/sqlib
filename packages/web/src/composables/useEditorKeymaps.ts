import { keymap } from '@codemirror/view';
import { EditorSelection, type Extension } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';

/**
 * Creates editor keymap extensions for common editing operations:
 * - Alt+Up: Move line(s) up
 * - Alt+Down: Move line(s) down
 */
export function useEditorKeymaps(): Extension {
  const moveLineUp: KeyBinding = {
    key: 'Alt-ArrowUp',
    preventDefault: true,
    run: (view) => {
      const { state } = view;
      const changes = [];
      const newSelections = [];

      for (const range of state.selection.ranges) {
        const fromLine = state.doc.lineAt(range.from);
        const toLine = state.doc.lineAt(range.to);

        // Can't move up if already at the first line
        if (fromLine.number === 1) {
          continue;
        }

        const prevLine = state.doc.line(fromLine.number - 1);
        const linesToMove = state.doc.sliceString(fromLine.from, toLine.to);
        const prevLineText = prevLine.text;

        // Remove the lines to move and the previous line
        changes.push({
          from: prevLine.from,
          to: toLine.to,
          insert: linesToMove + '\n' + prevLineText,
        });

        // Calculate new selection position
        const offset = -(prevLineText.length + 1);
        newSelections.push({
          anchor: range.anchor + offset,
          head: range.head + offset,
        });
      }

      if (changes.length > 0) {
        view.dispatch({
          changes,
          selection: EditorSelection.create(
            newSelections.map((sel) => EditorSelection.range(sel.anchor, sel.head)),
          ),
          scrollIntoView: true,
        });
        return true;
      }

      return false;
    },
  };

  const moveLineDown: KeyBinding = {
    key: 'Alt-ArrowDown',
    preventDefault: true,
    run: (view) => {
      const { state } = view;
      const changes = [];
      const newSelections = [];

      for (const range of state.selection.ranges) {
        const fromLine = state.doc.lineAt(range.from);
        const toLine = state.doc.lineAt(range.to);

        // Can't move down if already at the last line
        if (toLine.number === state.doc.lines) {
          continue;
        }

        const nextLine = state.doc.line(toLine.number + 1);
        const linesToMove = state.doc.sliceString(fromLine.from, toLine.to);
        const nextLineText = nextLine.text;

        // Remove the lines to move and the next line
        changes.push({
          from: fromLine.from,
          to: nextLine.to,
          insert: nextLineText + '\n' + linesToMove,
        });

        // Calculate new selection position
        const offset = nextLineText.length + 1;
        newSelections.push({
          anchor: range.anchor + offset,
          head: range.head + offset,
        });
      }

      if (changes.length > 0) {
        view.dispatch({
          changes,
          selection: EditorSelection.create(
            newSelections.map((sel) => EditorSelection.range(sel.anchor, sel.head)),
          ),
          scrollIntoView: true,
        });
        return true;
      }

      return false;
    },
  };

  return keymap.of([moveLineUp, moveLineDown]);
}
