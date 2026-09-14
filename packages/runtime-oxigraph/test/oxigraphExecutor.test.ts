import { describe, expect, it } from 'vitest';
import { fromBundle, hashTemplateText, iri, type ExportBundle } from '@sparql-query-lib/runtime';
import { oxigraphExecutor } from '../src/index.js';

const DATA = `
@prefix ex: <http://example.org/> .
ex:alice ex:livesIn ex:Perth ; ex:name "Alice" .
ex:bob   ex:livesIn ex:Perth ; ex:name "Bob" .
ex:carol ex:livesIn ex:Darwin ; ex:name "Carol" .
`;

/**
 * A bundle written the way `sqlib export` writes one, but by hand: this package
 * must not depend on the API, so the template's spans are computed from the text
 * rather than compiled by the parser.
 */
async function bundle(): Promise<ExportBundle> {
  const before = 'PREFIX ex: <http://example.org/>\nSELECT ?name WHERE {\n  ';
  const slot = 'VALUES ?city { UNDEF }';
  const after = '\n  ?person ex:livesIn ?city ; ex:name ?name .\n}';
  const text = before + slot + after;

  return {
    version: 1,
    library: { id: 'urn:sqlib:library:test' },
    queries: {
      'people-by-city': {
        template: {
          text,
          slots: [{ start: before.length, end: before.length + slot.length, vars: ['city'] }],
          prefixes: [['ex', 'http://example.org/']],
        },
        queryType: 'SELECT',
        limitParameters: [],
        offsetParameters: [],
        inferredInputs: [['city']],
        textHash: await hashTemplateText(text),
      },
    },
  };
}

describe('oxigraphExecutor', () => {
  it('answers a parameterised SELECT with no endpoint anywhere', async () => {
    const executor = await oxigraphExecutor({ data: DATA });
    const lib = fromBundle(await bundle(), { executor });

    const results = await lib.query('people-by-city').select({
      arguments: [{ bindings: [{ city: iri('http://example.org/Perth') }] }],
    });

    expect(results.results.bindings.map((row) => row.name.value).sort()).toEqual(['Alice', 'Bob']);
  });

  it('returns SPARQL Results JSON, the same shape the HTTP executor returns', async () => {
    const executor = await oxigraphExecutor({ data: DATA });
    const results = await executor.execute({
      queryText: 'SELECT ?s WHERE { ?s <http://example.org/name> "Alice" }',
      queryType: 'SELECT',
    });

    expect(results).toEqual({
      head: { vars: ['s'] },
      results: { bindings: [{ s: { type: 'uri', value: 'http://example.org/alice' } }] },
    });
  });

  it('unwraps an ASK to a boolean through the runtime', async () => {
    const executor = await oxigraphExecutor({ data: DATA });
    const result = await executor.execute({
      queryText: 'ASK { ?s <http://example.org/livesIn> <http://example.org/Perth> }',
      queryType: 'ASK',
    });
    expect(result).toMatchObject({ boolean: true });
  });

  it('serialises CONSTRUCT results as RDF', async () => {
    const executor = await oxigraphExecutor({ data: DATA });
    const result = (await executor.execute({
      queryText:
        'CONSTRUCT { ?s <http://example.org/in> ?c } WHERE { ?s <http://example.org/livesIn> ?c }',
      queryType: 'CONSTRUCT',
    })) as { contentType: string; data: string };

    expect(result.contentType).toBe('text/turtle');
    expect(result.data).toContain('http://example.org/in');
  });

  it('honours a requested RDF serialisation', async () => {
    const executor = await oxigraphExecutor({ data: DATA, rdfFormat: 'application/n-triples' });
    const result = (await executor.execute({
      queryText: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      queryType: 'CONSTRUCT',
    })) as { contentType: string; data: string };

    expect(result.contentType).toBe('application/n-triples');
    expect(result.data.trim().split('\n')[0]).toMatch(/^<http:\/\/example\.org\/\w+> </);
  });

  it('loads several documents, in the formats they are given in', async () => {
    const executor = await oxigraphExecutor({
      data: [
        { content: DATA },
        {
          content: '<http://example.org/dave> <http://example.org/name> "Dave" .',
          format: 'application/n-triples',
        },
      ],
    });
    expect(executor.store.size).toBe(7);
  });

  it('queries a store handed to it, rather than making its own', async () => {
    const seeded = await oxigraphExecutor({ data: DATA });
    const borrower = await oxigraphExecutor({ store: seeded.store });
    expect(borrower.store).toBe(seeded.store);

    const result = await borrower.execute({
      queryText: 'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }',
      queryType: 'SELECT',
    });
    expect((result as { results: { bindings: Array<{ n: { value: string } }> } }).results.bindings[0].n.value).toBe('6');
  });

  it('starts empty when given no data, which is a query against nothing', async () => {
    const executor = await oxigraphExecutor();
    expect(executor.store.size).toBe(0);
    const result = await executor.execute({
      queryText: 'SELECT * WHERE { ?s ?p ?o }',
      queryType: 'SELECT',
    });
    expect((result as { results: { bindings: unknown[] } }).results.bindings).toEqual([]);
  });

  it('substitutes exactly as the endpoint path does, since only the transport differs', async () => {
    const loaded = await bundle();
    const executor = await oxigraphExecutor({ data: DATA });

    const local = fromBundle(loaded, { executor }).query('people-by-city');
    const remote = fromBundle(loaded).query('people-by-city');
    const payload = { arguments: [{ bindings: [{ city: iri('http://example.org/Darwin') }] }] };

    expect(local.text(payload)).toBe(remote.text(payload));
  });
});
