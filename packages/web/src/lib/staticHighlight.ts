import type { Language } from '@codemirror/language';
import { highlightCode, tagHighlighter, tags as t } from '@lezer/highlight';

/**
 * Syntax highlighting for text that is shown, not edited.
 *
 * The Code tab's snippet is read and copied, never typed into, so it does not
 * need an editor: the grammar parses it once and the text is cut into spans,
 * each carrying a class for what it is. The `<pre>` keeps its exact text, which
 * is what Copy writes and what a reader selects.
 *
 * The classes are this module's own, not CodeMirror's generated ones, so plain
 * CSS can colour them. `CodeSnippetPanel.vue` maps them onto the same design
 * tokens `lib/codemirrorHighlight.ts` gives the editors, so a keyword or a
 * string reads alike in both.
 */
export interface HighlightSegment {
  text: string;
  /** Empty for text the grammar gives no role, such as spaces. */
  className: string;
}

/*
 * General-purpose code, not RDF, so identifiers stay in the ink colour. The
 * editors' style colours every variable as a SPARQL variable, which in a
 * snippet of JavaScript turns most of the text orange.
 */
export const snippetHighlighter = tagHighlighter([
  {
    tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier],
    class: 'hl-keyword',
  },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], class: 'hl-string' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], class: 'hl-literal' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'hl-comment' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'hl-function' },
  // Object keys and fields, and a shell command's `-X` style flags.
  { tag: [t.propertyName, t.attributeName], class: 'hl-property' },
  { tag: [t.typeName, t.className, t.namespace], class: 'hl-type' },
  {
    tag: [t.punctuation, t.bracket, t.paren, t.brace, t.squareBracket, t.separator, t.operator],
    class: 'hl-punct',
  },
]);

/** The text cut into spans by what the grammar says each piece is. */
export function highlightSegments(code: string, language: Language): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const push = (text: string, className: string) => {
    const last = segments[segments.length - 1];
    // Adjacent pieces with the same class are one span, not one per token.
    if (last && last.className === className) last.text += text;
    else segments.push({ text, className });
  };
  highlightCode(code, language.parser.parse(code), snippetHighlighter, push, () => push('\n', ''));
  return segments;
}
