import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * The app's one syntax-highlighting style, built from design tokens.
 *
 * `assets/css/codemirror-theme.css` drives the editor *chrome* from tokens, so
 * that follows the light/dark theme. Syntax highlighting could not: CodeMirror
 * emits highlight styles under generated class names (`.ͼ1`, `.ͼ2`, …) that are
 * not stable across builds, so no CSS selector can reach them. The supported
 * route is a `HighlightStyle` extension, which is this file. See issue #35.
 *
 * **The colours are `var(--…)` references, not resolved values.** A
 * `HighlightStyle` rule is emitted as an ordinary CSS declaration, so a custom
 * property in it is resolved by the browser at paint time against whatever
 * `:root` says *now*. That makes one static style theme-aware with no
 * reactivity, no re-created editors, and no `MediaQueryList` plumbing.
 *
 * ## RDF terms carry their own colours
 *
 * `tokens.css` already names a colour per RDF term kind, and the app uses them
 * outside the editors. Mapping the term tags onto the same tokens means an IRI
 * is the same colour in an editor as it is anywhere else the app renders one —
 * which was the second half of the issue, and matters more than it sounds:
 * reading a result beside the query that produced it is the common case.
 *
 * Everything that is *not* an RDF term — keywords, comments, punctuation — uses
 * the `--syntax-*` tokens, which exist for exactly this and nothing else.
 */
export const rdfHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },

  /*
   * The RDF grammars tag every reserved word as `keyword`, built-in functions
   * included, so one entry covers all six languages. `meta`, `modifier` and
   * `operatorKeyword` cover the SQL and JSON modes the media-type viewer also
   * has to render.
   */
  {
    tag: [t.keyword, t.meta, t.modifier, t.operatorKeyword, t.definitionKeyword, t.controlKeyword],
    color: 'var(--syntax-keyword)',
  },

  /*
   * A literal is a literal whichever syntax spelled it: `"x"`, `42`, `1.5` and
   * `true` are all RDF literals, so they take the literal colour rather than a
   * separate "number" one. `atom` is kept for the other modes the media-type
   * viewer renders, which tag ground terms with it.
   */
  {
    tag: [t.string, t.number, t.integer, t.float, t.bool, t.atom, t.literal],
    color: 'var(--rdf-literal)',
  },

  /*
   * `url` is a full `<http://…>` IRI; `namespace` is a prefixed name and the
   * `PREFIX` declaration's namespace. Both denote an IRI, so both get the IRI
   * colour — a rule spelled `:rel` and one spelled `<http://ex/rel>` name the
   * same thing, and colouring them differently would suggest otherwise.
   */
  { tag: [t.url, t.namespace], color: 'var(--rdf-iri)' },

  /*
   * The de-emphasised annotations hanging off a term: the `^^<datatype>` of a
   * typed literal (tagged `typeName`) and the `@en` of a language-tagged one
   * (tagged `annotation`). Grey, like a prefix — they qualify the term rather
   * than being it.
   */
  { tag: [t.typeName, t.annotation], color: 'var(--rdf-prefix)' },

  { tag: t.variableName, color: 'var(--rdf-var)' },

  /*
   * Turtle tags blank nodes as `propertyName`, which is also what the JSON mode
   * tags object keys with — so JSON keys pick up the blank-node colour. Left
   * alone deliberately: separating them needs a highlight style per language,
   * which is a lot of machinery for a shade of violet on a key.
   */
  { tag: t.propertyName, color: 'var(--rdf-bnode)' },

  {
    tag: [t.brace, t.squareBracket, t.paren, t.separator, t.punctuation, t.operator],
    color: 'var(--syntax-punct)',
  },

  /*
   * The RDF 1.2 term delimiters: `<< … >>` around a reified triple, `<<( … )>>`
   * around a triple term, `{| … |}` around an annotation block, and the `~`
   * before a reifier.
   *
   * Each is a `special()` derivation of the ordinary bracket tag, so the rule
   * above already reaches them and this one exists to colour them *differently*.
   * That is worth a rule because the whole point of the 1.2 syntax is that what
   * sits inside the brackets is a term rather than a statement, and leaving the
   * delimiters punctuation-grey hides the only cue that says so — `:s :p :o`
   * and `<<( :s :p :o )>>` would read alike.
   *
   * Grey-blue like a datatype rather than a colour of their own: they qualify
   * the term they wrap, which is the same job `^^` and `@en` do above.
   */
  {
    tag: [t.special(t.angleBracket), t.special(t.paren), t.special(t.brace), t.special(t.operator)],
    color: 'var(--rdf-prefix)',
  },

  { tag: t.invalid, color: 'var(--danger)' },
]);

/**
 * The extension to hand an editor. Every editor in the app includes this.
 *
 * `vue-codemirror` builds its initial `EditorState` from `basicSetup` — which
 * carries `syntaxHighlighting(defaultHighlightStyle)` — and only then applies
 * the `extensions` prop through a compartment. Both highlighters therefore
 * match a token and CodeMirror concatenates their classes, leaving the winner
 * to the cascade; the rules have equal specificity, so the later-injected one
 * wins, and this style is injected second precisely because it arrives with the
 * reconfigure. That ordering is what makes it unnecessary to remove the default
 * style, which the component cannot reach anyway.
 */
export const rdfSyntaxHighlighting: Extension = syntaxHighlighting(rdfHighlightStyle);
