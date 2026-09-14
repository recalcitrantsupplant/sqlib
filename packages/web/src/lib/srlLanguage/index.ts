/**
 * SRL as a CodeMirror language.
 *
 * The rules work area used to build its editor from `codemirror-lang-sparql`,
 * which reads correctly for the body of a rule — SRL and SPARQL share terms,
 * prefixed names, literals and comments — and reads nothing at all for what
 * makes the document SRL. `RULE`, `DATA` and `TUPLE(…)` came out unhighlighted
 * while `WHERE`, being a SPARQL keyword too, came out coloured: half a signal,
 * which is worse than none because it looks deliberate. See issue #157.
 *
 * What a grammar of our own buys, beyond colouring those keywords:
 *
 *  - **Folding.** `Block` is a real node, so `foldNodeProp` folds a rule's head
 *    and body — and every nested group — with no help from the server-side
 *    analysis, which is where block spans came from until now.
 *  - **Indentation.** `}` and `)` line up under what opened them.
 *  - **Structure to walk.** The tree names the pieces of a document
 *    (`Rule`, `DataBlock`, `Tuple`), which is what a future inline-diagnostics
 *    or outline feature needs and what a stream mode could never give.
 *
 * It tracks current CodeMirror deliberately: `codemirror-lang-turtle` pins
 * 6.11 and blocks the CM bumps (#63), and a mode of ours should not inherit
 * that pin.
 */
import {
  LRLanguage,
  LanguageSupport,
  delimitedIndent,
  foldInside,
  foldNodeProp,
  indentNodeProp,
} from '@codemirror/language';
import { styleTags, tags as t } from '@lezer/highlight';
import { parser } from './parser.generated';

export const SrlLanguage = LRLanguage.define({
  name: 'srl',
  parser: parser.configure({
    props: [
      /*
       * The tags the app's `rdfHighlightStyle` already understands, so an IRI
       * is the same colour in a rule as it is in a query, a result table or a
       * data graph. Nothing here needs a style rule of its own.
       */
      styleTags({
        'RuleKeyword WhereKeyword DataKeyword TupleKeyword PrefixKeyword BaseKeyword Keyword':
          t.keyword,
        Boolean: t.bool,
        Var: t.variableName,
        IRIRef: t.url,
        PrefixedName: t.namespace,
        BlankNodeLabel: t.propertyName,
        String: t.string,
        Number: t.number,
        LangTag: t.annotation,
        DatatypeMark: t.typeName,
        LineComment: t.lineComment,
        'Assign Operator': t.operator,
        '{ }': t.brace,
        '( )': t.paren,
        '[ ]': t.squareBracket,
        '. , ;': t.punctuation,
      }),
      /*
       * Folding hangs off the bracketed nodes rather than off `Rule`: folding a
       * rule to one line hides which rule it is, whereas folding its head and
       * its body separately leaves `RULE :r { … } WHERE { … }` readable.
       */
      foldNodeProp.add({
        Block: foldInside,
        Paren: foldInside,
        Bracket: foldInside,
      }),
      indentNodeProp.add({
        Block: delimitedIndent({ closing: '}' }),
        Paren: delimitedIndent({ closing: ')' }),
        Bracket: delimitedIndent({ closing: ']' }),
      }),
    ],
  }),
  languageData: {
    commentTokens: { line: '#' },
    /*
     * `<` is in the list because an IRI is the term you type most often in a
     * rule; `'` is not, because it opens a string far less often than it
     * appears inside one as an apostrophe.
     */
    closeBrackets: { brackets: ['(', '[', '{', '<', '"'] },
    indentOnInput: /^\s*[})\]]$/,
  },
});

/**
 * The extension to hand an editor holding SRL.
 *
 * The seed-tuples strip takes the same one: a row of `TUPLE( … )` with an
 * optional prologue above it is a subset of what a rule set may contain, so a
 * second grammar would differ from this only in what it rejects — and
 * rejection is `POST /rule-sets/srl/analyze`'s job, not the highlighter's.
 */
export function srl(): LanguageSupport {
  return new LanguageSupport(SrlLanguage);
}
