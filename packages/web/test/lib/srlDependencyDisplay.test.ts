import { describe, expect, it } from 'vitest';
import { compactReason, compactTerm, cycleEdgeLabel } from '@/lib/srlDependencyDisplay';

/*
 * The stratifier compares expanded IRIs, so that is what it reports. A reader
 * wrote `:p`, and a label saying `<http://example/p>` is one they have to
 * translate back before they can find it.
 */
const PREFIXES = { '': 'http://example/', ex: 'http://example.org/ns#' };

describe('compactTerm', () => {
  it('puts an IRI back in the document\'s prefixes', () => {
    expect(compactTerm('<http://example/p>', PREFIXES)).toBe(':p');
    expect(compactTerm('<http://example.org/ns#Thing>', PREFIXES)).toBe('ex:Thing');
  });

  it('leaves an IRI no prefix covers, or one whose local name needs escaping', () => {
    expect(compactTerm('<http://other/p>', PREFIXES)).toBe('<http://other/p>');
    expect(compactTerm('<http://example/a/b>', PREFIXES)).toBe('<http://example/a/b>');
  });

  it('leaves variables and plain literals alone, and compacts a datatype', () => {
    expect(compactTerm('?s', PREFIXES)).toBe('?s');
    expect(compactTerm('"ABC"', PREFIXES)).toBe('"ABC"');
    expect(compactTerm('"1"^^<http://example/t>', PREFIXES)).toBe('"1"^^:t');
  });
});

describe('cycleEdgeLabel', () => {
  const negated = compactReason(
    {
      body: { subject: '?s', predicate: '<http://example/p>', object: '"ABC"' },
      head: { subject: '<http://example/s>', predicate: '<http://example/p>', object: '"ABC"' },
      label: 'negative',
    },
    PREFIXES,
  );

  it('writes the negated pattern under NOT, then the head it matched', () => {
    expect(cycleEdgeLabel([negated])).toBe('NOT ?s :p "ABC" → :s :p "ABC"');
  });

  it('leads with the negated reason and counts the rest', () => {
    const positive = { ...negated, label: 'positive' as const };
    expect(cycleEdgeLabel([positive, negated])).toBe('NOT ?s :p "ABC" → :s :p "ABC" +1');
  });

  it('has nothing to say without a reason', () => {
    expect(cycleEdgeLabel([])).toBeNull();
    expect(cycleEdgeLabel(undefined)).toBeNull();
  });
});

describe('compactTerm inside RDF 1.2 terms', () => {
  it('shortens every IRI in a reified or triple term', () => {
    expect(compactTerm('<< <http://example/s> <http://example/p> <http://example/o> >>', PREFIXES)).toBe('<< :s :p :o >>');
    expect(compactTerm('<<( ?a <http://example/p> "x" )>>', PREFIXES)).toBe('<<( ?a :p "x" )>>');
  });

  it('writes rdf: for rdf:reifies even where the document does not declare it', () => {
    expect(compactTerm('<http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies>', PREFIXES)).toBe('rdf:reifies');
  });

  it('prefers the document\'s own prefix for the rdf namespace', () => {
    const own = { ...PREFIXES, r: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' };
    expect(compactTerm('<http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies>', own)).toBe('r:reifies');
  });

  it('leaves text inside a literal alone', () => {
    expect(compactTerm('"<http://example/p>"', PREFIXES)).toBe('"<http://example/p>"');
  });
});
