import { describe, expect, it, vi } from 'vitest';
import { SparqlEndpointError, httpExecutor } from '../src/executor.js';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/sparql-results+json' },
    ...init,
  });
}

const SELECT = { queryText: 'SELECT * { ?s ?p ?o }', queryType: 'SELECT' as const };

describe('httpExecutor', () => {
  it('sends a short read as GET, so it can be cached and skips preflight', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ head: {}, results: { bindings: [] } }));
    await httpExecutor('https://example.org/sparql', { fetch: fetchMock }).execute(SELECT);

    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('GET');
    expect(url).toBe(
      `https://example.org/sparql?query=${encodeURIComponent(SELECT.queryText)}`,
    );
    expect(init.headers.Accept).toBe('application/sparql-results+json');
  });

  it('switches to POST once the URL would grow too long', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ head: {}, results: { bindings: [] } }));
    const queryText = `SELECT * { ?s ?p "${'x'.repeat(4000)}" }`;
    await httpExecutor('https://example.org/sparql', { fetch: fetchMock }).execute({
      queryText,
      queryType: 'SELECT',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.org/sparql');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/sparql-query');
    expect(init.body).toBe(queryText);
  });

  it('appends the query to an endpoint that already carries a querystring', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ head: {}, results: { bindings: [] } }));
    await httpExecutor('https://example.org/sparql?dataset=main', { fetch: fetchMock }).execute(SELECT);
    expect(fetchMock.mock.calls[0][0]).toContain('?dataset=main&query=');
  });

  it('asks for RDF when the query constructs, and returns it unparsed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<urn:a> <urn:b> <urn:c> .', {
        status: 200,
        headers: { 'content-type': 'text/turtle' },
      }),
    );
    const result = await httpExecutor('https://example.org/sparql', { fetch: fetchMock }).execute({
      queryText: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      queryType: 'CONSTRUCT',
    });

    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe('text/turtle');
    expect(result).toEqual({ contentType: 'text/turtle', data: '<urn:a> <urn:b> <urn:c> .' });
  });

  it('merges caller headers over the computed Accept', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ head: {}, boolean: true }));
    await httpExecutor('https://example.org/sparql', {
      fetch: fetchMock,
      headers: { Authorization: 'Bearer t' },
    }).execute({ queryText: 'ASK { ?s ?p ?o }', queryType: 'ASK' });

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Accept: 'application/sparql-results+json',
      Authorization: 'Bearer t',
    });
  });

  it('carries the endpoint status and body on failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('parse error at line 3', { status: 400, statusText: 'Bad Request' }));

    await expect(
      httpExecutor('https://example.org/sparql', { fetch: fetchMock }).execute(SELECT),
    ).rejects.toMatchObject({
      name: 'SparqlEndpointError',
      status: 400,
      body: 'parse error at line 3',
    });
  });

  it('forwards an abort signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ head: {}, results: { bindings: [] } }));
    const controller = new AbortController();
    await httpExecutor('https://example.org/sparql', { fetch: fetchMock }).execute({
      ...SELECT,
      signal: controller.signal,
    });
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('fails at construction when the supplied fetch is not callable', () => {
    expect(() =>
      httpExecutor('https://example.org/sparql', { fetch: {} as never }),
    ).toThrow(/No fetch implementation/);
  });

  it('reports a SPARQL endpoint error as its own type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    const error = await httpExecutor('https://example.org/sparql', { fetch: fetchMock })
      .execute(SELECT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SparqlEndpointError);
  });
});
