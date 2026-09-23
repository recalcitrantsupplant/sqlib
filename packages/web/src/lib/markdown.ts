/**
 * The small Markdown a notebook's prose cells need, rendered safely.
 *
 * A dependency was weighed and turned down: the app renders prose in exactly
 * one place, the subset that place needs is headings, emphasis, code, links and
 * lists, and a parser shipped to every visitor to cover reference-style link
 * definitions and setext headings is weight with no reader behind it.
 *
 * The safety rule is the one that matters, because cell source is user input
 * that lands in `v-html`: **escape first, mark up second**. Every `<` in the
 * source is gone before a single tag is emitted, so no input can produce an
 * element this file did not write. Link targets are then checked against a
 * scheme allowlist — `javascript:` in a Markdown link is the one hole an
 * escape-first renderer still leaves open.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** `http`, `https`, `mailto` and in-app paths. Everything else renders as text. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[/#]/.test(trimmed)) return trimmed;
  return null;
}

/** Inline marks, applied to already-escaped text. */
function renderInline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) => {
      const safe = safeHref(href);
      return safe ? `<a href="${safe}" rel="noopener noreferrer">${label}</a>` : whole;
    });
}

/**
 * Render a Markdown source to HTML.
 *
 * Block handling is a single pass over the lines, which is all this subset
 * needs: fenced code, ATX headings, unordered and ordered lists, blockquotes,
 * and everything else as paragraphs split on blank lines.
 */
export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source).split(/\r?\n/);
  const out: string[] = [];
  let paragraph: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;
  let fenced: string[] | null = null;

  const closeParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listTag) return;
    out.push(`</${listTag}>`);
    listTag = null;
  };

  for (const line of lines) {
    if (fenced) {
      if (line.trimStart().startsWith('```')) {
        out.push(`<pre><code>${fenced.join('\n')}</code></pre>`);
        fenced = null;
      } else {
        fenced.push(line);
      }
      continue;
    }

    if (line.trimStart().startsWith('```')) {
      closeParagraph();
      closeList();
      fenced = [];
      continue;
    }

    if (line.trim().length === 0) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      closeParagraph();
      const wanted = bullet ? 'ul' : 'ol';
      if (listTag !== wanted) {
        closeList();
        out.push(`<${wanted}>`);
        listTag = wanted;
      }
      out.push(`<li>${renderInline((bullet ?? ordered)![1])}</li>`);
      continue;
    }

    const quote = /^\s*&gt;\s?(.*)$/.exec(line);
    if (quote) {
      closeParagraph();
      closeList();
      out.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  if (fenced) out.push(`<pre><code>${fenced.join('\n')}</code></pre>`);
  closeParagraph();
  closeList();
  return out.join('\n');
}

/** The first heading or line, for the outline rail. */
export function markdownTitle(source: string): string {
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const heading = /^#{1,4}\s+(.*)$/.exec(trimmed);
    return (heading ? heading[1] : trimmed).slice(0, 80);
  }
  return 'Empty note';
}
