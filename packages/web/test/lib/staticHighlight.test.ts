import { describe, expect, it } from 'vitest';
import { loadLanguage } from '@/lib/codeLanguage';
import { highlightSegments } from '@/lib/staticHighlight';

describe('highlightSegments', () => {
  it('cuts a snippet into classed runs that join back into the same text', async () => {
    const language = await loadLanguage('text/x-python');
    expect(language).not.toBeNull();
    const code = 'import requests\n\nresponse = requests.post("u", json={"a": 1})  # call it\n';
    const segments = highlightSegments(code, language!);
    expect(segments.map((segment) => segment.text).join('')).toBe(code);
    const byClass = (name: string) => segments.filter((s) => s.className === name).map((s) => s.text);
    expect(byClass('hl-keyword')).toContain('import');
    expect(byClass('hl-string').join(' ')).toContain('"u"');
    expect(byClass('hl-comment')).toContain('# call it');
    // Identifiers are left in the ink colour.
    expect(segments.find((s) => s.text.includes('requests'))?.className ?? '').toBe('');
  });
});

describe('loadLanguage', () => {
  it('loads each snippet grammar once and answers null for anything else', async () => {
    const first = loadLanguage('text/x-go');
    expect(loadLanguage('text/x-go')).toBe(first);
    expect(await first).not.toBeNull();
    expect(await loadLanguage('text/turtle')).toBeNull();
    expect(await loadLanguage(null)).toBeNull();
  });
});
