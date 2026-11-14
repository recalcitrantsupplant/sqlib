/**
 * RDF Patch display: row colours and prefixed names over full IRIs.
 *
 * Both read node names from the tree that `rdfPatch()` builds, so these tests
 * also fail when an upstream rename stops them finding rows or IRIs.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';

import { languageExtensionsFor, prefixGrammarFor } from '../../src/lib/codeLanguage';
import { prefixedNameDisplay, prefixedNameRanges, type AbbreviateIri } from '../../src/lib/rdfPatchView';

const PATCH = [
  'H id <urn:sqlib:patch:1> .',
  'TX .',
  'PA "ex" <http://example.org/> .',
  'D <http://example.org/s> <http://example.org/p> "1"^^<http://www.w3.org/2001/XMLSchema#integer> .',
  'A <http://example.org/s> <http://example.org/p> "2"^^<http://www.w3.org/2001/XMLSchema#integer> .',
  'A _:b0 <http://other.org/p> <_:b1> .',
  'TC .',
  '',
].join('\n');

const NAMESPACES: Record<string, string> = {
  'http://example.org/': 'ex',
  'http://www.w3.org/2001/XMLSchema#': 'xsd',
};

const abbreviate: AbbreviateIri = (iri) => {
  for (const [ns, prefix] of Object.entries(NAMESPACES))
    if (iri.startsWith(ns)) return { abbreviated: `${prefix}:${iri.slice(ns.length)}`, wasAbbreviated: true };
  return { abbreviated: iri, wasAbbreviated: false };
};

function patchState(extra = [] as ReturnType<typeof prefixedNameDisplay>[]) {
  const state = EditorState.create({ doc: PATCH, extensions: [...languageExtensionsFor('text/rdf-patch'), ...extra] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

describe('the RDF Patch media types', () => {
  it('get a language, and no rewrite grammar', () => {
    for (const type of ['text/rdf-patch', 'application/rdf-patch; charset=utf-8']) {
      expect(languageExtensionsFor(type).length).toBeGreaterThan(0);
      // A rewrite would write prefixed names into A and D rows.
      expect(prefixGrammarFor(type)).toBeNull();
    }
  });
});

describe('patch rows', () => {
  function lineClasses(): Record<number, string> {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({ state: patchState(), parent });
    const out: Record<number, string> = {};
    view.contentDOM.querySelectorAll('.cm-line').forEach((line, i) => {
      const kind = line.classList.contains('cm-patch-add') ? 'add' : line.classList.contains('cm-patch-delete') ? 'delete' : '';
      if (kind) out[i + 1] = kind;
    });
    view.destroy();
    parent.remove();
    return out;
  }

  it('colours A and PA lines as additions and D lines as deletions', () => {
    expect(lineClasses()).toEqual({ 3: 'add', 4: 'delete', 5: 'add', 6: 'add' });
  });
});

describe('prefixed names over a patch', () => {
  it('abbreviates IRIs a prefix covers, and leaves blank nodes and other IRIs', () => {
    const ranges = prefixedNameRanges(patchState(), abbreviate).map(({ text, datatype }) => ({ text, datatype }));
    expect(ranges).toEqual([
      { text: 'ex:', datatype: false },
      { text: 'ex:s', datatype: false },
      { text: 'ex:p', datatype: false },
      { text: 'xsd:integer', datatype: true },
      { text: 'ex:s', datatype: false },
      { text: 'ex:p', datatype: false },
      { text: 'xsd:integer', datatype: true },
    ]);
  });

  it('shows the prefixed names and keeps the full IRIs in the document', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({ state: patchState([prefixedNameDisplay(abbreviate)]), parent });
    const shown = view.contentDOM.textContent ?? '';
    expect(shown).toContain('A ex:s ex:p "2"^^xsd:integer .');
    expect(shown).toContain('A _:b0 <http://other.org/p> <_:b1> .');
    expect(view.state.doc.toString()).toBe(PATCH);
    const widget = view.contentDOM.querySelector('.cm-patch-prefixed');
    expect(widget?.getAttribute('title')).toBe('http://example.org/');
    view.destroy();
    parent.remove();
  });
});
