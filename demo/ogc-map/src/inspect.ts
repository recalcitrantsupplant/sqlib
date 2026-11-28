/**
 * The right-hand panel: the SPARQL that ran for the selected collection's
 * page, and the GeoJSON it returned, each in a read-only CodeMirror view.
 */
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { sparql } from '@kurrawongai/codemirror-lang-sparql12';

type Tab = 'query' | 'result';

const CAPTIONS: Record<Tab, string> = {
  query: 'The SPARQL that ran for this page.',
  result: 'The GeoJSON that this page returned.',
};
const LANGUAGES: Record<Tab, () => Extension> = {
  query: () => sparql({ lateral: true }),
  result: () => json(),
};

let tab: Tab = 'query';
let texts: Record<Tab, string> = { query: '', result: '' };
let view: EditorView | null = null;

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function render(): void {
  for (const name of ['query', 'result'] as const) $(`tab-${name}`).setAttribute('aria-selected', String(name === tab));
  $('inspect-caption').textContent = CAPTIONS[tab];
  const state = EditorState.create({
    doc: texts[tab],
    extensions: [
      LANGUAGES[tab](),
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
    ],
  });
  if (view) view.setState(state);
  else view = new EditorView({ state, parent: $('inspect-code') });
}

export function initInspect(hasQuery: boolean): void {
  $('tab-query').hidden = !hasQuery;
  if (!hasQuery) tab = 'result';
  for (const name of ['query', 'result'] as const) {
    $(`tab-${name}`).onclick = () => {
      tab = name;
      render();
    };
  }
}

/** Show a page's query and result. Null hides the panel. */
export function showInspect(content: { query: string | null; result: unknown } | null): void {
  const panel = $('inspect');
  panel.hidden = content === null;
  document.body.classList.toggle('inspecting', content !== null);
  if (!content) return;
  texts = { query: content.query ?? '', result: content.result === null ? '' : JSON.stringify(content.result, null, 2) };
  render();
}
