/**
 * Which CodeMirror language a media type wants.
 *
 * The app renders the same handful of serialisations in half a dozen places —
 * a data graph's Turtle, a query's SPARQL, an argument set's JSON, a result
 * document's XML — and each viewer had grown its own copy of this mapping.
 * One copy means a new format is taught once, and that Turtle looks like
 * Turtle whether you are reading it in a test, a rule set or a response pane.
 *
 * That paragraph was a statement of intent for a while rather than of fact: two
 * viewers kept mappings of their own and four editors imported a grammar
 * straight, so a language was chosen in seven places and this one. The rule is
 * now closed and `test/lib/codeLanguage.test.ts` holds it: **the grammar
 * packages are imported here and nowhere else in `src`.** A component that
 * knows its own language asks for it by media type, which reads as a fact about
 * the document rather than as a package name, and means a grammar swap — the
 * one SRL made in #157 — is an edit to this file rather than a search.
 *
 * Deliberately *not* a theme or a keymap: chrome comes from
 * `assets/css/codemirror-theme.css` and highlighting from
 * `lib/codemirrorHighlight.ts`, both driven by the same design tokens. This
 * file answers one question and returns extensions that answer nothing else.
 */
import type { Extension } from '@codemirror/state';
import type { PrefixGrammar } from '@/lib/prefixRewrite';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import {
  turtle,
  trig,
  ntriples,
  nquads,
  turtleLanguage,
  trigLanguage,
} from '@kurrawongai/codemirror-lang-turtle12';
import { sparql, sparqlLanguage } from '@kurrawongai/codemirror-lang-sparql12';
import { srl } from '@kurrawongai/codemirror-lang-srl';

/** `text/turtle; charset=utf-8` and `text/turtle` are the same language. */
export function normalizeContentType(contentType?: string | null): string | null {
  if (!contentType) return null;
  const [type] = contentType.split(';');
  return type.trim().toLowerCase() || null;
}

/**
 * Options a caller may need to pass to the language behind a media type.
 *
 * Deliberately not a grammar object: a component still names its language by
 * media type, and this carries only the facts about the *document* that the
 * media type cannot express.
 */
export interface LanguageOptions {
  /**
   * Whether the SRL rule-tuples extension is in play, mirroring the `tuples`
   * flag the same document is parsed with server-side.
   *
   * `TUPLE( … )` is not in SPARQL-RL — it is sqlib's extension — so a rule set
   * is only allowed to use it when the work area's tuples toggle is on. This
   * does **not** change what parses: the grammar always reads `TUPLE( … )`,
   * because a grammar with two shapes can disagree with itself and because an
   * editor that simply stops colouring `TUPLE` tells the author nothing about
   * why. What it changes is the *advice* — with `tuples: false` the completion
   * list stops offering `TUPLE`, matching `parseRuleSet(text, { tuples })`.
   *
   * `@kurrawongai/codemirror-lang-srl` also exports `tupleRanges(state)`, which
   * hands back the spans to raise a diagnostic on when the flag is off.
   */
  tuples?: boolean;
}

/**
 * The language extensions for a media type, or none when it is unknown.
 *
 * An unknown type gets an empty array rather than a guess: plain text with no
 * highlighting reads correctly, whereas Turtle rules applied to something that
 * is not Turtle colours half the document wrong and looks like a parse error.
 */
export function languageExtensionsFor(
  contentType?: string | null,
  options: LanguageOptions = {},
): Extension[] {
  const type = normalizeContentType(contentType);
  if (!type) return [];

  if (type === 'text/turtle') return [turtle()];
  /*
   * TriG is not Turtle in a lenient mood: it is Turtle plus named graphs, and
   * borrowing the Turtle entry point for it (which this file did until the
   * grammars moved to `@kurrawongai/codemirror-lang-turtle12`) colours a `GRAPH`
   * block as a parse error. Each of the four dialects has its own entry point
   * for the same reason the package gives them one — a strict subset that is
   * coloured as valid Turtle is lying about the file it will write.
   */
  if (type === 'application/trig') return [trig()];
  if (type === 'application/n-triples') return [ntriples()];
  if (type === 'application/n-quads') return [nquads()];
  if (type === 'application/sparql-query' || type === 'application/sparql-update') return [sparql()];
  /*
   * SRL has a grammar of its own — `@kurrawongai/codemirror-lang-srl`, which is
   * the SPARQL 1.2 grammar entered at `SrlUnit` rather than a second grammar,
   * so the two cannot drift apart about what a term is. It is what tells SRL's
   * block keywords from SPARQL's and what makes a rule foldable. It used to
   * borrow the SPARQL grammar, which coloured `WHERE` and not `RULE` — see
   * issue #157.
   */
  if (type === 'application/srl' || type === 'text/srl') {
    /*
     * `sparqlConversions` raises no new error. The package's conformance linter
     * runs either way — a `BIND` in a rule body is invalid SRL whatever this
     * flag says — and what the flag changes is what the author is told about it:
     * with it off the diagnostic reads `Syntax error.`, and with it on it names
     * the equivalence and carries a one-click rewrite. Three spellings have one:
     * `BIND(e AS ?v)` → `SET (?v := e)`, `FILTER NOT EXISTS { … }` → `NOT { … }`,
     * and a `CONSTRUCT` / `INSERT` opening → `RULE` / `DATA`.
     *
     * Those are the three ways someone writes SPARQL into an SRL editor out of
     * habit, so this turns the most common red squiggle in the editor from a
     * dead end into a fix. It is safe to turn on because each rewrite is local
     * to a span the linter has *already* marked invalid — it cannot take a
     * document from valid to invalid.
     *
     * That locality is also why it settles nothing about the import and export
     * dialogs. The same package exports whole-document `sparqlToSrl` /
     * `srlToSparql`, and they are tempting for the same reason (no round trip),
     * but they decide a different set from `@sparql-query-lib/srl` — in three
     * cases they accept a query the server refuses, including a head variable
     * the body never binds. So those stay on `/srl/from-sparql` and
     * `/srl/compile`. The divergence is enumerated and pinned in
     * `packages/srl/test/editorConversionParity.test.ts`.
     */
    return [srl({ tuples: options.tuples ?? true, sparqlConversions: true })];
  }
  /*
   * DuckDB SQL: an ETL job's source query, and the fixture a test supplies for
   * it. `text/x-sql` is the spelling CodeMirror's own mode registry uses and
   * `application/sql` the one RFC 6922 registers; both reach the same grammar
   * because a caller should not have to know which of the two this file
   * preferred.
   */
  if (type === 'application/sql' || type === 'text/x-sql') return [sql()];
  if (type === 'application/ld+json' || type === 'application/json' || type.endsWith('+json')) return [json()];
  if (type === 'application/rdf+xml' || type === 'application/xml' || type.endsWith('+xml')) return [xml()];

  return [];
}

/**
 * The grammar to rewrite a document's prefixes with, or none.
 *
 * Deliberately narrower than `languageExtensionsFor`, and not derived from it:
 * highlighting may be approximate, a rewrite may not. N-Triples and N-Quads are
 * coloured by a stream mode, which builds no tree to walk, and they have no
 * prefix mechanism to convert to in the first place. SRL is the newer case: it
 * has a grammar of its own now, so the reason it is absent here is no longer
 * "no grammar" but the node names `prefixRewrite` walks, which that file
 * records.
 *
 * So this answers only for languages whose grammar this walk can read. A
 * language that returns null gets no prefix buttons, which is the honest
 * result until it can be rewritten safely.
 */
export function prefixGrammarFor(contentType?: string | null): PrefixGrammar | null {
  const type = normalizeContentType(contentType);
  if (!type) return null;

  if (type === 'text/turtle') return turtleLanguage.parser;
  /*
   * TriG's own parser, not Turtle's: a rewrite may not be approximate, and the
   * Turtle grammar reads a `GRAPH` block as an error, so every term inside one
   * would be invisible to the walk and silently left unconverted.
   */
  if (type === 'application/trig') return trigLanguage.parser;
  if (type === 'application/sparql-query' || type === 'application/sparql-update') {
    return sparqlLanguage.parser;
  }

  return null;
}
