import { describe, expect, it } from 'vitest';
import {
  InvalidTermError,
  renderValuesBlock,
  serializeTerm,
  type PrefixTable,
  type TermValue,
} from '../src/sparql-terms.js';

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
 * fix at the module that owns it — the one an exported bundle runs in someone
 * else's browser, with no server behind it to catch anything: hostile values are
 * rejected outright, and no accepted value may change the *shape* of the block.
 *
 * The oracle is the grammar rather than a parser, since this package has none:
 * every accepted term must match exactly one SPARQL terminal production, written
 * out below independently of the serialiser it checks. The API keeps an
 * end-to-end twin (`packages/api/test/lib/parser.injection.test.ts`) that runs the
 * same values through the AST path and re-parses the result with Traqula.
 */

/** `IRIREF`, with the forbidden set spelled out from the spec, not imported. */
const IRIREF = String.raw`<[^<>"{}|^\x60\\\u0000- ]*>`;
/** `PNAME_LN`, restricted to what the serialiser may emit for a declared prefix. */
const PNAME_LN = String.raw`[A-Za-z][A-Za-z0-9_.-]*:[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?`;
/** `STRING_LITERAL_QUOTE`: no raw quote, backslash or line break; escapes only. */
const STRING = String.raw`"(?:[^"\\\n\r]|\\[tbnrf"'\\])*"`;
const LANGTAG = String.raw`@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*`;
const TERM = `(?:${IRIREF}|${PNAME_LN}|${STRING}(?:${LANGTAG}|\\^\\^(?:${IRIREF}))?)`;
const ONE_ROW = new RegExp(`^VALUES \\?l \\{ ${TERM} \\}$`);

/** Render a one-variable, one-row block — the shape a parameter slot takes. */
const block = (value: unknown, prefixes: PrefixTable = []): string =>
  renderValuesBlock(['l'], [{ l: value as TermValue }], 0, prefixes);

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
  [
    'typed-literal datatype breaking out',
    { type: 'typed-literal', value: 'x', datatype: 'http://e/d> } <http://e/x' },
  ],
  [
    'a literal carrying both a datatype and a language tag',
    { type: 'literal', value: 'x', datatype: 'http://www.w3.org/2001/XMLSchema#string', 'xml:lang': 'en' },
  ],
  ['a blank node', { type: 'bnode', value: 'b0' }],
  ['an unknown term type', { type: 'triple', value: '<<a b c>>' }],
  ['a non-string literal value', { type: 'literal', value: 42 }],
  ['an empty IRI', { type: 'uri', value: '' }],
  ['not an object', 'http://e/a'],
];

const benign: Array<[string, unknown]> = [
  ['a plain IRI', { type: 'uri', value: 'http://example.org/a' }],
  ['an IRI with a fragment', { type: 'uri', value: 'http://example.org/a#b' }],
  ['an IRI with percent-encoding', { type: 'uri', value: 'http://example.org/a%20b' }],
  ['a plain literal', { type: 'literal', value: 'hello' }],
  ['a literal with a language tag', { type: 'literal', value: 'bonjour', 'xml:lang': 'fr-CA' }],
  ['a typed literal', { type: 'literal', value: '42', datatype: 'http://www.w3.org/2001/XMLSchema#integer' }],
  [
    'a Virtuoso-shaped typed-literal',
    { type: 'typed-literal', value: '42', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
  ],
  ['a literal containing SPARQL syntax', { type: 'literal', value: '" } } INSERT DATA { <a> <b> "c" } #' }],
  ['a literal containing newlines and backslashes', { type: 'literal', value: 'a\nb\\c"d' }],
];

describe('argument injection', () => {
  describe('hostile values are rejected', () => {
    it.each(hostile)('rejects %s', (_label, value) => {
      expect(() => block(value)).toThrow(InvalidTermError);
    });

    it('rejects the hostile IRI that previously produced three rows, naming the IRI', () => {
      expect(() => block({ type: 'uri', value: 'http://e/a> <http://e/b> <http://e/c' })).toThrow(/IRI/);
    });

    it('says why a blank node is refused, rather than only that its type is wrong', () => {
      expect(() => serializeTerm({ type: 'bnode', value: 'b0' }, "for variable 'l'")).toThrow(
        /blank node cannot be passed as an argument/,
      );
    });
  });

  describe('benign values still work and stay one term', () => {
    it.each(benign)('accepts %s as exactly one term', (_label, value) => {
      expect(block(value)).toMatch(ONE_ROW);
    });

    it('reads typed-literal as literal, so both spellings serialise alike', () => {
      const datatype = 'http://www.w3.org/2001/XMLSchema#integer';
      expect(serializeTerm({ type: 'typed-literal', value: '42', datatype }, '')).toBe(
        serializeTerm({ type: 'literal', value: '42', datatype }, ''),
      );
      // A typed-literal with no datatype is the plain literal it always meant.
      expect(serializeTerm({ type: 'typed-literal', value: 'x' }, '')).toBe(
        '"x"^^<http://www.w3.org/2001/XMLSchema#string>',
      );
    });

    it('abbreviates through a prefix table and still emits one term', () => {
      expect(block({ type: 'uri', value: 'http://example.org/a' }, [['ex', 'http://example.org/']])).toBe(
        'VALUES ?l { ex:a }',
      );
    });
  });

  describe('no accepted value can change the block shape', () => {
    /**
     * Seeded so a failure reproduces. Hand-rolled rather than fast-check because
     * this package keeps its dependency list to a build and a test runner; the
     * API's twin runs the shrinking property test against a real parser.
     */
    function mulberry32(seed: number): () => number {
      let state = seed >>> 0;
      return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // Every character that has ever mattered to an escape, plus enough ordinary
    // ones that some draws are accepted and the check has something to check.
    const ALPHABET = [
      ...'<>"{}|^`\\ \t\n\r#@:/.-_?^$()[]\'',
      '\u0000',
      '\u0007',
      'é',
      ' ',
      ...'abcxyzEN019',
      'http://e/',
      'en',
      '^^',
      '} INSERT DATA {',
    ];

    it('every value that survives validation renders exactly one term', () => {
      const random = mulberry32(20260810);
      const pick = () => ALPHABET[Math.floor(random() * ALPHABET.length)];
      const text = (max: number) => Array.from({ length: Math.floor(random() * max) }, pick).join('');

      let accepted = 0;
      for (let run = 0; run < 3000; run += 1) {
        const shape = Math.floor(random() * 5);
        const value: Record<string, unknown> =
          shape === 0
            ? { type: 'uri', value: text(12) }
            : shape === 1
              ? { type: 'literal', value: text(12) }
              : shape === 2
                ? { type: 'literal', value: text(6), 'xml:lang': text(4) }
                : shape === 3
                  ? { type: 'literal', value: text(6), datatype: text(8) }
                  : { type: 'typed-literal', value: text(6), datatype: text(8) };

        let out: string;
        try {
          out = block(value);
        } catch (error) {
          // Rejection is always an acceptable outcome — but only as the
          // module's own error, never as a crash somewhere inside it.
          expect(error).toBeInstanceOf(InvalidTermError);
          continue;
        }
        accepted += 1;
        expect(out, JSON.stringify(value)).toMatch(ONE_ROW);
      }
      // A generator that only ever produced rejected values would pass vacuously.
      expect(accepted).toBeGreaterThan(300);
    });
  });
});
