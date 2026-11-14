/**
 * Display extensions for an RDF Patch document: diff colours for its rows, and
 * prefixed names in place of full IRIs.
 *
 * Both are display only. The document keeps the text the server sent, so a
 * copy, a download or a parse reads full IRIs. A stored patch must keep full
 * IRIs: the RDF Patch specification says "Prefixes do not apply to the data of
 * the patch", so `PA` rows change the prefixes of the target dataset and do not
 * abbreviate later rows. The grammar (`rdfPatch()` in
 * `@kurrawongai/codemirror-lang-turtle12`) rejects a prefixed name in an `A` or
 * `D` row for that reason.
 *
 * This file reads node names from the tree and does not import the grammar
 * package. `codeLanguage.ts` is the one file that does.
 */
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

/** The row nodes that add, and the row nodes that delete. */
const ADD_ROWS = new Set(['QuadAdd', 'PrefixAdd']);
const DELETE_ROWS = new Set(['QuadDelete', 'PrefixDelete']);

const addLine = Decoration.line({ class: 'cm-patch-add' });
const deleteLine = Decoration.line({ class: 'cm-patch-delete' });

function rowDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const kind = ADD_ROWS.has(node.name) ? addLine : DELETE_ROWS.has(node.name) ? deleteLine : null;
        if (!kind) return;
        // A row is one line. Decorate each line it touches in case a long
        // literal holds a line break.
        let line = view.state.doc.lineAt(node.from);
        for (;;) {
          builder.add(line.from, line.from, kind);
          if (line.to >= node.to || line.number >= view.state.doc.lines) break;
          line = view.state.doc.line(line.number + 1);
        }
        return false;
      },
    });
  }
  return builder.finish();
}

const rowPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = rowDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state))
        this.decorations = rowDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const rowTheme = EditorView.baseTheme({
  '.cm-patch-add': { backgroundColor: 'var(--success-surface)' },
  '.cm-patch-delete': { backgroundColor: 'var(--danger-surface)' },
});

/** Green lines for `A` and `PA` rows, red lines for `D` and `PD` rows. */
export function patchRowColours(): Extension {
  return [rowPlugin, rowTheme];
}

/** What `usePrefixManager().abbreviateIri` returns, reduced to what is used. */
export interface IriAbbreviation {
  abbreviated: string;
  wasAbbreviated: boolean;
}

export type AbbreviateIri = (iri: string) => IriAbbreviation;

class PrefixedNameWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly iri: string,
    readonly datatype: boolean,
  ) {
    super();
  }

  eq(other: PrefixedNameWidget): boolean {
    return other.text === this.text && other.iri === this.iri && other.datatype === this.datatype;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = this.datatype ? 'cm-patch-prefixed cm-patch-prefixed-datatype' : 'cm-patch-prefixed';
    span.textContent = this.text;
    span.title = this.iri;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export interface PrefixedNameRange {
  from: number;
  to: number;
  text: string;
  iri: string;
  /** The IRI is the datatype of a literal, which the style colours as a qualifier. */
  datatype: boolean;
}

/**
 * The `<iri>` tokens to show as prefixed names, as replace decorations.
 *
 * Exported for tests, which have no view to measure.
 */
export function prefixedNameRanges(
  state: EditorView['state'],
  abbreviate: AbbreviateIri,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
): PrefixedNameRange[] {
  const out: PrefixedNameRange[] = [];
  const tree = syntaxTree(state);
  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'IRIRef') return;
        const iri = state.sliceDoc(node.from + 1, node.to - 1);
        // `<_:b0>` is a blank node, written in IRI brackets.
        if (iri.startsWith('_:')) return;
        const result = abbreviate(iri);
        if (!result.wasAbbreviated) return;
        const datatype = node.node.parent?.name === 'Datatype';
        out.push({ from: node.from, to: node.to, text: result.abbreviated, iri, datatype });
      },
    });
  }
  return out;
}

/**
 * Show each full IRI that a registered prefix covers as a prefixed name.
 *
 * The document is not changed, so selecting and copying a row copies the full
 * IRIs. The widget's tooltip is the full IRI.
 */
export function prefixedNameDisplay(abbreviate: AbbreviateIri): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const range of prefixedNameRanges(view.state, abbreviate, view.visibleRanges))
      builder.add(range.from, range.to, Decoration.replace({ widget: new PrefixedNameWidget(range.text, range.iri, range.datatype) }));
    return builder.finish();
  };

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state))
          this.decorations = build(update.view);
      }
    },
    { decorations: (p) => p.decorations },
  );

  return [
    plugin,
    EditorView.baseTheme({
      '.cm-patch-prefixed': { color: 'var(--rdf-iri)' },
      '.cm-patch-prefixed-datatype': { color: 'var(--rdf-prefix)' },
    }),
  ];
}
