import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { foldable } from '@codemirror/language';
import { highlightTree, tags as t } from '@lezer/highlight';
import { HighlightStyle } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { SrlLanguage, srl } from '@/lib/srlLanguage';
import { generate, parserPath, termsPath } from '../../scripts/build-srl-parser.mjs';

const PREFIX = 'PREFIX : <http://example/>';

const parse = (text: string) => SrlLanguage.parser.parse(text);

/** Every node name in the tree, in document order. */
function names(text: string): string[] {
  const out: string[] = [];
  parse(text).iterate({
    enter(node) {
      out.push(node.name);
      return true;
    },
  });
  return out;
}

/** The nodes Lezer could not place — empty for a document the grammar reads. */
function errors(text: string): string[] {
  const out: string[] = [];
  parse(text).iterate({
    enter(node) {
      if (node.type.isError) out.push(text.slice(node.from, node.to) || '<missing>');
      return true;
    },
  });
  return out;
}

/** The text of the first node with a given name, or undefined. */
function firstNodeText(text: string, name: string): string | undefined {
  let found: SyntaxNode | null = null;
  parse(text).iterate({
    enter(node) {
      if (!found && node.name === name) found = node.node;
      return !found;
    },
  });
  return found ? text.slice((found as SyntaxNode).from, (found as SyntaxNode).to) : undefined;
}

/**
 * A highlighter that names each tag after itself, so a test can assert which
 * tag a token carries rather than which colour it ends up.
 *
 * The colours are `codemirrorHighlight.ts`'s business, and every tag below is
 * one that file already has a rule for — which is the point: the grammar reuses
 * the app's vocabulary rather than introducing one of its own.
 */
const testHighlighter = HighlightStyle.define([
  { tag: t.keyword, class: 'keyword' },
  { tag: t.bool, class: 'bool' },
  { tag: t.variableName, class: 'variableName' },
  { tag: t.namespace, class: 'namespace' },
  { tag: t.url, class: 'url' },
  { tag: t.string, class: 'string' },
  { tag: t.number, class: 'number' },
  { tag: t.annotation, class: 'annotation' },
  { tag: t.typeName, class: 'typeName' },
  { tag: t.propertyName, class: 'propertyName' },
  { tag: t.comment, class: 'comment' },
  { tag: t.brace, class: 'brace' },
  { tag: t.paren, class: 'paren' },
  { tag: t.operator, class: 'operator' },
  { tag: t.punctuation, class: 'punctuation' },
]);

/** The tags the grammar assigns, as `text -> tag` pairs. */
function highlights(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  highlightTree(parse(text), testHighlighter, (from, to, classes) => {
    out.push([text.slice(from, to), classes]);
  });
  return out;
}

const tagOf = (text: string, token: string) =>
  highlights(text).find(([slice]) => slice === token)?.[1];

describe('the SRL grammar', () => {
  it('reads a rule set the way the SRL parser does', () => {
    const text = `${PREFIX}\nRULE :r { ?s :q ?o } WHERE { ?s :p ?o }`;

    expect(errors(text)).toEqual([]);
    expect(names(text)).toEqual(
      expect.arrayContaining(['PrefixDecl', 'Rule', 'RuleKeyword', 'Block', 'WhereKeyword']),
    );
  });

  it('reads a rule with no name', () => {
    const text = `${PREFIX}\nRULE { ?s :q ?o } WHERE { ?s :p ?o }`;

    expect(errors(text)).toEqual([]);
  });

  it('reads a ground DATA block, at the top and after NOT', () => {
    const top = `${PREFIX}\nDATA { :a :p :b . }`;
    const nested = `${PREFIX}\nRULE { ?x :km ?k } WHERE { ?x :mi ?k . NOT DATA { ?x :km ?any } }`;

    expect(errors(top)).toEqual([]);
    expect(names(top)).toContain('DataBlock');
    expect(errors(nested)).toEqual([]);
    expect(names(nested)).toContain('DataBlock');
  });

  it('reads a whole-body ground match — WHERE DATA { … }', () => {
    const text = `${PREFIX}\nRULE { :x :msg "seen" } WHERE DATA { :s :p ?o }`;

    expect(errors(text)).toEqual([]);
    expect(names(text)).toContain('DataKeyword');
  });

  it('reads the SET assignment SPARQL has no operator for', () => {
    const text = `${PREFIX}\nRULE { ?x :km ?k } WHERE { ?x :mi ?m . SET ( ?k := ?m * 2 ) }`;

    expect(errors(text)).toEqual([]);
    // The trap the Chevrotain lexer documents: ':' read as an empty prefix,
    // leaving '=' behind. `:=` has to be one token.
    expect(firstNodeText(text, 'Assign')).toBe(':=');
  });

  it('reads TUPLE( … ) in a head, a body and a seed row', () => {
    const inRule = `${PREFIX}\nRULE { TUPLE( :a, 1 ) } WHERE { TUPLE( ?x, ?y ) }`;
    const seeds = `${PREFIX}\nTUPLE( :a, "b" )\nTUPLE( ?open, 2 )`;

    expect(errors(inRule)).toEqual([]);
    expect(names(inRule).filter((n) => n === 'Tuple')).toHaveLength(2);
    expect(errors(seeds)).toEqual([]);
    expect(names(seeds).filter((n) => n === 'Tuple')).toHaveLength(2);
  });

  it('reads the SPARQL a body may contain without a production for each form', () => {
    const text = [
      PREFIX,
      'RULE { ?s :q ?o } WHERE {',
      '  ?s :p ?o .',
      '  OPTIONAL { ?s :label ?l }',
      '  FILTER NOT EXISTS { ?s :hidden true }',
      '  FILTER ( ?o NOT IN ( 1, 2 ) && ?o > 0.5 )',
      '  BIND ( STRLEN( ?l ) AS ?n )',
      '  ?s a :Thing ; :note "x"@en, "y"^^<http://www.w3.org/2001/XMLSchema#string> .',
      '  ?s :parent/:name ?ancestor .',
      '  ?s :friend [ :name ?f ] .',
      '  ?s :seen _:b0 .',
      '}',
    ].join('\n');

    expect(errors(text)).toEqual([]);
  });

  it('keeps keywords case-insensitive, as SPARQL does', () => {
    const text = 'rule { ?s :q ?o } Where Data { ?s :p ?o }';

    expect(errors(text)).toEqual([]);
    expect(names(text)).toEqual(expect.arrayContaining(['Rule', 'WhereKeyword', 'DataKeyword']));
  });

  it('does not find a keyword inside a longer word', () => {
    const text = `${PREFIX}\nRULE { ?s :q ?dt } WHERE { ?s :p ?o . BIND ( datatype( ?o ) AS ?dt ) }`;

    expect(errors(text)).toEqual([]);
    // `datatype` opens with DATA. Read as a keyword plus a word it would take
    // the `DATA {` branch and drag the rest of the body into an error node.
    expect(tagOf(text, 'datatype')).toBe('keyword');
    expect(names(text)).not.toContain('DataKeyword');
    expect(names(text)).not.toContain('DataBlock');
  });

  it('does not find a keyword inside a prefixed name', () => {
    const text = 'PREFIX ex: <http://example/>\nRULE { ex:data ex:rule ex:where } WHERE { }';

    expect(errors(text)).toEqual([]);
    expect(tagOf(text, 'ex:data')).toBe('namespace');
    expect(tagOf(text, 'ex:rule')).toBe('namespace');
  });

  it('tells an IRI from a less-than', () => {
    const iri = `${PREFIX}\nRULE { ?s <http://example/q> ?o } WHERE { ?s :p ?o }`;
    const compare = `${PREFIX}\nRULE { ?s :q ?o } WHERE { ?s :p ?o . FILTER ( ?o < 3 ) }`;

    expect(tagOf(iri, '<http://example/q>')).toBe('url');
    expect(errors(compare)).toEqual([]);
    expect(tagOf(compare, '<')).toBe('operator');
  });

  it('reads no rule out of the forms SRL dropped', () => {
    /*
     * `FOR ?v IN <shape>` and `IF … THEN` were both taken out of the language
     * upstream (see packages/srl/test/groundData.test.ts), so neither may come
     * out of the editor looking like syntax it knows. `FOR` breaks the rule it
     * decorates — the clause is not part of `Rule`, so the `WHERE` after it has
     * nowhere to go — and `IF … THEN` produces no `Rule` at all, just the words
     * and braces it is written with.
     */
    expect(errors(`${PREFIX}\nRULE { :x :p :y } FOR ?this IN :Shape WHERE { }`)).not.toEqual([]);
    expect(names(`${PREFIX}\nIF { :s :p ?o } THEN { :x :q ?o }`)).not.toContain('Rule');
  });
});

describe('SRL highlighting', () => {
  const text = [
    PREFIX,
    '# a comment',
    'RULE :r { ?s :q "text"@en } WHERE { ?s :p 42 . FILTER ( ?s != true ) }',
  ].join('\n');

  it.each([
    ['RULE', 'keyword'],
    ['WHERE', 'keyword'],
    ['FILTER', 'keyword'],
    ['PREFIX', 'keyword'],
    ['?s', 'variableName'],
    [':q', 'namespace'],
    ['<http://example/>', 'url'],
    ['"text"', 'string'],
    ['@en', 'annotation'],
    ['42', 'number'],
    ['true', 'bool'],
    ['# a comment', 'comment'],
    ['{', 'brace'],
    ['(', 'paren'],
    ['!=', 'operator'],
    ['.', 'punctuation'],
  ])('tags %s as %s', (token, expected) => {
    expect(tagOf(text, token)).toBe(expected);
  });

  it('colours the block keywords the SPARQL grammar left plain', () => {
    // The whole point of the issue: `WHERE` was coloured because SPARQL shares
    // it, `RULE`, `DATA` and `TUPLE` were not.
    const doc = 'RULE { TUPLE( :a ) } WHERE DATA { }';

    for (const keyword of ['RULE', 'TUPLE', 'WHERE', 'DATA']) {
      expect(tagOf(doc, keyword)).toBe('keyword');
    }
  });

  it('still colours a document that is half typed', () => {
    const doc = `${PREFIX}\nRULE :r { ?s :q ?o } WHERE {`;

    expect(tagOf(doc, 'RULE')).toBe('keyword');
    expect(tagOf(doc, '?s')).toBe('variableName');
  });
});

describe('SRL folding', () => {
  const fold = (doc: string, line: number) => {
    const state = EditorState.create({ doc, extensions: [srl()] });
    const { from, to } = state.doc.line(line);
    return foldable(state, from, to);
  };

  it('folds a rule head and body separately, so the rule stays readable', () => {
    const doc = ['RULE :r {', '  ?s :q ?o', '} WHERE {', '  ?s :p ?o', '}'].join('\n');

    // Line 1 opens the head, line 3 opens the body.
    // The fold hides what is between the braces, leaving both in view.
    expect(fold(doc, 1)).toEqual({ from: doc.indexOf('{') + 1, to: doc.indexOf('} WHERE') });
    expect(fold(doc, 3)).not.toBeNull();
  });

  it('folds a DATA block', () => {
    const doc = ['DATA {', '  :a :p :b .', '}'].join('\n');

    expect(fold(doc, 1)).toEqual({ from: doc.indexOf('{') + 1, to: doc.lastIndexOf('}') });
  });

  it('has nothing to fold on a one-line rule', () => {
    expect(fold('RULE { :a :p :b } WHERE { }', 1)).toBeNull();
  });
});

describe('the generated parser', () => {
  /*
   * The parser tables are committed so that nothing has to run a code
   * generator before a typecheck, a test or a dev server. This is what keeps
   * "committed" from turning into "stale": edit `srl.grammar` without running
   * `pnpm build:srl-parser` and this fails.
   */
  it('matches the grammar it was generated from', () => {
    const { parser, terms } = generate();

    expect(readFileSync(parserPath, 'utf8')).toBe(parser);
    expect(readFileSync(termsPath, 'utf8')).toBe(terms);
  });
});
