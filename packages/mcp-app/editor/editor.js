/**
 * The one editor a View embeds: CodeMirror 6 with the SRL, SPARQL and Turtle
 * grammars the web app already uses.
 *
 * Bundled by `scripts/bundle-editor.mjs` into `src/kit/editor.bundle.js`, an
 * IIFE that sets `window.sqlibEditor`, and inlined into a View like the rest of
 * the kit. It cannot be loaded from a CDN: the Views declare an empty
 * `resourceDomains`, so a `<script src>` pointing anywhere is refused by any
 * host that enforces the CSP — which is the point of declaring it empty.
 *
 * Deliberately small. No completion, no lint gutter, no prefix manager: the
 * tutorial's feedback comes from the server's own analysis, shown beside the
 * editor, so the editor only has to be a good place to type RDF.
 */
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  Decoration,
} from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  syntaxHighlighting,
  bracketMatching,
  indentOnInput,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintGutter, lintKeymap } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import { srl } from '@kurrawongai/codemirror-lang-srl';
import { sparql } from '@kurrawongai/codemirror-lang-sparql12';
import { turtle } from '@kurrawongai/codemirror-lang-turtle12';

/*
 * Colours are custom-property references, resolved at paint time, so the one
 * style follows the View's light/dark tokens and whatever the host overrides —
 * the same arrangement as `packages/web/src/lib/codemirrorHighlight.ts`.
 */
const highlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--ink-muted)', fontStyle: 'italic' },
  {
    tag: [t.keyword, t.meta, t.modifier, t.operatorKeyword, t.definitionKeyword, t.controlKeyword],
    color: 'var(--syntax-keyword, #b4235a)',
    fontWeight: '600',
  },
  { tag: [t.string, t.number, t.integer, t.float, t.bool, t.atom, t.literal], color: 'var(--rdf-literal)' },
  { tag: [t.url, t.namespace], color: 'var(--rdf-uri)' },
  { tag: [t.typeName, t.annotation], color: 'var(--rdf-typed)' },
  { tag: t.variableName, color: 'var(--syntax-var, #b45309)' },
  { tag: t.propertyName, color: 'var(--rdf-blank)' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

const chrome = EditorView.theme({
  '&': {
    fontSize: '12.5px',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface)',
    color: 'var(--ink)',
  },
  '&.cm-focused': { outline: '2px solid color-mix(in srgb, var(--action) 35%, transparent)', outlineOffset: '0' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--ink)', padding: '6px 0' },
  '.cm-gutters': {
    background: 'var(--surface-subtle)',
    color: 'var(--ink-muted)',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLine': { background: 'color-mix(in srgb, var(--action) 6%, transparent)' },
  '.cm-activeLineGutter': { background: 'color-mix(in srgb, var(--action) 10%, transparent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    background: 'color-mix(in srgb, var(--action) 22%, transparent) !important',
  },
  '.cm-line-flagged': { background: 'color-mix(in srgb, var(--danger) 12%, transparent)' },
  '.cm-tooltip': {
    background: 'var(--surface)',
    color: 'var(--ink)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
  },
  '.cm-diagnosticAction': {
    background: 'var(--action)',
    color: 'var(--action-fg)',
    borderRadius: 'var(--radius-sm)',
    padding: '2px 8px',
    font: 'inherit',
    fontWeight: '600',
  },
});

/*
 * `sparqlConversions` is the grammar's opt-in assistance: SRL's conformance
 * diagnostics (a SPARQL `BIND`, `FILTER NOT EXISTS`, …) are raised either way,
 * and with it on they also carry the edit that converts the SPARQL spelling to
 * SRL's — "Convert SPARQL BIND to SRL SET" — the same flag sqlib's web editors
 * pass in `lib/codeLanguage.ts`.
 */
const languages = {
  srl: (options) => srl({ tuples: false, sparqlConversions: Boolean(options && options.sparqlConversions) }),
  sparql: () => sparql(),
  turtle: () => turtle(),
};
const languageFor = (name, options) => (languages[name] ?? languages.srl)(options);

/** Lines to flag, e.g. the one a parse error names. Replaced wholesale. */
const setFlagged = StateEffect.define();
const flaggedLines = StateField.define({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setFlagged)) continue;
      const doc = transaction.state.doc;
      const ranges = effect.value
        .filter((line) => line >= 1 && line <= doc.lines)
        .sort((a, b) => a - b)
        .map((line) => Decoration.line({ class: 'cm-line-flagged' }).range(doc.line(line).from));
      next = Decoration.set(ranges);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Mount an editor.
 *
 * @param {HTMLElement} parent
 * @param {{ language?: 'srl' | 'sparql' | 'turtle', doc?: string, readOnly?: boolean,
 *           onChange?: (text: string) => void, onRun?: () => void, minHeight?: string }} options
 */
function create(parent, options = {}) {
  const language = new Compartment();
  let current = { language: options.language, sparqlConversions: Boolean(options.sparqlConversions) };
  const editable = new Compartment();
  const runKeys = keymap.of([
    {
      key: 'Mod-Enter',
      run: () => {
        if (options.onRun) options.onRun();
        return true;
      },
    },
  ]);

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc ?? '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        runKeys,
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...lintKeymap, indentWithTab]),
        // The grammar's diagnostics: an underline, a gutter marker, and on
        // hover the message with any action it offers.
        lintGutter(),
        syntaxHighlighting(highlight),
        chrome,
        flaggedLines,
        EditorView.lineWrapping,
        EditorView.theme({ '.cm-content, .cm-gutter': { minHeight: options.minHeight ?? '120px' } }),
        language.of(languageFor(options.language, options)),
        editable.of([EditorState.readOnly.of(Boolean(options.readOnly)), EditorView.editable.of(!options.readOnly)]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && options.onChange) options.onChange(update.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    /** Replace the whole text. Fires onChange, as an edit would. */
    setValue(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(text ?? '') } });
    },
    /** Switch grammar; `extra.sparqlConversions` opts an SRL editor into the fix actions. */
    setLanguage(name, extra) {
      current = { language: name, sparqlConversions: extra ? Boolean(extra.sparqlConversions) : current.sparqlConversions };
      view.dispatch({ effects: language.reconfigure(languageFor(current.language, current)) });
    },
    setReadOnly(readOnly) {
      view.dispatch({
        effects: editable.reconfigure([EditorState.readOnly.of(Boolean(readOnly)), EditorView.editable.of(!readOnly)]),
      });
    },
    /** Tint these 1-based lines; an empty list clears them. */
    flagLines(lines) {
      view.dispatch({ effects: setFlagged.of(Array.isArray(lines) ? lines : []) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

window.sqlibEditor = { create };
