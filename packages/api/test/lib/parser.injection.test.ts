import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Parser } from '@traqula/parser-sparql-1-2';
import { SparqlQueryParser } from '../../src/lib/parser.js';

/**
 * Regression suite for SPARQL injection through argument values.
 *
 * Traqula's generator escapes string literals but writes IRIs and language tags
 * verbatim, so before `sparql-terms.ts` an argument of type `uri` could close its
 * own `<...>` and add terms to the VALUES block:
 *
 *   { type: 'uri', value: 'http://e/a> <http://e/b' }
 *   -> VALUES ?l { <http://e/a> <http://e/b> }     // two rows, valid SPARQL
 *
 * The caller chose which rows a parameterised filter matched. These tests pin the
 * fix: hostile values are rejected outright, and no accepted value may change the
 * *shape* of the query.
 */

const ORACLE = new Parser();

/** Count the rows Traqula sees in the query's first VALUES block. */
function valuesRowCount(query: string): number | null {
  let rows: number | null = null;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.subType === 'values' && Array.isArray(n.values) && rows === null) {
      rows = n.values.length;
    }
    for (const key of Object.keys(n)) visit(n[key]);
  };
  visit(ORACLE.parse(query));
  return rows;
}

const SINGLE = 'SELECT ?s WHERE { VALUES (?l) { (UNDEF) } ?s ?p ?l . }';

const applyOne = (parser: SparqlQueryParser, value: unknown): string =>
  parser.applyArguments(SINGLE, [
    { head: { vars: ['l'] }, arguments: { bindings: [{ l: value as never }] } },
  ]);

describe('argument injection', () => {
  describe('hostile values are rejected', () => {
    const hostile: Array<[string, unknown]> = [
      ['IRI closing its own bracket', { type: 'uri', value: 'http://e/a> <http://e/b' }],
      ['IRI adding two terms', { type: 'uri', value: 'http://e/a> <http://e/b> <http://e/c' }],
      ['IRI with a newline', { type: 'uri', value: 'http://e/a>\n<http://e/b' }],
      ['IRI with a space', { type: 'uri', value: 'http://e/a b' }],
      ['IRI with a brace', { type: 'uri', value: 'http://e/a} INSERT DATA {' }],
      ['IRI with a quote', { type: 'uri', value: 'http://e/a"' }],
      ['IRI with a backslash', { type: 'uri', value: 'http://e/a\\b' }],
      ['IRI with a control character', { type: 'uri', value: 'http://e/a\u0007b' }],
      [
        'language tag breaking out',
        { type: 'literal', value: 'x', 'xml:lang': 'en" } } INSERT DATA { <http://e> <http://p> "x" } #' },
      ],
      ['language tag with a space', { type: 'literal', value: 'x', 'xml:lang': 'en GB' }],
      ['datatype IRI breaking out', { type: 'literal', value: 'x', datatype: 'http://e/d> } <http://e/x' }],
    ];

    it.each(hostile)('rejects %s', (_label, value) => {
      const parser = new SparqlQueryParser();
      expect(() => applyOne(parser, value)).toThrow();
    });

    it('rejects the hostile IRI that previously produced three rows', () => {
      const parser = new SparqlQueryParser();
      expect(() => applyOne(parser, { type: 'uri', value: 'http://e/a> <http://e/b> <http://e/c' }))
        .toThrow(/IRI/i);
    });
  });

  describe('benign values still work and stay one row', () => {
    const benign: Array<[string, unknown]> = [
      ['a plain IRI', { type: 'uri', value: 'http://example.org/a' }],
      ['an IRI with a fragment', { type: 'uri', value: 'http://example.org/a#b' }],
      ['an IRI with percent-encoding', { type: 'uri', value: 'http://example.org/a%20b' }],
      ['a plain literal', { type: 'literal', value: 'hello' }],
      ['a literal with a language tag', { type: 'literal', value: 'bonjour', 'xml:lang': 'fr-CA' }],
      [
        'a typed literal',
        { type: 'literal', value: '42', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
      ],
      ['a literal containing SPARQL syntax', { type: 'literal', value: '" } } INSERT DATA { <a> <b> "c" } #' }],
      ['a literal containing newlines and backslashes', { type: 'literal', value: 'a\nb\\c"d' }],
    ];

    it.each(benign)('accepts %s as exactly one row', (_label, value) => {
      const parser = new SparqlQueryParser();
      const out = applyOne(parser, value);
      expect(out).not.toContain('UNDEF');
      expect(valuesRowCount(out)).toBe(1);
    });
  });

  describe('no accepted value can change the query shape', () => {
    it('every string that survives validation yields exactly one row', () => {
      const parser = new SparqlQueryParser();
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string({ maxLength: 40 }).map((value) => ({ type: 'uri' as const, value })),
            fc.string({ maxLength: 40 }).map((value) => ({ type: 'literal' as const, value })),
            fc.record({
              type: fc.constant('literal' as const),
              value: fc.string({ maxLength: 20 }),
              'xml:lang': fc.string({ maxLength: 12 }),
            }),
            fc.record({
              type: fc.constant('literal' as const),
              value: fc.string({ maxLength: 20 }),
              datatype: fc.string({ maxLength: 30 }),
            }),
          ),
          (value) => {
            let out: string;
            try {
              out = applyOne(parser, value);
            } catch {
              return true; // rejection is always an acceptable outcome
            }
            // Accepted: the result must parse, and must still be a single row.
            expect(valuesRowCount(out)).toBe(1);
            return true;
          },
        ),
        { numRuns: 3000, seed: 20260810 },
      );
    });
  });
});
