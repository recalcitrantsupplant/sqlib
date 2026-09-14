import { describe, it, expect } from 'vitest';
import { SNIPPET_LANGUAGES, renderSnippet, type SnippetRequest } from '@/lib/codeSnippets';

const executeRequest: SnippetRequest = {
  method: 'POST',
  url: 'https://api.sqlib.io/v1/execute',
  body: { targetId: 'urn:example:query:1', arguments: [{ head: { vars: ['country'] } }] },
};

describe('renderSnippet', () => {
  it('renders every advertised language', () => {
    for (const language of SNIPPET_LANGUAGES) {
      const snippet = renderSnippet(language.id, executeRequest);
      expect(snippet, language.id).not.toBe('');
      expect(snippet, language.id).toContain('https://api.sqlib.io/v1/execute');
    }
  });

  /*
   * The whole point of the tab: what is on screen is what the caller sends. A
   * snippet that drops the arguments would run a different query from the one
   * the Run button just ran.
   */
  it('carries the request body into each snippet', () => {
    for (const language of SNIPPET_LANGUAGES) {
      expect(renderSnippet(language.id, executeRequest), language.id).toContain(
        'urn:example:query:1',
      );
    }
  });

  it('never inlines a token', () => {
    for (const language of SNIPPET_LANGUAGES) {
      const snippet = renderSnippet(language.id, executeRequest);
      expect(snippet, language.id).toContain('SQLIB_TOKEN');
    }
  });

  it('leaves no dangling continuation on a bodyless cURL call', () => {
    const snippet = renderSnippet('curl', {
      method: 'GET',
      url: 'https://api.sqlib.io/v1/queries/1',
    });
    expect(snippet.endsWith('\\')).toBe(false);
    expect(snippet).not.toContain('-d ');
    expect(snippet).not.toContain('Content-Type');
  });

  it('adds extra headers where the language puts headers', () => {
    const request: SnippetRequest = {
      ...executeRequest,
      headers: { Accept: 'text/csv' },
    };
    for (const language of SNIPPET_LANGUAGES) {
      expect(renderSnippet(language.id, request), language.id).toContain('text/csv');
    }
  });

  it('emits valid JSON in the cURL body', () => {
    const snippet = renderSnippet('curl', executeRequest);
    const body = snippet.slice(snippet.indexOf("-d '") + 4, snippet.lastIndexOf("'"));
    expect(JSON.parse(body)).toEqual(executeRequest.body);
  });
});
