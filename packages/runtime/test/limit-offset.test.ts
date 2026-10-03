import { describe, expect, it } from 'vitest';
import {
  InvalidParameterError,
  findLimitOffsetClauses,
  substituteLimitOffset,
  toExecutionParameters,
} from '../src/limit-offset.js';

const QUERY = 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 0001 OFFSET 0002';

describe('substituteLimitOffset', () => {
  it('replaces the placeholder for the named parameter', () => {
    expect(substituteLimitOffset(QUERY, [{ name: '1', value: 10 }], [{ name: '2', value: 20 }])).toBe(
      'SELECT ?s WHERE { ?s ?p ?o } LIMIT 10 OFFSET 20',
    );
  });

  it('leaves placeholders with no supplied parameter alone', () => {
    expect(substituteLimitOffset(QUERY, [{ name: '1', value: 5 }])).toBe(
      'SELECT ?s WHERE { ?s ?p ?o } LIMIT 5 OFFSET 0002',
    );
  });

  it('ignores a parameter the query does not declare', () => {
    expect(substituteLimitOffset(QUERY, [{ name: '9', value: 5 }], [])).toBe(QUERY);
  });

  it('matches the placeholder case-insensitively, as the server does', () => {
    expect(substituteLimitOffset('SELECT * { ?s ?p ?o } limit 0001', [{ name: '1', value: 3 }])).toBe(
      'SELECT * { ?s ?p ?o } LIMIT 3',
    );
  });

  it('substitutes every occurrence of a repeated placeholder', () => {
    const query = '{ SELECT * { ?s ?p ?o } LIMIT 0001 } UNION { SELECT * { ?a ?b ?c } LIMIT 0001 }';
    expect(substituteLimitOffset(query, [{ name: '1', value: 7 }])).toBe(
      '{ SELECT * { ?s ?p ?o } LIMIT 7 } UNION { SELECT * { ?a ?b ?c } LIMIT 7 }',
    );
  });

  it('leaves a placeholder in a comment, a string or an IRI alone', () => {
    const query = [
      '# LIMIT 0001 in a comment',
      'SELECT ?s WHERE { ?s <urn:p#LIMIT> "LIMIT 0001" ; <urn:q> \'\'\'OFFSET 0002\'\'\' }',
      'LIMIT 0001 OFFSET 0002',
    ].join('\n');
    expect(substituteLimitOffset(query, [{ name: '1', value: 5 }], [{ name: '2', value: 6 }])).toBe([
      '# LIMIT 0001 in a comment',
      'SELECT ?s WHERE { ?s <urn:p#LIMIT> "LIMIT 0001" ; <urn:q> \'\'\'OFFSET 0002\'\'\' }',
      'LIMIT 5 OFFSET 6',
    ].join('\n'));
  });

  describe('validation, which is the client-side substitute for re-parsing', () => {
    it('rejects a name carrying regular-expression metacharacters', () => {
      // Names were once interpolated into a RegExp, where `.*` would have
      // rewritten arbitrary text; a malformed name is still a caller error.
      expect(() => substituteLimitOffset(QUERY, [{ name: '.*', value: 1 }])).toThrow(
        InvalidParameterError,
      );
    });

    it.each([
      ['a fractional value', 1.5],
      ['a negative value', -1],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['an unsafe integer', 2 ** 53],
    ])('rejects %s', (_label, value) => {
      expect(() => substituteLimitOffset(QUERY, [{ name: '1', value }])).toThrow(
        InvalidParameterError,
      );
    });

    it('rejects a non-numeric value', () => {
      expect(() =>
        substituteLimitOffset(QUERY, [{ name: '1', value: '10' as unknown as number }]),
      ).toThrow(/value must be number/);
    });

    it('rejects a payload that is not an array', () => {
      expect(() => substituteLimitOffset(QUERY, 'nope' as never)).toThrow(InvalidParameterError);
    });
  });
});

describe('toExecutionParameters', () => {
  it('accepts the map form an app would rather write', () => {
    expect(toExecutionParameters({ page: 20 })).toEqual([{ name: 'page', value: 20 }]);
  });

  it('passes the wire array through', () => {
    expect(toExecutionParameters([{ name: '1', value: 20 }])).toEqual([{ name: '1', value: 20 }]);
  });

  it('treats an absent payload as no parameters', () => {
    expect(toExecutionParameters(undefined)).toEqual([]);
  });
});

describe('findLimitOffsetClauses', () => {
  it('finds clauses in code, with their spans and placeholder names', () => {
    const query = 'SELECT * { ?s ?p ?o } LIMIT 0001 OFFSET 20';
    expect(findLimitOffsetClauses(query)).toEqual([
      { kind: 'limit', lexeme: '0001', name: '1', start: 22, end: 32 },
      { kind: 'offset', lexeme: '20', name: null, start: 33, end: 42 },
    ]);
  });

  it('skips comments, string literals of every quoting and IRIs', () => {
    const query = [
      '# LIMIT 0001',
      'SELECT * {',
      '  ?s <http://example.org/a#b> "LIMIT 0001", \'OFFSET 0002\', """LIMIT 0003\n""" .',
      '  ?s <urn:x> "escaped \\" LIMIT 0004" .',
      '}',
    ].join('\n');
    expect(findLimitOffsetClauses(query)).toEqual([]);
  });

  it('treats a comment between keyword and value as the whitespace it is', () => {
    const query = 'SELECT * { ?s ?p ?o } LIMIT # page size\n 0001';
    expect(findLimitOffsetClauses(query).map(clause => clause.name)).toEqual(['1']);
  });

  it('does not mistake a comparison for an IRI', () => {
    const query = 'SELECT * { ?s ?p ?o FILTER(?o < 3 && ?o > 1) } LIMIT 0001';
    expect(findLimitOffsetClauses(query).map(clause => clause.name)).toEqual(['1']);
  });
});
