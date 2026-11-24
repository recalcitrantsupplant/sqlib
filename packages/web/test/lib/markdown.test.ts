import { describe, it, expect } from 'vitest';
import { markdownTitle, renderMarkdown } from '@/lib/markdown';

describe('markdown rendering', () => {
  it('renders headings, emphasis and code', () => {
    const html = renderMarkdown('## Candidates\n\nThe **first** step uses `?asset`.');
    expect(html).toContain('<h2>Candidates</h2>');
    expect(html).toContain('<strong>first</strong>');
    expect(html).toContain('<code>?asset</code>');
  });

  it('renders lists and keeps consecutive items in one list', () => {
    const html = renderMarkdown('- one\n- two');
    expect(html).toBe('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
  });

  it('escapes markup in the source, so a cell cannot inject an element', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('refuses a javascript: link target, leaving the text as written', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('<a href');
  });

  it('keeps http and in-app link targets', () => {
    expect(renderMarkdown('[docs](https://example.org)')).toContain('<a href="https://example.org"');
    expect(renderMarkdown('[queries](/?section=queries)')).toContain('<a href="/?section=queries"');
  });

  it('takes the outline label from the first heading', () => {
    expect(markdownTitle('\n\n## Pull the neighbourhood\n\ntext')).toBe('Pull the neighbourhood');
  });

  it('takes the outline label from a leading paragraph, without its markup', () => {
    expect(markdownTitle('Reads the **HR** graph by `?name`.\n\n## Later')).toBe('Reads the HR graph by ?name.');
  });

  it('labels a cell that opens with a table by its column names', () => {
    expect(markdownTitle('| Person | Groups | Graphs |\n| --- | --- | --- |\n| Guest | | public |\n\nLater text')).toBe(
      'Person · Groups · Graphs',
    );
    expect(markdownTitle('- [ ] Check **access**')).toBe('Check access');
    expect(markdownTitle('')).toBe('Empty note');
  });

  it('renders a GFM table with empty cells and column alignment', () => {
    const html = renderMarkdown('| Person | Groups | Graphs |\n| --- | :-: | --: |\n| Guest | | public |');
    expect(html).toContain('<thead>\n<tr><th>Person</th><th style="text-align:center">Groups</th>');
    expect(html).toContain('<tr><td>Guest</td><td style="text-align:center"></td><td style="text-align:right">public</td></tr>');
  });

  it('pads a short table row and drops cells past the header', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |');
    expect(html).toContain('<tr><td>1</td><td></td></tr>');
    expect(html).toContain('<tr><td>1</td><td>2</td></tr>');
  });

  it('escapes markup inside a table cell', () => {
    const html = renderMarkdown('| a |\n| - |\n| <script>x</script> |');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders blockquotes, task lists, strikethrough and bare URLs', () => {
    const html = renderMarkdown('> quoted **text**\n\n- [x] done\n- [ ] open\n\n~~gone~~ see https://example.org');
    expect(html).toContain('<blockquote>\n<p>quoted <strong>text</strong></p>\n</blockquote>');
    expect(html).toContain('<li><input type="checkbox" disabled checked> done</li>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<a href="https://example.org"');
  });

  it('wraps items in paragraphs only when a blank line separates them', () => {
    expect(renderMarkdown('1. a\n\n2. b')).toBe('<ol>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ol>');
  });

  it('escapes fenced code and drops the fence and info string', () => {
    expect(renderMarkdown('```sparql\nSELECT * { <a> ?p ?o }\n```')).toBe(
      '<pre><code>SELECT * { &lt;a&gt; ?p ?o }</code></pre>',
    );
  });

  it('renders an image as a link to its target, so reading a cell loads nothing', () => {
    const html = renderMarkdown('![chart](https://example.org/a.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://example.org/a.png" rel="noopener noreferrer">chart</a>');
  });

  it('resolves a reference link and refuses an unsafe reference target', () => {
    expect(renderMarkdown('[docs][1]\n\n[1]: https://example.org')).toContain('<a href="https://example.org"');
    expect(renderMarkdown('[x][1]\n\n[1]: javascript:alert(1)')).not.toContain('<a href');
  });

  it('escapes an HTML block, attributes included', () => {
    const html = renderMarkdown('<div onclick="x">hi</div>');
    expect(html).not.toContain('<div');
    expect(html).toContain('&lt;div onclick=&quot;x&quot;&gt;');
  });
});
