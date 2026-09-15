/**
 * The contract between this app and the published RDF grammars.
 *
 * `@kurrawongai/codemirror-lang-{turtle12,sparql12,srl}` carry their own test
 * suites, and they are thorough: 638 vendored W3C syntax cases across Turtle,
 * TriG, N-Triples, N-Quads, SPARQL 1.1/1.2 and SPARQL-RL, scored against
 * `expected-fail.json` lists that are asserted *exactly*, plus tree, editor,
 * recovery and highlight units and a Playwright suite. **None of that is
 * repeated here, and none of it should be.** Whether `syn-bad-pname-07.rq` is
 * rejected is upstream's question, and a copy of it in this repo would be a
 * slower, staler answer to it.
 *
 * What upstream's green build does not promise is that the grammars still fit
 * *us*. Two things in this app reach into the parse tree, and both fail
 * silently when they stop fitting:
 *
 *  - **Node names.** `lib/prefixRewrite.ts` finds the terms to convert by
 *    walking for `IRIRef`, `PNameLN`, `PNameNS` and the prologue nodes. A
 *    rename upstream throws nothing: the walk simply finds no terms, and the
 *    expand/contract buttons report "0 converted" on a document full of IRIs.
 *    That is indistinguishable, to the person pressing the button, from a
 *    document that had nothing to convert.
 *
 *  - **Highlight tags.** `lib/codemirrorHighlight.ts` maps tags to design
 *    tokens. A retag upstream does not throw either — the token just renders in
 *    the default colour, and nobody notices that IRIs went grey until they are
 *    reading a query and a result side by side.
 *
 * Every case below therefore asserts one of those two things and nothing about
 * the languages themselves. This is the file that fails when a version bump is
 * not a drop-in, which is the whole reason the dependency is pinned exactly:
 * these packages are pre-1.0, so a minor is a breaking channel.
 */
import { describe, it, expect } from 'vitest';
import { highlightTree, tags as t } from '@lezer/highlight';
import { HighlightStyle } from '@codemirror/language';
import type { LRParser } from '@lezer/lr';
import { turtleLanguage, trigLanguage } from '@kurrawongai/codemirror-lang-turtle12';
import { sparqlLanguage } from '@kurrawongai/codemirror-lang-sparql12';
import { srlLanguage } from '@kurrawongai/codemirror-lang-srl';

const TURTLE = turtleLanguage.parser;
const TRIG = trigLanguage.parser;
const SPARQL = sparqlLanguage.parser;
const SRL = srlLanguage.parser;

/** Every node name in a parse, deduplicated. */
function names(parser: LRParser, text: string): string[] {
  const out = new Set<string>();
  parser.parse(text).iterate({
    enter(node) {
      out.add(node.name);
      return true;
    },
  });
  return [...out];
}

/**
 * A document exercising every construct the rewrite walk cares about: a
 * declaration in each spelling, a full IRI, a prefixed name with a local part
 * and one without, and a blank node it must leave alone.
 */
const TURTLE_DOC = [
  '@prefix foaf: <http://xmlns.com/foaf/0.1/> .',
  '@base <http://example.org/> .',
  'PREFIX ex: <http://example.org/ns#>',
  'BASE <http://example.org/>',
  'ex:alice foaf:knows <http://example.org/bob> .',
  '_:b0 a foaf:Person .',
].join('\n');

const SPARQL_DOC = [
  'PREFIX foaf: <http://xmlns.com/foaf/0.1/>',
  'BASE <http://example.org/>',
  'SELECT ?s WHERE { ?s foaf:knows <http://example.org/bob> . _:b a foaf: }',
].join('\n');

describe('the node names lib/prefixRewrite.ts walks', () => {
  /*
   * The names are asserted per language rather than once, because the walk runs
   * against whichever parser `prefixGrammarFor` handed it and a name that
   * survived in Turtle but not SPARQL would break exactly half the buttons.
   *
   * Since the grammars were unified there is one spelling across all of them —
   * `IRIRef`, not the `IriRef`/`Iriref` split the previous packages had — which
   * is what makes a single set in `prefixRewrite.ts` correct.
   */
  it.each([
    ['Turtle', TURTLE, TURTLE_DOC],
    ['TriG', TRIG, TURTLE_DOC],
    ['SPARQL', SPARQL, SPARQL_DOC],
  ])('%s still names a term the way the walk looks for it', (_label, parser, doc) => {
    const found = names(parser, doc);

    expect(
      found,
      'a term node was renamed upstream. lib/prefixRewrite.ts finds nothing under the old name and ' +
        'the prefix buttons silently convert zero terms — update IRI_NODES / PREFIXED_NAME_NODES there.',
    ).toEqual(expect.arrayContaining(['IRIRef', 'PNameLN', 'PNameNS']));
  });

  it('still names every prologue form the walk must skip', () => {
    /*
     * Terms inside a declaration are the declaration, not something to rewrite:
     * miss one and expansion rewrites the namespace of a `PREFIX` line, which
     * is the one edit guaranteed to change what the document means.
     *
     * Turtle accepts four spellings and SPARQL two, so both halves are checked.
     */
    expect(names(TURTLE, TURTLE_DOC)).toEqual(
      expect.arrayContaining(['PrefixID', 'Base', 'SparqlPrefix', 'SparqlBase']),
    );
    expect(names(SPARQL, SPARQL_DOC)).toEqual(expect.arrayContaining(['PrefixDecl', 'BaseDecl']));
  });

  it('still names a blank node something other than a prefixed name', () => {
    // `_:b0` is not a prefixed name and must not expand. The grammar excludes
    // it by giving it a node of its own rather than by a rule in the walk.
    expect(names(TURTLE, TURTLE_DOC)).toContain('BlankNodeLabel');
  });
});

/**
 * A highlighter naming each tag after itself, so a case can assert which tag a
 * token carries rather than which colour it ends up — the colours are
 * `lib/codemirrorHighlight.ts`'s business.
 *
 * Every tag here is one that file has a rule for. That is the actual contract:
 * not that the grammars tag things well, but that they tag them with the
 * vocabulary this app already styles.
 */
const named = HighlightStyle.define([
  { tag: t.keyword, class: 'keyword' },
  { tag: t.url, class: 'url' },
  { tag: t.namespace, class: 'namespace' },
  { tag: t.variableName, class: 'variableName' },
  { tag: t.propertyName, class: 'propertyName' },
  { tag: t.string, class: 'string' },
  { tag: t.number, class: 'number' },
  { tag: t.bool, class: 'bool' },
  { tag: t.typeName, class: 'typeName' },
  { tag: t.annotation, class: 'annotation' },
  { tag: t.comment, class: 'comment' },
  { tag: t.special(t.angleBracket), class: 'reifiedTriple' },
  { tag: t.special(t.paren), class: 'tripleTerm' },
  { tag: t.special(t.brace), class: 'annotationBlock' },
]);

function tagOf(parser: LRParser, text: string, token: string): string | undefined {
  const out: Array<[string, string]> = [];
  highlightTree(parser.parse(text), named, (from, to, classes) => {
    out.push([text.slice(from, to), classes]);
  });
  return out.find(([slice]) => slice === token)?.[1];
}

describe('the highlight tags lib/codemirrorHighlight.ts styles', () => {
  const turtle = [
    '# note',
    '@prefix ex: <http://example.org/> .',
    'ex:s ex:p "text"@en, 42, true, "x"^^ex:dt ; ex:q <http://example.org/o> .',
    '_:b ex:r ex:s .',
  ].join('\n');

  it.each([
    ['<http://example.org/o>', 'url'],
    ['ex:p', 'namespace'],
    ['"text"', 'string'],
    ['@en', 'annotation'],
    ['42', 'number'],
    ['true', 'bool'],
    ['^^', 'typeName'],
    ['_:b', 'propertyName'],
    ['# note', 'comment'],
  ])('tags %s as %s in Turtle', (token, expected) => {
    expect(tagOf(TURTLE, turtle, token)).toBe(expected);
  });

  it('tags a SPARQL variable and keyword the way the style expects', () => {
    const doc = 'PREFIX ex: <http://example.org/>\nSELECT ?s WHERE { ?s ex:p ?o }';

    expect(tagOf(SPARQL, doc, 'SELECT')).toBe('keyword');
    expect(tagOf(SPARQL, doc, '?s')).toBe('variableName');
  });

  it('tags SRL block keywords, which is why SRL has a grammar at all', () => {
    // Issue #157: under the SPARQL grammar `WHERE` was coloured because SPARQL
    // shares it and `RULE` was not — half a signal, which reads as deliberate.
    const doc = 'RULE { ?s :q ?o } WHERE DATA { ?s :p ?o }';

    for (const keyword of ['RULE', 'WHERE', 'DATA']) {
      expect(tagOf(SRL, doc, keyword)).toBe('keyword');
    }
  });

  /*
   * The RDF 1.2 term delimiters. These are `special()` derivations, so a style
   * with no rule for them still colours them as ordinary brackets — meaning a
   * retag here would not show up as missing colour, only as the *wrong* one.
   * Hence an explicit case: `<<( … )>>` wraps a term, and a reader has to be
   * able to see that it is not a statement.
   */
  it.each([
    ['<<(', 'tripleTerm'],
    ['<<', 'reifiedTriple'],
    ['{|', 'annotationBlock'],
  ])('tags the RDF 1.2 delimiter %s as %s', (token, expected) => {
    const doc = [
      '@prefix ex: <http://example.org/> .',
      'ex:s ex:p <<( ex:a ex:b ex:c )>> .',
      '<< ex:s ex:p ex:o >> ex:q ex:r .',
      'ex:x ex:y ex:z {| ex:src ex:a |} .',
    ].join('\n');

    expect(tagOf(TURTLE, doc, token)).toBe(expected);
  });
});

describe('the grammars share one CodeMirror', () => {
  /*
   * The packages declare `@codemirror/*` as ordinary dependencies rather than
   * peers, so nothing at the package level stops a second copy of
   * `@codemirror/state` being installed beside this app's. Two copies is not a
   * subtle problem — every extension these packages build is rejected by the
   * editor with "Unrecognized extension value" — but it is a *browser* problem,
   * invisible to a unit test that only ever touches the parser.
   *
   * `Facet` identity is the cheapest proof that the module instance is shared:
   * the language extensions are built against whichever copy the package
   * resolved, so if that differs from ours these objects differ too.
   */
  it('resolves the same @codemirror/language module this app does', async () => {
    const ours = await import('@codemirror/language');
    const [turtle, sparql, srl] = await Promise.all([
      import('@kurrawongai/codemirror-lang-turtle12'),
      import('@kurrawongai/codemirror-lang-sparql12'),
      import('@kurrawongai/codemirror-lang-srl'),
    ]);

    for (const language of [turtle.turtleLanguage, sparql.sparqlLanguage, srl.srlLanguage]) {
      expect(
        language,
        'a grammar package resolved its own copy of @codemirror/language. Every editor in the app ' +
          'will refuse its extensions at runtime with "Unrecognized extension value" — dedupe the ' +
          '@codemirror/* versions.',
      ).toBeInstanceOf(ours.LRLanguage);
    }
  });
});
