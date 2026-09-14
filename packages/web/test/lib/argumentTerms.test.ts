import { describe, it, expect } from 'vitest';
import { inferTerm, parsePastedRows, termToSparql, termTypeLabel } from '@/lib/argumentTerms';

describe('inferTerm', () => {
  it('reads an IRI as an IRI, bracketed or bare', () => {
    expect(inferTerm('<http://example.org/a>')).toEqual({ type: 'uri', value: 'http://example.org/a' });
    expect(inferTerm('http://example.org/a')).toEqual({ type: 'uri', value: 'http://example.org/a' });
    expect(inferTerm('ex:Alice')).toEqual({ type: 'uri', value: 'ex:Alice' });
  });

  it('types numbers and booleans, and leaves prose alone', () => {
    expect(inferTerm('42').datatype).toBe('http://www.w3.org/2001/XMLSchema#integer');
    expect(inferTerm('-1.5').datatype).toBe('http://www.w3.org/2001/XMLSchema#decimal');
    expect(inferTerm('TRUE')).toEqual({
      type: 'literal',
      value: 'true',
      datatype: 'http://www.w3.org/2001/XMLSchema#boolean',
    });
    expect(inferTerm('New South Wales')).toEqual({ type: 'literal', value: 'New South Wales' });
  });

  it('leaves an empty cell as the blank IRI a new row carries — that is UNDEF', () => {
    expect(inferTerm('   ')).toEqual({ type: 'uri', value: '' });
  });
});

describe('termToSparql', () => {
  it('writes each term the way the clause will carry it', () => {
    expect(termToSparql({ type: 'uri', value: 'http://example.org/a' })).toBe('<http://example.org/a>');
    expect(termToSparql({ type: 'literal', value: 'hi', 'xml:lang': 'en' })).toBe('"hi"@en');
    expect(
      termToSparql({ type: 'literal', value: '2', datatype: 'http://www.w3.org/2001/XMLSchema#integer' }),
    ).toBe('"2"^^xsd:integer');
    expect(termToSparql({ type: 'literal', value: '2', datatype: 'http://example.org/dt' })).toBe(
      '"2"^^<http://example.org/dt>',
    );
    expect(termToSparql({ type: 'literal', value: 'say "hi"' })).toBe('"say \\"hi\\""');
    expect(termToSparql({ type: 'uri', value: '' })).toBe('UNDEF');
  });
});

describe('termTypeLabel', () => {
  it('names a datatype outside the common list by its last segment', () => {
    expect(termTypeLabel({ type: 'literal', value: 'x', datatype: 'http://example.org/dt' })).toBe('dt');
    expect(termTypeLabel({ type: 'literal', value: 'x' })).toBe('Lit');
    expect(termTypeLabel({ type: 'uri', value: 'x' })).toBe('IRI');
  });
});

describe('parsePastedRows', () => {
  it('takes tabs first and commas after, and drops the trailing newline', () => {
    expect(parsePastedRows('a\tb\nc\td\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parsePastedRows('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});
