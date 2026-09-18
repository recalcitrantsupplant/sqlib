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
 * Three tests, and they fail for different reasons:
 *
 * 1. **The mapping is pinned**, one case per family, because it had no test at
 *    all — the copies were the only thing describing it and they disagreed.
 * 2. **The options the mapping passes are pinned too.** A media type chooses a
 *    grammar *and how it is configured*, and the configuration is the half that
 *    disappears silently: `sparqlConversions` is one word, and dropping it
 *    leaves a working editor that has quietly stopped offering its quick fixes.
 * 3. **The grammar packages are imported here and nowhere else in `src`.** This
 *    is the durable half: a mapping can be re-copied, and a component that
 *    imports `codemirror-lang-sparql` to say "this is SPARQL" is how the last
 *    six copies started. Asking by media type reads as a fact about the
 *    document, and means a grammar swap — the one SRL made in #157 — is an edit
 *    to one file rather than a search.
 */

import { describe, it, expect } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { forceLinting, forEachDiagnostic } from '@codemirror/lint';
import { srl } from '@kurrawongai/codemirror-lang-srl';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { languageExtensionsFor, normalizeContentType, prefixGrammarFor } from '../../src/lib/codeLanguage';

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
  /from\s+['"](@codemirror\/lang-[\w-]+|@kurrawongai\/codemirror-lang-[\w-]+)['"]/;

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
    // approximate, a rewrite may not. The stream-mode formats build no tree.
    expect(prefixGrammarFor('text/turtle')).not.toBeNull();
    expect(prefixGrammarFor('application/sparql-query')).not.toBeNull();
    expect(prefixGrammarFor('application/n-triples')).toBeNull();
    expect(prefixGrammarFor('application/srl')).toBeNull();
  });
});

/**
 * The SRL editor's conversion quick fixes, which are off by default upstream.
 *
 * `srl({ sparqlConversions: true })` adds no diagnostic — the package's
 * conformance linter flags a SPARQL `BIND` in a rule body either way — so a
 * count of errors cannot tell the two configurations apart and this asserts the
 * thing that actually differs: the *action* hung off the error, and the message
 * that comes with it. With the flag off the author gets `Syntax error.` and no
 * way forward; with it on they get the reason and a one-click rewrite to `SET`.
 *
 * Worth a mounted view rather than a shallower check because the flag is a
 * single word in `codeLanguage.ts` that nothing else would miss if it were
 * dropped in a version bump — which is exactly how it would be dropped.
 */
describe('SRL conversion quick fixes', () => {
  const DOC = [
    'PREFIX : <http://example/>',
    'RULE { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) FILTER(BOUND(?x)) }',
  ].join('\n');

  /** Every diagnostic the extensions raise on DOC, with its action names. */
  async function lint(extensions: Extension[]) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions }),
      parent,
    });
    forceLinting(view);
    // The lint source is async; one macrotask is enough for a parsed document.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const found: { message: string; actions: string[] }[] = [];
    forEachDiagnostic(view.state, (d) => {
      found.push({ message: d.message, actions: (d.actions ?? []).map((a) => a.name) });
    });
    view.destroy();
    parent.remove();
    return found;
  }

  it('offers the BIND → SET rewrite in an SRL editor', async () => {
    expect(await lint(languageExtensionsFor('application/srl'))).toEqual([
      {
        message: 'This SPARQL BIND with FILTER(BOUND(...)) is equivalent to SRL SET.',
        actions: ['Convert SPARQL BIND to SRL SET'],
      },
    ]);
  });

  it('is an opt-in the app makes, not the package default', async () => {
    // The contrast, so this test fails if upstream flips the default rather
    // than quietly passing for a new reason. The error is raised either way —
    // what the option buys is the explanation and the fix.
    expect(await lint([srl()])).toEqual([{ message: 'Syntax error.', actions: [] }]);
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
