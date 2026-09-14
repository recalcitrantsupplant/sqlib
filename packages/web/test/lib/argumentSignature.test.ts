import { describe, it, expect } from 'vitest';
import {
  bareVariable,
  buildQuerySignature,
  clauseKey,
  compatibility,
  locateValuesClauses,
  pruneUndef,
  summariseRow,
  tupleSignature,
} from '@/lib/argumentSignature';
import type { ArgumentTupleBinding } from '@/types/argument-sets';

const binding = (variables: string[], rows = 1): ArgumentTupleBinding => ({
  tupleSignature: tupleSignature(variables),
  variables,
  rows: Array.from({ length: rows }, () => ({
    values: Object.fromEntries(variables.map((name) => [name, { type: 'uri' as const, value: 'x' }])),
  })),
});

describe('clause identity', () => {
  it('strips the question mark wherever it comes from', () => {
    expect(bareVariable('?city')).toBe('city');
    expect(bareVariable('city')).toBe('city');
  });

  it('keys a clause by its variables, order-insensitively', () => {
    expect(clauseKey(['?postcode', 'state'])).toBe(clauseKey(['state', '?postcode']));
  });

  it('keeps the stored signature order-sensitive, unlike the key', () => {
    expect(tupleSignature(['?postcode', '?state'])).toBe('postcode|state');
    expect(tupleSignature(['?state', '?postcode'])).toBe('state|postcode');
  });
});

describe('locateValuesClauses', () => {
  const query = [
    'PREFIX ex: <http://example.org/>',
    'SELECT * WHERE {',
    '  VALUES ?city { "Perth" }',
    '  VALUES (?postcode ?state) { ("6000" "WA") }',
    '}',
  ].join('\n');

  it('puts each clause on the line it was written', () => {
    const clauses = locateValuesClauses(query, [['city'], ['postcode', 'state']]);
    expect(clauses.map((c) => c.line)).toEqual([3, 4]);
  });

  it('matches by variables rather than order of detection', () => {
    const clauses = locateValuesClauses(query, [['state', 'postcode'], ['city']]);
    expect(clauses.map((c) => c.line)).toEqual([4, 3]);
  });

  it('gives two clauses over the same variables different lines', () => {
    const repeated = 'VALUES ?city { "a" }\nVALUES ?city { "b" }';
    expect(locateValuesClauses(repeated, [['city'], ['city']]).map((c) => c.line)).toEqual([1, 2]);
  });

  it('leaves the line undefined rather than guessing', () => {
    expect(locateValuesClauses('SELECT * WHERE { ?s ?p ?o }', [['city']])[0].line).toBeUndefined();
  });

  it('builds a signature without a line when there is no text to scan', () => {
    const signature = buildQuerySignature(
      { valuesInputs: [['?city']], limitParameters: ['pageSize'], offsetParameters: [] },
      null,
    );
    expect(signature.clauses).toEqual([{ variables: ['city'] }]);
    expect(signature.limitParameters).toEqual(['pageSize']);
  });
});

describe('compatibility', () => {
  const signature = buildQuerySignature(
    { valuesInputs: [['city'], ['postcode', 'state']] },
    null,
  );

  it('fits when every clause is bound and nothing is left over', () => {
    const verdict = compatibility(signature, [binding(['city']), binding(['postcode', 'state'])]);
    expect(verdict).toEqual({ verdict: 'fits', reason: '' });
  });

  it('is partial when it binds some clauses and leaves others open', () => {
    const verdict = compatibility(signature, [binding(['city'])]);
    expect(verdict.verdict).toBe('partial');
    expect(verdict.reason).toContain('binds 1 of 2');
  });

  it('is partial when it carries a clause this query cannot use', () => {
    const verdict = compatibility(signature, [
      binding(['city']),
      binding(['postcode', 'state']),
      binding(['lat', 'lon']),
    ]);
    expect(verdict.verdict).toBe('partial');
    expect(verdict.reason).toContain('1 unused');
  });

  it('names the arities when nothing matches at all', () => {
    const narrow = buildQuerySignature({ valuesInputs: [['a', 'b']] }, null);
    const verdict = compatibility(narrow, [binding(['v', 'w', 'x', 'y', 'z'])]);
    expect(verdict).toEqual({ verdict: 'mismatch', reason: 'arity 5 ≠ 2' });
  });

  it('does not claim an arity when the widths are mixed', () => {
    const verdict = compatibility(signature, [binding(['lat', 'lon'])]);
    expect(verdict.verdict).toBe('mismatch');
    expect(verdict.reason).toBe('no clause in common');
  });

  it('treats a query with no clauses and a set with values as a mismatch', () => {
    const none = buildQuerySignature({ valuesInputs: [] }, null);
    expect(compatibility(none, [binding(['city'])]).verdict).toBe('mismatch');
    expect(compatibility(none, []).verdict).toBe('fits');
  });

  it('reads variables off the stored signature when the array is absent', () => {
    const stored = { tupleSignature: 'city', rows: [] } as unknown as ArgumentTupleBinding;
    const single = buildQuerySignature({ valuesInputs: [['city']] }, null);
    expect(compatibility(single, [stored]).verdict).toBe('fits');
  });
});

describe('pruneUndef', () => {
  it('drops blank cells, because UNDEF is an absent key not an empty literal', () => {
    expect(
      pruneUndef({
        postcode: { type: 'literal', value: '6000' },
        state: { type: 'literal', value: '   ' },
      }),
    ).toEqual({ postcode: { type: 'literal', value: '6000' } });
  });
});

describe('summariseRow', () => {
  it('shows a dash where a cell binds UNDEF', () => {
    expect(
      summariseRow(['postcode', 'state'], { postcode: { type: 'literal', value: '6000' } }),
    ).toBe('6000 · —');
  });
});
