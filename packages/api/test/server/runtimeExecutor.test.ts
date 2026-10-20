import { describe, expect, it } from 'vitest';
import * as oxigraph from 'oxigraph';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';
import { toRuntimeExecutor } from '../../src/server/runtimeExecutor.js';
import type { ISparqlExecutor } from '../../src/server/ISparqlExecutor.js';

const DATA = `
<http://example.org/alice> <http://example.org/livesIn> <http://example.org/Perth> .
<http://example.org/bob> <http://example.org/livesIn> <http://example.org/Hobart> .
`;

function seeded() {
  const store = new oxigraph.Store();
  store.load(DATA, { format: 'application/n-triples' });
  return { store, executor: toRuntimeExecutor(new OxigraphSparqlExecutor(store)) };
}

describe('toRuntimeExecutor over the Oxigraph executor', () => {
  it('returns SELECT as SPARQL Results JSON', async () => {
    const { executor } = seeded();
    const result = await executor.execute({
      queryText: 'SELECT ?who WHERE { ?who <http://example.org/livesIn> <http://example.org/Perth> }',
      queryType: 'SELECT',
    });
    expect(result).toMatchObject({
      head: { vars: ['who'] },
      results: { bindings: [{ who: { type: 'uri', value: 'http://example.org/alice' } }] },
    });
  });

  it('returns ASK as SPARQL Results JSON with a boolean', async () => {
    const { executor } = seeded();
    const result = await executor.execute({ queryText: 'ASK { ?s ?p <http://example.org/Hobart> }', queryType: 'ASK' });
    expect(result).toEqual({ head: {}, boolean: true });
  });

  it('returns CONSTRUCT as an RDF payload', async () => {
    const { executor } = seeded();
    const result = await executor.execute({
      queryText: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      queryType: 'CONSTRUCT',
    });
    expect(result).toMatchObject({ contentType: 'text/turtle' });
    expect((result as { data: string }).data).toContain('<http://example.org/alice>');
  });

  it('runs an update against the same store', async () => {
    const { store, executor } = seeded();
    await executor.update({
      updateText: 'INSERT DATA { <http://example.org/cara> <http://example.org/livesIn> <http://example.org/Perth> }',
    });
    expect(store.size).toBe(3);
  });

  it('refuses an update whose signal has already aborted', async () => {
    const { store, executor } = seeded();
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(executor.update({ updateText: 'CLEAR ALL', signal: controller.signal })).rejects.toThrow('stop');
    expect(store.size).toBe(2);
  });
});

describe('toRuntimeExecutor over an executor that answers with text', () => {
  const textual = (body: string): ISparqlExecutor => ({
    selectQueryParsed: async () => ({ result: body, duration: 0 }),
    askQuery: async () => ({ result: body, duration: 0 }),
    constructQueryParsed: async () => ({ result: body, duration: 0 }),
    selectQueryStream: async () => { throw new Error('unused'); },
    constructQueryStream: async () => { throw new Error('unused'); },
    update: async () => ({ result: undefined, duration: 0 }),
  });

  it('parses SELECT results that arrived as JSON text', async () => {
    const body = JSON.stringify({ head: { vars: ['x'] }, results: { bindings: [] } });
    const result = await toRuntimeExecutor(textual(body)).execute({ queryText: 'SELECT * {}', queryType: 'SELECT' });
    expect(result).toEqual({ head: { vars: ['x'] }, results: { bindings: [] } });
  });

  it('parses an ASK boolean that arrived as JSON text', async () => {
    const result = await toRuntimeExecutor(textual('{"head":{},"boolean":false}'))
      .execute({ queryText: 'ASK {}', queryType: 'ASK' });
    expect(result).toEqual({ head: {}, boolean: false });
  });

  it('refuses text that is not SPARQL Results JSON', async () => {
    await expect(
      toRuntimeExecutor(textual('<html>busy</html>')).execute({ queryText: 'SELECT * {}', queryType: 'SELECT' }),
    ).rejects.toThrow('not SPARQL Results JSON');
  });

  it('falls back to the requested serialisation when CONSTRUCT reports no content type', async () => {
    const result = await toRuntimeExecutor(textual('<a> <b> <c> .'), { rdfAccept: 'application/n-triples' })
      .execute({ queryText: 'CONSTRUCT {} WHERE {}', queryType: 'CONSTRUCT' });
    expect(result).toEqual({ contentType: 'application/n-triples', data: '<a> <b> <c> .' });
  });
});
