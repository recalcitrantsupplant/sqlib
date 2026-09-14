/**
 * Judging a tuple set against one VALUES clause.
 *
 * The verdict is what decides whether a row in the picker is clickable, so a
 * wrong answer here is either rows you cannot reach or rows that bind nothing
 * when the query runs. The cases below are the ones that matter: names match,
 * names do not, arity differs, and the two partial shapes.
 */
import { describe, it, expect } from 'vitest';
import { tupleSetFit } from '@/lib/argumentSignature';
import { readTupleDocument, cellText, cellAnnotation } from '@/types/tuple-sets';

describe('tupleSetFit', () => {
  it('fits when the columns are exactly the clause variables', () => {
    expect(tupleSetFit(['city', 'population'], ['city', 'population'])).toEqual({
      verdict: 'fits',
      reason: '',
    });
  });

  it('fits regardless of column order — a clause is a set, not a sequence', () => {
    expect(tupleSetFit(['city', 'population'], ['population', 'city']).verdict).toBe('fits');
  });

  it('ignores a leading question mark on either side', () => {
    expect(tupleSetFit(['?city'], ['city']).verdict).toBe('fits');
    expect(tupleSetFit(['city'], ['?city']).verdict).toBe('fits');
  });

  it('is partial when the set carries columns the clause does not declare', () => {
    const fit = tupleSetFit(['city'], ['city', 'population']);
    expect(fit.verdict).toBe('partial');
    expect(fit.reason).toContain('1 column unused');
  });

  it('is partial when a clause variable is missing, and names it', () => {
    // A row that omits a variable binds UNDEF, which is legal — that variable
    // is simply left unconstrained.
    const fit = tupleSetFit(['city', 'population'], ['city']);
    expect(fit.verdict).toBe('partial');
    expect(fit.reason).toContain('?population unbound');
  });

  it('mismatches on same-width column names that have nothing in common', () => {
    const fit = tupleSetFit(['city'], ['country']);
    expect(fit.verdict).toBe('mismatch');
    expect(fit.reason).toBe('no column names in common');
  });

  it('mismatches on differing width, and says the widths', () => {
    const fit = tupleSetFit(['city', 'population'], ['a', 'b', 'c']);
    expect(fit.verdict).toBe('mismatch');
    expect(fit.reason).toBe('arity 3 ≠ 2');
  });

  it('mismatches an empty set of columns', () => {
    expect(tupleSetFit(['city'], []).verdict).toBe('mismatch');
  });

  it('mismatches a clause with no variables', () => {
    expect(tupleSetFit([], ['city']).verdict).toBe('mismatch');
  });
});

describe('readTupleDocument', () => {
  const document = JSON.stringify({
    head: { vars: ['city', 'population'] },
    results: {
      bindings: [
        { city: { type: 'literal', value: 'Paris' }, population: { type: 'literal', value: '2161000', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } },
        // No `population` key: UNDEF, which is an absent key rather than "".
        { city: { type: 'literal', value: 'Lisbon' } },
      ],
    },
  });

  it('reads columns and rows out of a stored document', () => {
    const parsed = readTupleDocument(document);
    expect(parsed.columns).toEqual(['city', 'population']);
    expect(parsed.rows).toHaveLength(2);
  });

  it('strips a leading question mark from head.vars', () => {
    const parsed = readTupleDocument('{"head":{"vars":["?city"]},"results":{"bindings":[]}}');
    expect(parsed.columns).toEqual(['city']);
  });

  it('is total: unparseable content is an empty table, not a throw', () => {
    expect(readTupleDocument('not json')).toEqual({ columns: [], rows: [] });
    expect(readTupleDocument('')).toEqual({ columns: [], rows: [] });
    expect(readTupleDocument(null)).toEqual({ columns: [], rows: [] });
  });

  it('reads an absent binding as empty rather than inventing a value', () => {
    const { rows } = readTupleDocument(document);
    expect(cellText(rows[0], 'city')).toBe('Paris');
    expect(cellText(rows[1], 'population')).toBe('');
  });

  it('annotates a cell by what kind of term it is', () => {
    const { rows } = readTupleDocument(document);
    expect(cellAnnotation(rows[0].population)).toBe('integer');
    expect(cellAnnotation(rows[0].city)).toBe('');
    expect(cellAnnotation({ type: 'uri', value: 'http://example.org/Paris' })).toBe('uri');
    expect(cellAnnotation({ type: 'literal', value: 'Paris', 'xml:lang': 'fr' })).toBe('@fr');
    expect(cellAnnotation(undefined)).toBe('');
  });
});
