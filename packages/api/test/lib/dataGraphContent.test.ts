import { describe, it, expect } from 'vitest';
import {
  DATA_GRAPH_FORMATS,
  DataGraphContentError,
  MAX_DATA_GRAPH_VERSION_BYTES,
  inspectDataGraphContent,
  rdfToNQuads,
  storeManagerFormat,
} from '../../src/lib/dataGraphContent.js';

describe('inspectDataGraphContent', () => {
  it('counts the triples a Turtle document actually parses to', () => {
    const facts = inspectDataGraphContent(
      '@prefix : <http://example.org/> . :a :edge :b . :b :edge :c .',
      'text/turtle',
    );
    expect(facts.tripleCount).toBe(2);
    expect(facts.contentFormat).toBe('text/turtle');
    expect(facts.byteSize).toBeGreaterThan(0);
  });

  it('reads N-Triples and N-Quads', () => {
    const nt = inspectDataGraphContent(
      '<http://example.org/a> <http://example.org/edge> <http://example.org/b> .',
      'application/n-triples',
    );
    expect(nt.tripleCount).toBe(1);

    const nq = inspectDataGraphContent(
      '<http://example.org/a> <http://example.org/edge> <http://example.org/b> <http://example.org/g> .',
      'application/n-quads',
    );
    expect(nq.tripleCount).toBe(1);
  });

  it('rejects content that does not parse', () => {
    expect(() => inspectDataGraphContent('this is not turtle {{{', 'text/turtle'))
      .toThrow(DataGraphContentError);
  });

  it('rejects Turtle sent as N-Triples, rather than silently storing it', () => {
    // The cost of getting this wrong is a version that saves and then fails at
    // execution time, which is the failure this parse-at-write exists to move.
    expect(() => inspectDataGraphContent('@prefix : <http://example.org/> . :a :b :c .', 'application/n-triples'))
      .toThrow(DataGraphContentError);
  });

  it('rejects an unknown format', () => {
    expect(() => inspectDataGraphContent('<a> <b> <c> .', 'application/rdf+xml'))
      .toThrow(/Unsupported data graph format/);
  });

  it('rejects empty content', () => {
    expect(() => inspectDataGraphContent('   ', 'text/turtle')).toThrow(DataGraphContentError);
  });

  it('rejects content over the per-version cap', () => {
    const filler = '<http://example.org/a> <http://example.org/p> "x" .\n';
    const oversized = filler.repeat(Math.ceil(MAX_DATA_GRAPH_VERSION_BYTES / filler.length) + 1);
    expect(() => inspectDataGraphContent(oversized, 'application/n-triples'))
      .toThrow(/over the .* limit for one version/);
  });
});

describe('rdfToNQuads', () => {
  it('expands a prefixed Turtle graph into N-Quads the comparator can read', () => {
    const nquads = rdfToNQuads('@prefix : <http://example.org/> . :a :edge :b .', 'text/turtle');
    expect(nquads.trim()).toBe('<http://example.org/a> <http://example.org/edge> <http://example.org/b> .');
  });

  it('accepts the SPARQL-style PREFIX form Turtle 1.1 allows', () => {
    // The W3C rules suite writes its expected graphs this way, so "Turtle" has
    // to mean the whole grammar rather than the `@prefix` half of it.
    const nquads = rdfToNQuads('PREFIX : <http://example.org/>\n:a :edge :b .', 'text/turtle');
    expect(nquads.trim()).toBe('<http://example.org/a> <http://example.org/edge> <http://example.org/b> .');
  });

  it('returns nothing for content that is only comments', () => {
    expect(rdfToNQuads('   ', 'text/turtle')).toBe('');
  });

  it('rejects an unknown format rather than guessing one', () => {
    expect(() => rdfToNQuads('<a> <b> <c> .', 'application/rdf+xml')).toThrow(/Unsupported RDF format/);
  });

  it('reports unparseable content as a content error', () => {
    expect(() => rdfToNQuads('not turtle {', 'text/turtle')).toThrow(DataGraphContentError);
  });
});

describe('storeManagerFormat', () => {
  it('maps every accepted format to a name the store manager knows', () => {
    // The store manager warns and falls back to Turtle for anything it does not
    // recognise, so a missed mapping would be a silent misparse, not an error.
    expect(DATA_GRAPH_FORMATS.map(storeManagerFormat)).toEqual([
      'turtle',
      'ntriples',
      'nquads',
    ]);
  });
});
