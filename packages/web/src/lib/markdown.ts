/**
 * Markdown for a notebook's prose cells: CommonMark with GitHub tables,
 * strikethrough, task lists and bare-URL links, rendered safely.
 *
 * The parser is `@lezer/markdown` with its `GFM` extension. The app already
 * ships it, because `@codemirror/lang-markdown` uses it to highlight the cell
 * editor, so rendering from its tree adds no package and no bytes. This file
 * walks the tree and writes the HTML.
 *
 * Cell source is user input that lands in `v-html`, so the walker writes every
 * element itself and escapes every piece of source text it copies. Raw HTML in
 * the source (an HTML block, an inline tag, a comment) renders as escaped text.
 * Link targets are checked against a scheme allowlist, because `javascript:`
 * in a Markdown link is the one hole an escaping renderer still leaves open.
 */

import { GFM, parser } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';

const markdownParser = parser.configure(GFM);

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

/** A named or numeric character reference. It cannot contain `<`, so it passes through. */
const ENTITY = /^&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});$/i;

/** Marks whose text is syntax and never content. */
const MARKS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
  'ListMark',
  'QuoteMark',
  'TableDelimiter',
  'LinkReference',
]);

/** Link reference definitions (`[1]: https://…`), keyed by normalised label. */
type References = Map<string, string>;

function normaliseLabel(label: string): string {
  return label.replace(/^\[|\]$/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) out.push(child);
  return out;
}

class Renderer {
  constructor(
    private readonly source: string,
    private readonly references: References,
  ) {}

  private text(from: number, to: number): string {
    return this.source.slice(from, to);
  }

  /** Inline content between `from` and `to`: child nodes rendered, gaps escaped. */
  inline(node: SyntaxNode, from = node.from, to = node.to): string {
    let out = '';
    let at = from;
    for (const child of children(node)) {
      if (child.to <= from || child.from >= to) continue;
      out += escapeHtml(this.text(at, child.from));
      out += this.inlineNode(child);
      at = child.to;
    }
    return out + escapeHtml(this.text(at, to));
  }

  private inlineNode(node: SyntaxNode): string {
    switch (node.name) {
      case 'Emphasis':
        return `<em>${this.inline(node)}</em>`;
      case 'StrongEmphasis':
        return `<strong>${this.inline(node)}</strong>`;
      case 'Strikethrough':
        return `<del>${this.inline(node)}</del>`;
      case 'InlineCode': {
        const marks = children(node).filter((c) => c.name === 'CodeMark');
        const from = marks[0]?.to ?? node.from;
        const to = marks[1]?.from ?? node.to;
        return `<code>${escapeHtml(this.text(from, to).replace(/\n/g, ' '))}</code>`;
      }
      case 'Link':
      case 'Image':
        return this.link(node);
      case 'Autolink': {
        const url = node.getChild('URL');
        return url ? this.anchor(this.text(url.from, url.to), escapeHtml(this.text(url.from, url.to))) : '';
      }
      case 'URL': {
        const url = this.text(node.from, node.to);
        const href = /^www\./i.test(url) ? `https://${url}` : url;
        return this.anchor(href, escapeHtml(url));
      }
      case 'Escape':
        return escapeHtml(this.text(node.from + 1, node.to));
      case 'Entity': {
        const entity = this.text(node.from, node.to);
        return ENTITY.test(entity) ? entity : escapeHtml(entity);
      }
      case 'HardBreak':
        return '<br>';
      default:
        if (MARKS.has(node.name)) return '';
        // HTMLTag, Comment, ProcessingInstruction and anything unknown: as written, escaped.
        return escapeHtml(this.text(node.from, node.to));
    }
  }

  /** `<a>` for an allowed target. A refused target leaves the label as plain text. */
  private anchor(href: string, label: string): string {
    const safe = safeHref(href);
    return safe ? `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${label}</a>` : label;
  }

  /**
   * An inline link, a reference link or an image. An image renders as a link
   * to its target with the alt text as the label, so a cell cannot load a
   * remote resource just by being read.
   */
  private link(node: SyntaxNode): string {
    const marks = children(node).filter((c) => c.name === 'LinkMark');
    const open = marks[0];
    const close = marks.find((m) => this.text(m.from, m.to) === ']');
    const label = open && close ? this.inline(node, open.to, close.from) : '';
    const url = node.getChild('URL');
    let href: string | undefined;
    if (url) {
      href = this.text(url.from, url.to).replace(/^<|>$/g, '');
    } else {
      const ref = node.getChild('LinkLabel');
      const key = normaliseLabel(ref ? this.text(ref.from, ref.to) : this.text(open?.to ?? node.from, close?.from ?? node.to));
      href = this.references.get(key);
    }
    if (href === undefined) return escapeHtml(this.text(node.from, node.to));
    const safe = safeHref(href);
    return safe ? this.anchor(safe, label) : escapeHtml(this.text(node.from, node.to));
  }

  /** Block content: each child block on its own line. */
  blocks(node: SyntaxNode, tight = false): string {
    return children(node)
      .map((child) => this.block(child, tight))
      .filter((html) => html.length > 0)
      .join('\n');
  }

  private block(node: SyntaxNode, tight: boolean): string {
    const heading = /^(?:ATXHeading|SetextHeading)(\d)$/.exec(node.name);
    if (heading) {
      const level = heading[1];
      return `<h${level}>${this.inline(node).trim()}</h${level}>`;
    }
    switch (node.name) {
      case 'Paragraph':
        return tight ? this.inline(node).trim() : `<p>${this.inline(node).trim()}</p>`;
      case 'BulletList':
      case 'OrderedList': {
        const tag = node.name === 'BulletList' ? 'ul' : 'ol';
        const isTight = this.isTight(node);
        const start = node.name === 'OrderedList' ? this.listStart(node) : 1;
        const open = start !== 1 ? `<${tag} start="${start}">` : `<${tag}>`;
        const items = children(node)
          .filter((c) => c.name === 'ListItem')
          .map((item) => `<li>${this.blocks(item, isTight)}</li>`);
        return [open, ...items, `</${tag}>`].join('\n');
      }
      case 'Task': {
        const marker = node.getChild('TaskMarker');
        const done = marker ? /x/i.test(this.text(marker.from, marker.to)) : false;
        const box = `<input type="checkbox" disabled${done ? ' checked' : ''}>`;
        const body = this.inline(node, marker?.to ?? node.from, node.to).trim();
        return tight ? `${box} ${body}` : `<p>${box} ${body}</p>`;
      }
      case 'Blockquote':
        return `<blockquote>\n${this.blocks(node)}\n</blockquote>`;
      case 'FencedCode':
      case 'CodeBlock':
        return `<pre><code>${escapeHtml(this.codeText(node))}</code></pre>`;
      case 'HorizontalRule':
        return '<hr>';
      case 'Table':
        return this.table(node);
      case 'HTMLBlock':
      case 'CommentBlock':
      case 'ProcessingInstructionBlock':
        return `<p>${escapeHtml(this.text(node.from, node.to))}</p>`;
      default:
        if (MARKS.has(node.name)) return '';
        return `<p>${escapeHtml(this.text(node.from, node.to))}</p>`;
    }
  }

  /** The code lines of a fenced or indented block, without fences or indentation. */
  private codeText(node: SyntaxNode): string {
    const parts = children(node).filter((c) => c.name === 'CodeText');
    if (parts.length === 0) return '';
    const raw = this.text(parts[0].from, parts[parts.length - 1].to);
    if (node.name !== 'CodeBlock') return raw;
    return raw.replace(/\n(?: {1,4}|\t)/g, '\n');
  }

  /**
   * A list is loose when a blank line separates two of its items or two
   * blocks inside an item. A loose list wraps each item's text in `<p>`.
   */
  private isTight(list: SyntaxNode): boolean {
    const items = children(list).filter((c) => c.name === 'ListItem');
    for (let i = 0; i < items.length; i += 1) {
      const blocks = children(items[i]).filter((c) => c.name !== 'ListMark');
      for (let j = 1; j < blocks.length; j += 1) {
        if (/\n[ \t>]*\n/.test(this.text(blocks[j - 1].to, blocks[j].from))) return false;
      }
      if (i > 0 && /\n[ \t>]*\n/.test(this.text(items[i - 1].to, items[i].from))) return false;
    }
    return true;
  }

  private listStart(list: SyntaxNode): number {
    const mark = list.firstChild?.getChild('ListMark');
    const n = mark ? parseInt(this.text(mark.from, mark.to), 10) : 1;
    return Number.isFinite(n) ? n : 1;
  }

  /** Column alignment from the delimiter row: `:--` left, `:-:` center, `--:` right. */
  private alignments(table: SyntaxNode): Array<string | null> {
    const row = children(table).find((c) => c.name === 'TableDelimiter');
    if (!row) return [];
    return this.text(row.from, row.to)
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((spec) => {
        const s = spec.trim();
        if (s.startsWith(':') && s.endsWith(':')) return 'center';
        if (s.endsWith(':')) return 'right';
        if (s.startsWith(':')) return 'left';
        return null;
      });
  }

  /**
   * The cells of one row, empty cells included. The parser emits no node for
   * an empty cell, so cells are read as the spans between pipe delimiters.
   */
  private cells(row: SyntaxNode): string[] {
    const delimiters = children(row).filter((c) => c.name === 'TableDelimiter');
    const cells = children(row).filter((c) => c.name === 'TableCell');
    const bounds = [row.from, ...delimiters.flatMap((d) => [d.from, d.to]), row.to];
    const segments: Array<{ blank: boolean; html: string }> = [];
    for (let i = 0; i < bounds.length; i += 2) {
      const from = bounds[i];
      const to = bounds[i + 1];
      const cell = cells.find((c) => c.from >= from && c.to <= to);
      segments.push({
        blank: this.text(from, to).trim() === '',
        html: cell ? this.inline(cell).trim() : '',
      });
    }
    // A leading pipe opens the row and a trailing pipe closes it; neither starts a cell.
    if (delimiters.length > 0 && segments[0]?.blank) segments.shift();
    if (delimiters.length > 0 && segments.length > 1 && segments[segments.length - 1]?.blank) segments.pop();
    return segments.map((s) => s.html);
  }

  private table(node: SyntaxNode): string {
    const align = this.alignments(node);
    const header = node.getChild('TableHeader');
    const columns = Math.max(align.length, header ? this.cells(header).length : 0);
    const cell = (tag: 'th' | 'td', html: string, i: number) => {
      const a = align[i];
      return a ? `<${tag} style="text-align:${a}">${html}</${tag}>` : `<${tag}>${html}</${tag}>`;
    };
    const row = (tag: 'th' | 'td', cells: string[]) => {
      const fitted = Array.from({ length: columns }, (_, i) => cells[i] ?? '');
      return `<tr>${fitted.map((html, i) => cell(tag, html, i)).join('')}</tr>`;
    };
    const head = header ? `<thead>\n${row('th', this.cells(header))}\n</thead>` : '';
    const body = children(node)
      .filter((c) => c.name === 'TableRow')
      .map((r) => row('td', this.cells(r)));
    const tbody = body.length > 0 ? `\n<tbody>\n${body.join('\n')}\n</tbody>` : '';
    return `<table>\n${head}${tbody}\n</table>`;
  }
}

function parse(source: string): { root: SyntaxNode; references: References } {
  const root = markdownParser.parse(source).topNode;
  const references: References = new Map();
  for (const node of children(root)) {
    if (node.name !== 'LinkReference') continue;
    const label = node.getChild('LinkLabel');
    const url = node.getChild('URL');
    if (!label || !url) continue;
    const key = normaliseLabel(source.slice(label.from, label.to));
    if (!references.has(key)) references.set(key, source.slice(url.from, url.to).replace(/^<|>$/g, ''));
  }
  return { root, references };
}

/** Render a Markdown source to HTML. */
export function renderMarkdown(source: string): string {
  const { root, references } = parse(source);
  return new Renderer(source, references).blocks(root);
}

/** Inline HTML reduced to its text, for a one-line label. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The label for the outline rail, as plain text, from the first block that has
 * text: a heading or paragraph as written without its markup, a table's column
 * names, a task's text, or a code block's first line. A cell that opens with a
 * table gets its column names, never the raw pipes.
 */
export function markdownTitle(source: string): string {
  const { root, references } = parse(source);
  const renderer = new Renderer(source, references);

  const blockLabel = (block: SyntaxNode): string => {
    if (/^(?:ATXHeading|SetextHeading)\d$|^Paragraph$/.test(block.name)) {
      return plainText(renderer.inline(block));
    }
    if (block.name === 'Task') {
      const marker = block.getChild('TaskMarker');
      return plainText(renderer.inline(block, marker?.to ?? block.from, block.to));
    }
    if (block.name === 'Table') {
      const header = block.getChild('TableHeader');
      if (!header) return '';
      return children(header)
        .filter((c) => c.name === 'TableCell')
        .map((c) => plainText(renderer.inline(c)))
        .filter((t) => t.length > 0)
        .join(' · ');
    }
    if (block.name === 'FencedCode' || block.name === 'CodeBlock') {
      const code = block.getChild('CodeText');
      return code ? source.slice(code.from, code.to).split(/\r?\n/)[0].trim() : '';
    }
    for (const child of children(block)) {
      const text = blockLabel(child);
      if (text) return text;
    }
    return '';
  };

  const text = blockLabel(root);
  return text ? text.slice(0, 80) : 'Empty note';
}
