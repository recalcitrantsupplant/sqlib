/**
 * The one place a CodeMirror grammar is chosen, and the guard that keeps it one.
 *
 * `lib/codeLanguage.ts` was written to end a duplicated mapping and its docblock
 * says so, but the sweep it describes never finished: two viewers
 * (`MediaTypeCodeViewer`, `EditableRdfViewer`) kept media-type mappings of their
 * own, and four editors plus two mockup pages imported a grammar straight. Eight
 * files, so a language was chosen in nine places and the file's own claim was
 * false.
 *
 * Two tests, and they fail for different reasons:
 *
 * 1. **The mapping is pinned**, one case per family, because it had no test at
 *    all — the copies were the only thing describing it and they disagreed.
 * 2. **The grammar packages are imported here and nowhere else in `src`.** This
 *    is the durable half: a mapping can be re-copied, and a component that
 *    imports `codemirror-lang-sparql` to say "this is SPARQL" is how the last
 *    six copies started. Asking by media type reads as a fact about the
 *    document, and means a grammar swap — the one SRL made in #157 — is an edit
 *    to one file rather than a search.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { forEachDiagnostic, forceLinting } from '@codemirror/lint';

import {
  languageExtensionsFor,
  normalizeContentType,
  prefixGrammarFor,
  type LanguageOptions,
} from '../../src/lib/codeLanguage';

const SRC = resolve(import.meta.dirname, '../../src');

/** The file that owns the choice. Every other file in `src` asks it. */
const OWNER = 'lib/codeLanguage.ts';

/**
 * The grammar packages.
 *
 * `@codemirror/language` is not here: `syntaxHighlighting` and the fold/indent
 * extensions are editor machinery every editor composes, not a statement about
 * which language a document is in.
 */
const GRAMMAR_IMPORT =
  /(?:from\s+|import\(\s*)['"](@codemirror\/lang-[\w-]+|@codemirror\/legacy-modes[\w/-]*|@kurrawongai\/codemirror-lang-[\w-]+)['"]/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(vue|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('the media type to grammar mapping', () => {
  it('drops a charset and lower-cases, so one media type is one answer', () => {
    expect(normalizeContentType('Text/Turtle; charset=utf-8')).toBe('text/turtle');
    expect(normalizeContentType(null)).toBeNull();
    expect(normalizeContentType('')).toBeNull();
  });

  /*
   * One case per family rather than per media type: what the copies got wrong
   * was whole families (neither knew SRL, SQL, or a SPARQL update), not the
   * spelling of an alias.
   */
  it.each([
    ['text/turtle'],
    ['application/trig'],
    ['application/n-triples'],
    ['application/n-quads'],
    ['application/sparql-query'],
    ['application/sparql-update'],
    ['application/srl'],
    ['text/srl'],
    ['application/sql'],
    ['text/x-sql'],
    ['application/json'],
    ['application/ld+json'],
    ['application/sparql-results+json'],
    ['application/xml'],
    ['application/rdf+xml'],
    ['application/atom+xml'],
  ])('answers for %s', (type) => {
    expect(languageExtensionsFor(type).length).toBeGreaterThan(0);
  });

  it('answers with nothing for a type it does not know, rather than guessing', () => {
    /*
     * The file's own rule, and the reason `MediaTypeCodeViewer`'s
     * `application/javascript -> json()` branch did not survive the merge:
     * plain text with no highlighting reads correctly, whereas JSON rules over
     * a document that is not JSON colour half of it wrong and look like a parse
     * error. JavaScript is the case that makes the difference visible — an
     * unquoted key or a comment is legal there and a JSON error.
     */
    expect(languageExtensionsFor('application/javascript')).toEqual([]);
    expect(languageExtensionsFor('text/csv')).toEqual([]);
    expect(languageExtensionsFor(undefined)).toEqual([]);
  });

  it('offers a rewrite grammar only where the walk can read one', () => {
    // Deliberately narrower than the highlighting: highlighting may be
    // approximate, a rewrite may not. The stream-mode formats build no tree,
    // and a language whose grammar is only *close* gets none — which is what
    // SRL used to be, before it had one of its own.
    expect(prefixGrammarFor('text/turtle')).not.toBeNull();
    expect(prefixGrammarFor('application/sparql-query')).not.toBeNull();
    expect(prefixGrammarFor('application/srl')).not.toBeNull();
    expect(prefixGrammarFor('application/n-triples')).toBeNull();
    expect(prefixGrammarFor('application/n-quads')).toBeNull();
  });
});

describe('the grammar packages', () => {
  it('are imported by one file in src, and it is the one that answers for them', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => GRAMMAR_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).replace(/\\/g, '/'))
      .filter((file) => file !== OWNER);

    expect(
      offenders,
      'a CodeMirror grammar is imported outside lib/codeLanguage.ts. A component that knows its ' +
        'own language should ask for it by media type — languageExtensionsFor(\'application/srl\') ' +
        'rather than srl() — so the grammar behind a language is named in one place.',
    ).toEqual([]);
  });
});

/**
 * The SPARQL habits an SRL editor offers to fix.
 *
 * `@kurrawongai/codemirror-lang-srl` 0.3.0 reports the SPARQL forms that are
 * not SRL and, given `sparqlConversions`, attaches the edit that fixes each
 * one. The flag is the whole feature as far as this app is concerned, and it
 * is a boolean threaded through two files, so nothing below asserts *which*
 * forms the grammar knows — that is upstream's suite. What is asserted is that
 * the flag arrives: with it off the editor underlines and says nothing useful,
 * with it on the same underline carries a fix that, applied, leaves a document
 * the grammar accepts.
 *
 * That last clause is the one worth the DOM: an action whose replacement text
 * is wrong still looks like a working button, and the only way to see it is to
 * press it and lint again.
 */
const PASTED_SPARQL = [
  'PREFIX : <http://example/>',
  '',
  'RULE { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) FILTER(BOUND(?x)) }',
].join('\n');

interface SeenDiagnostic {
  message: string;
  actions: Array<{ name: string; apply: (view: EditorView) => void; from: number; to: number }>;
}

/** An SRL editor holding `doc`, with the linter already run. */
async function lintedSrlEditor(doc: string, options: LanguageOptions = {}) {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: languageExtensionsFor('application/srl', options) }),
    parent: document.body,
  });
  const lint = async (): Promise<SeenDiagnostic[]> => {
    forceLinting(view);
    // The linter answers in a promise, so the diagnostics land a tick later.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const found: SeenDiagnostic[] = [];
    forEachDiagnostic(view.state, (diagnostic, from, to) => {
      found.push({
        message: diagnostic.message,
        actions: (diagnostic.actions ?? []).map((action) => ({ ...action, from, to })),
      });
    });
    return found;
  };
  return { view, lint };
}

describe('an SRL editor offered SPARQL', () => {
  it('names the SRL spelling and offers the edit when conversions are on', async () => {
    const { view, lint } = await lintedSrlEditor(PASTED_SPARQL, { sparqlConversions: true });
    try {
      const [diagnostic, ...rest] = await lint();

      expect(rest).toEqual([]);
      expect(diagnostic.message).toMatch(/SET/);
      expect(diagnostic.actions.map((action) => action.name)).toEqual([
        'Convert SPARQL BIND to SRL SET',
      ]);

      diagnostic.actions[0].apply(view);

      expect(view.state.doc.toString()).toContain('SET ( ?x := ?o + 1 )');
      // The point of the button: pressing it leaves a rule set, not a second error.
      expect(await lint()).toEqual([]);
    } finally {
      view.destroy();
    }
  });

  it('still underlines it with conversions off, but offers nothing it cannot do', async () => {
    /*
     * The default, and what the read-only SRL viewers get: the conformance
     * check is not optional — a `BIND` in a rule body is an error whoever is
     * looking — but an offer to rewrite a document nobody can type in is an
     * offer that does nothing when taken.
     */
    const { view, lint } = await lintedSrlEditor(PASTED_SPARQL);
    try {
      const found = await lint();

      expect(found).toHaveLength(1);
      expect(found[0].actions).toEqual([]);
    } finally {
      view.destroy();
    }
  });
});
