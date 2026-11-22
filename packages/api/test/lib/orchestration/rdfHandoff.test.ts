import { describe, expect, it } from 'vitest';
import * as oxigraph from 'oxigraph';
import { rdfMediaTypeOf, requestedRdfFormat, writeStore } from '../../../src/lib/orchestration/rdfHandoff.js';

describe('the format of an update\'s answer graph', () => {
  it('takes the RDF syntax Accept names, else the fallback', () => {
    expect(requestedRdfFormat('application/n-quads', 'turtle')).toBe('nquads');
    expect(requestedRdfFormat('text/turtle;q=0.9', 'ntriples')).toBe('turtle');
    expect(requestedRdfFormat('*/*', 'ntriples')).toBe('ntriples');
    expect(requestedRdfFormat('application/json', 'turtle')).toBe('turtle');
    expect(requestedRdfFormat(undefined, 'turtle')).toBe('turtle');
    expect(rdfMediaTypeOf('ntriples')).toBe('application/n-triples');
  });

  it('refuses to write named graphs in a single-graph syntax, and writes them as N-Quads', () => {
    const store = new oxigraph.Store();
    store.load('<urn:a> <urn:b> <urn:c> <urn:g> .', { format: 'nq' });

    expect(() => writeStore(store, 'turtle')).toThrow(/named graph urn:g/);
    expect(writeStore(store, 'nquads')).toContain('<urn:g>');
  });
});
