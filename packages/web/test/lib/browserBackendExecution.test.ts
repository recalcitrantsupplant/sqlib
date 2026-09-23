/**
 * Running against a browser backend: the transport choices, and the error a
 * visitor actually sees when their endpoint will not talk to a web page.
 */
import { describe, it, expect, vi } from 'vitest';
import { SparqlEndpointError } from '@sparql-query-lib/runtime';
import {
  executeOnBrowserBackend,
  looksLikeUpdate,
  BrowserBackendUnreachableError,
} from '../../src/lib/browserBackendExecution';
import type { BrowserBackend } from '../../src/composables/useBrowserBackends';

const backend: BrowserBackend = {
  id: 'urn:sqlib:browser-backend:x',
  name: 'Local',
  description: null,
  endpoint: 'https://example.org/sparql',
  queryMethod: null,
  headers: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function ok(body: string, contentType = 'application/sparql-results+json') {
  return vi.fn(async () =>
    new Response(body, { status: 200, headers: { 'content-type': contentType } })
  );
}

describe('spotting an update without a parser', () => {
  it('sees past comments and the prologue', () => {
    expect(looksLikeUpdate('# a note\nPREFIX e: <http://e/>\nINSERT DATA { e:s e:p e:o }')).toBe(true);
    expect(looksLikeUpdate('PREFIX e: <http://e/>\nSELECT ?s WHERE { ?s ?p ?o }')).toBe(false);
  });

  it('does not mistake a SELECT that mentions a verb in a literal', () => {
    expect(looksLikeUpdate('SELECT ?s WHERE { ?s ?p "DELETE" }')).toBe(false);
  });
});

describe('choosing a request shape', () => {
  it('sends a short read as GET, so it stays cacheable and skips preflight', async () => {
    const fetchImpl = ok('{"head":{"vars":[]},"results":{"bindings":[]}}');
    await executeOnBrowserBackend(
      { backend, query: 'SELECT ?s WHERE { ?s ?p ?o }', operation: 'query' },
      fetchImpl
    );
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(init!.method).toBe('GET');
    expect(String(url)).toContain('query=');
  });

  it('sends a long read as POST', async () => {
    const fetchImpl = ok('{}');
    await executeOnBrowserBackend(
      { backend, query: `SELECT ?s WHERE { ?s ?p "${'x'.repeat(2000)}" }`, operation: 'query' },
      fetchImpl
    );
    expect(fetchImpl.mock.calls[0]![1]!.method).toBe('POST');
  });

  it('honours an explicit GET preference', async () => {
    const fetchImpl = ok('{}');
    await executeOnBrowserBackend(
      { backend: { ...backend, queryMethod: 'get' }, query: 'SELECT 1', operation: 'query' },
      fetchImpl
    );
    expect(fetchImpl.mock.calls[0]![1]!.method).toBe('GET');
  });

  it('always POSTs an update, with the update content type', async () => {
    const fetchImpl = ok('');
    await executeOnBrowserBackend(
      { backend: { ...backend, queryMethod: 'get' }, query: 'INSERT DATA { <a:s> <a:p> <a:o> }' },
      fetchImpl
    );
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/sparql-update');
  });

  it('asks for the media type the results panel wants', async () => {
    const fetchImpl = ok('a,b\n1,2', 'text/csv');
    await executeOnBrowserBackend(
      { backend, query: 'SELECT 1', acceptMediaType: 'text/csv', operation: 'query' },
      fetchImpl
    );
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Accept).toBe('text/csv');
  });

  it('sends the visitor headers to the endpoint', async () => {
    const fetchImpl = ok('{}');
    await executeOnBrowserBackend(
      {
        backend: { ...backend, headers: { Authorization: 'Bearer secret' } },
        query: 'SELECT 1',
        operation: 'query',
      },
      fetchImpl
    );
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });
});

describe('what comes back', () => {
  it('is the endpoint\'s own bytes, not a re-serialisation', async () => {
    // Whitespace and key order survive, which they would not through a parse.
    const raw = '{"head": {"vars": ["s"]},\n "results": {"bindings": []}}';
    const result = await executeOnBrowserBackend(
      { backend, query: 'SELECT 1', operation: 'query' },
      ok(raw)
    );
    expect(result.body).toBe(raw);
    expect(result.contentType).toBe('application/sparql-results+json');
  });

  it('reports the run as client time, there being no server leg', async () => {
    const result = await executeOnBrowserBackend(
      { backend, query: 'SELECT 1', operation: 'query' },
      ok('{}')
    );
    expect(result.timing.breakdown.clientTotalMs).toBeGreaterThanOrEqual(0);
  });
});

describe('when it goes wrong', () => {
  it('names CORS when the browser refuses the request', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      executeOnBrowserBackend({ backend, query: 'SELECT 1', operation: 'query' }, fetchImpl)
    ).rejects.toBeInstanceOf(BrowserBackendUnreachableError);

    const error = await executeOnBrowserBackend(
      { backend, query: 'SELECT 1', operation: 'query' },
      fetchImpl
    ).catch((e: unknown) => e as Error);
    expect(error.message).toContain('CORS');
    expect(error.message).toContain('example.org');
  });

  it('passes an abort through as the caller\'s own doing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      executeOnBrowserBackend({ backend, query: 'SELECT 1', operation: 'query' }, fetchImpl)
    ).rejects.toBeInstanceOf(DOMException);
  });

  it('raises the runtime\'s endpoint error for a non-2xx, carrying the body', async () => {
    const fetchImpl = vi.fn(async () => new Response('malformed query', { status: 400 }));
    const error = await executeOnBrowserBackend(
      { backend, query: 'SELECT 1', operation: 'query' },
      fetchImpl
    ).catch((e: unknown) => e as SparqlEndpointError);
    expect(error).toBeInstanceOf(SparqlEndpointError);
    expect(error.status).toBe(400);
    expect(error.body).toContain('malformed query');
  });
});
