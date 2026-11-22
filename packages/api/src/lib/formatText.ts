/**
 * Format SPARQL and SRL text with the formatter the web editors use.
 *
 * The formatter comes from `@kurrawongai/codemirror-lang-sparql12` and
 * `@kurrawongai/codemirror-lang-srl`. It changes only the whitespace between
 * tokens, so comments, `a`, literals, prefixes, block order and the
 * `LIMIT 000<n>` / `VALUES … { UNDEF }` parameter forms stay as written.
 *
 * The web app calls the same functions with the same options
 * (`packages/web/src/lib/codeLanguage.ts`), and both packages pin the same
 * version. `POST /format`, MCP `detection_format` and the editors' Format
 * button therefore give the same text for the same input.
 */
import { formatSparql } from '@kurrawongai/codemirror-lang-sparql12';
import { formatSrl } from '@kurrawongai/codemirror-lang-srl';

export type FormatLanguage = 'sparql' | 'srl';

/** The 1-based line and column of an offset in `text`. */
function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

/**
 * Format `text` as SPARQL or SRL.
 *
 * SPARQL is parsed with the `LATERAL` dialect on, because sqlib's own parser
 * accepts `LATERAL` (`packages/compiler/src/sparql12.ts`).
 *
 * @throws Error with the line and column of the first parse error.
 */
export function formatText(text: string, language: FormatLanguage): string {
  const result = language === 'srl' ? formatSrl(text) : formatSparql(text, { lateral: true });
  if (result.error) {
    const { line, column } = position(text, result.error.from);
    throw new Error(`Parse error at line ${line}, column ${column}`);
  }
  return result.text;
}
