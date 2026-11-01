import { describe, expect, it } from 'vitest';
import { checkRefusals, failedFlags, fillMessage, refusalQuery, refusedBody } from '../../src/lib/refusals.js';

const SETTLE = `PREFIX ex: <http://example.org/>
DELETE { ?item ex:state "proposed" }
INSERT { ?item ex:state ?verdict }
WHERE {
  VALUES (?item ?verdict) { (UNDEF UNDEF) }
  BIND(COALESCE(?verdict IN ("agree", "decline"), false) AS ?ok_verdictKnown)
  OPTIONAL { BIND(EXISTS { ?item ex:state "proposed" } AS ?ok_proposed) }
  BIND(?ok_verdictKnown && ?ok_proposed AS ?ok)
  FILTER(?ok)
}`;

const refusals = {
  verdictKnown: 'Refused: the verdict is {verdict}; use agree or decline.',
  proposed: 'Refused: {item} is not proposed.',
};

const T = { type: 'literal', value: 'true', datatype: 'http://www.w3.org/2001/XMLSchema#boolean' };
const F = { type: 'literal', value: 'false', datatype: 'http://www.w3.org/2001/XMLSchema#boolean' };

describe('refusalQuery', () => {
  it('is the WHERE clause as SELECT *, with the prologue and without FILTER(?ok)', () => {
    const { text, flags } = refusalQuery(SETTLE);
    expect(text).toMatch(/^PREFIX ex: <http:\/\/example\.org\/>\s+SELECT \* WHERE \{/);
    expect(text).toContain('?ok_verdictKnown');
    expect(text).not.toMatch(/FILTER/);
    expect(text).not.toMatch(/DELETE|INSERT/);
    expect([...flags].sort()).toEqual(['proposed', 'verdictKnown']);
  });

  it('reads WITH and USING as the dataset of the SELECT', () => {
    expect(refusalQuery('WITH <http://g> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o BIND(true AS ?ok) FILTER(?ok) }').text).toContain(
      'FROM <http://g>',
    );
    expect(
      refusalQuery('DELETE { ?s ?p ?o } USING <http://g> USING NAMED <http://h> WHERE { ?s ?p ?o BIND(true AS ?ok) FILTER(?ok) }').text,
    ).toMatch(/FROM <http:\/\/g>[\s\S]*FROM NAMED <http:\/\/h>/);
  });
});

describe('checkRefusals', () => {
  it('accepts keys the text binds as ?ok_ flags', () => {
    expect(checkRefusals(SETTLE, refusals)).toBeNull();
  });

  it('names a key with no flag, and lists the flags there are', () => {
    expect(checkRefusals(SETTLE, { byOwner: 'x' })).toBe(
      'tool.refusals.byOwner names no flag of this version: it binds no ?ok_byOwner. Its flags are: ?ok_verdictKnown, ?ok_proposed',
    );
  });

  it('refuses text that is not one DELETE/INSERT … WHERE ending in FILTER(?ok)', () => {
    expect(checkRefusals('SELECT * WHERE { ?s ?p ?o }', refusals)).toMatch(/one DELETE\/INSERT … WHERE operation/);
    expect(checkRefusals(SETTLE.replace('FILTER(?ok)', ''), refusals)).toMatch(/end with FILTER\(\?ok\)/);
    expect(checkRefusals('INSERT DATA { <a:a> <a:b> <a:c> }', refusals)).toMatch(/one DELETE\/INSERT/);
  });
});

describe('failedFlags', () => {
  it('fails a flag that is false or unbound in any row', () => {
    const results = {
      results: {
        bindings: [
          { ok_verdictKnown: T, ok_proposed: T },
          { ok_verdictKnown: T, ok_proposed: F },
          { ok_proposed: T },
        ],
      },
    };
    expect(failedFlags(results, refusals)).toEqual({ rows: 3, failed: ['verdictKnown', 'proposed'] });
  });

  it('fails nothing when every flag is true, and counts no rows', () => {
    expect(failedFlags({ results: { bindings: [{ ok_verdictKnown: T, ok_proposed: T }] } }, refusals)).toEqual({ rows: 1, failed: [] });
    expect(failedFlags({ results: { bindings: [] } }, refusals)).toEqual({ rows: 0, failed: [] });
  });
});

describe('messages', () => {
  const tables = [
    {
      head: { vars: ['item', 'verdict'] },
      results: {
        bindings: [
          { item: { type: 'uri', value: 'http://example.org/a' }, verdict: { type: 'literal', value: 'maybe' } },
          { item: { type: 'uri', value: 'http://example.org/b' } },
        ],
      },
    },
  ];

  it('fills {param} with the call\'s values, a list joined with ", "', () => {
    expect(fillMessage(refusals.proposed, tables)).toBe('Refused: http://example.org/a, http://example.org/b is not proposed.');
    expect(fillMessage('{unknown} stays', tables)).toBe('{unknown} stays');
  });

  it('says the update wrote nothing when no flag names the reason', () => {
    expect(refusedBody([], refusals, tables)).toEqual({
      error: 'The update wrote nothing: its WHERE clause has no solution for these arguments.',
      refused: [],
    });
    expect(refusedBody(['verdictKnown'], refusals, tables).refused).toEqual([
      { flag: 'verdictKnown', message: 'Refused: the verdict is maybe; use agree or decline.' },
    ]);
  });
});
