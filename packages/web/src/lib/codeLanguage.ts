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
import { StreamLanguage } from '@codemirror/language';
import type { PrefixGrammar } from '@/lib/prefixRewrite';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { turtle, TurtleLanguage } from 'codemirror-lang-turtle';
import { sparql, SparqlLanguage } from 'codemirror-lang-sparql';
import { srl } from '@/lib/srlLanguage';
import { turtle as legacyTurtle } from '@codemirror/legacy-modes/mode/turtle';

/**
 * N-Triples and N-Quads are Turtle's line-based subset, and the Lezer Turtle
 * grammar rejects them outright; the legacy stream mode is lenient enough to
 * colour them.
 */
const turtleStream = StreamLanguage.define(legacyTurtle);

/** `text/turtle; charset=utf-8` and `text/turtle` are the same language. */
export function normalizeContentType(contentType?: string | null): string | null {
  if (!contentType) return null;
  const [type] = contentType.split(';');
  return type.trim().toLowerCase() || null;
}

/**
 * The language extensions for a media type, or none when it is unknown.
 *
 * An unknown type gets an empty array rather than a guess: plain text with no
 * highlighting reads correctly, whereas Turtle rules applied to something that
 * is not Turtle colours half the document wrong and looks like a parse error.
 */
export function languageExtensionsFor(contentType?: string | null): Extension[] {
  const type = normalizeContentType(contentType);
  if (!type) return [];

  if (type === 'text/turtle' || type === 'application/trig') return [turtle()];
  if (type === 'application/n-triples' || type === 'application/n-quads') return [turtleStream];
  if (type === 'application/sparql-query' || type === 'application/sparql-update') return [sparql()];
  /*
   * SRL has a grammar of its own (`lib/srlLanguage`), which is what tells its
   * block keywords from SPARQL's and what makes a rule foldable. It used to
   * borrow the SPARQL grammar, which coloured `WHERE` and not `RULE` — see
   * issue #157.
   */
  if (type === 'application/srl' || type === 'text/srl') return [srl()];
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

  if (type === 'text/turtle' || type === 'application/trig') return TurtleLanguage.parser;
  if (type === 'application/sparql-query' || type === 'application/sparql-update') {
    return SparqlLanguage.parser;
  }

  return null;
}
