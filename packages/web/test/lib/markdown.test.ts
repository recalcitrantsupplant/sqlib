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
});
